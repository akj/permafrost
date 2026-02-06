/**
 * Report aggregator - transforms raw analyzer output into report-ready views.
 * Sits between analyzers (raw detail rows) and reporters (formatted output).
 */

import Database from 'better-sqlite3';

/**
 * Gets contextual data from the database for enriching aggregated results.
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Object} Context data including profile stats, user stats, and totals
 */
export function getContextData(dbPath) {
  const db = new Database(dbPath, { readonly: true });

  try {
    // Total permissions per profile (using perm tuples for dedup)
    const profilePerms = db.prepare(`
      SELECT source_id,
             COUNT(DISTINCT permission_name || '::' || COALESCE(permission_value,'')) as total_perms
      FROM permissions WHERE source_type = 'Profile'
      GROUP BY source_id
    `).all();

    // User count per profile
    const profileUsers = db.prepare(`
      SELECT assignee_id as profile_id,
             COUNT(DISTINCT user_id) as user_count
      FROM user_assignments WHERE assignee_type = 'Profile'
      GROUP BY assignee_id
    `).all();

    // Build profileStats map (keyed by profile id/name)
    const profileStats = new Map();
    for (const row of profilePerms) {
      profileStats.set(row.source_id, { totalPerms: row.total_perms, userCount: 0 });
    }
    for (const row of profileUsers) {
      const existing = profileStats.get(row.profile_id) || { totalPerms: 0, userCount: 0 };
      existing.userCount = row.user_count;
      profileStats.set(row.profile_id, existing);
    }

    // PS/PSG count per user + their profile
    const userStatsRows = db.prepare(`
      SELECT user_id, user_email,
        MAX(CASE WHEN assignee_type='Profile' THEN assignee_id END) as profile_id,
        COUNT(DISTINCT CASE WHEN assignee_type IN ('PermissionSet','PermissionSetGroup')
          THEN assignee_id END) as ps_psg_count
      FROM user_assignments GROUP BY user_id
    `).all();

    // Build userStats map keyed by BOTH user_id and user_email
    // (raw details use email-or-id as user identifier)
    const userStats = new Map();
    for (const row of userStatsRows) {
      const stats = {
        email: row.user_email,
        totalPSCount: row.ps_psg_count,
        profileId: row.profile_id,
      };
      userStats.set(row.user_id, stats);
      if (row.user_email) {
        userStats.set(row.user_email, stats);
      }
    }

    const totalUsers = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as total_users FROM user_assignments',
    ).get().total_users;

    return { profileStats, userStats, totalUsers };
  } finally {
    db.close();
  }
}

/**
 * Aggregates profile + PS redundancy data by profile and by PS.
 * @param {Array} rawDetails - Raw profile_ps_redundancy.details
 * @param {Map} profileStats - Profile statistics from getContextData
 * @returns {Object} { byProfile, byPS }
 */
export function aggregateProfilePSRedundancy(rawDetails, profileStats) {
  if (!rawDetails || rawDetails.length === 0) {
    return { byProfile: [], byPS: [] };
  }

  const byProfileMap = new Map();
  const byPSMap = new Map();

  for (const detail of rawDetails) {
    const { user, permission, value, profile, permission_sets } = detail;
    const permKey = `${permission}::${value || ''}`;

    // Profile-centric aggregation
    if (!byProfileMap.has(profile)) {
      byProfileMap.set(profile, {
        profile,
        permissions: new Set(),
        users: new Set(),
        psPermissions: new Map(),  // ps → Set<permKey>
      });
    }
    const profileData = byProfileMap.get(profile);
    profileData.permissions.add(permKey);
    profileData.users.add(user);
    for (const ps of permission_sets) {
      if (!profileData.psPermissions.has(ps)) {
        profileData.psPermissions.set(ps, new Set());
      }
      profileData.psPermissions.get(ps).add(permKey);
    }

    // PS-centric aggregation
    for (const ps of permission_sets) {
      if (!byPSMap.has(ps)) {
        byPSMap.set(ps, {
          ps,
          profilePerms: new Map(),  // profile → Set<permKey>
          users: new Set(),
        });
      }
      const psData = byPSMap.get(ps);
      if (!psData.profilePerms.has(profile)) {
        psData.profilePerms.set(profile, new Set());
      }
      psData.profilePerms.get(profile).add(permKey);
      psData.users.add(user);
    }
  }

  const byProfile = Array.from(byProfileMap.values()).map(data => {
    const stats = profileStats.get(data.profile) || { totalPerms: 0, userCount: 0 };
    const redundantPerms = data.permissions.size;
    const totalPerms = stats.totalPerms;
    const overlapPct = totalPerms > 0
      ? parseFloat(((redundantPerms / totalPerms) * 100).toFixed(1))
      : 0;

    const topOverlappingPS = Array.from(data.psPermissions.entries())
      .map(([ps, perms]) => ({ ps, count: perms.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      profile: data.profile,
      totalPerms,
      redundantPerms,
      overlapPct,
      topOverlappingPS,
      usersAffected: data.users.size,
    };
  }).sort((a, b) => b.overlapPct - a.overlapPct);

  const byPS = Array.from(byPSMap.values()).map(data => {
    const overlappingProfiles = Array.from(data.profilePerms.entries())
      .map(([profile, perms]) => ({ profile, count: perms.size }))
      .sort((a, b) => b.count - a.count);

    const totalRedundant = overlappingProfiles.reduce((sum, p) => sum + p.count, 0);

    return {
      ps: data.ps,
      overlappingProfiles,
      totalRedundant,
      usersAffected: data.users.size,
    };
  }).sort((a, b) => b.totalRedundant - a.totalRedundant);

  return { byProfile, byPS };
}

/**
 * Aggregates multiple PS redundancy by user, PS pair, and permission.
 * @param {Array} rawDetails - Raw multiple_ps_redundancy.details
 * @param {Map} userStats - User statistics from getContextData
 * @returns {Object} { byUser, byPSPair, byPermission }
 */
export function aggregateMultiplePSRedundancy(rawDetails, userStats) {
  if (!rawDetails || rawDetails.length === 0) {
    return { byUser: [], byPSPair: [], byPermission: [] };
  }

  const byUserMap = new Map();
  const byPSPairMap = new Map();
  const byPermissionMap = new Map();

  for (const detail of rawDetails) {
    const { user, permission, value, permission_sets } = detail;
    const permKey = `${permission}::${value || ''}`;
    const sortedPS = [...permission_sets].sort();

    // User-centric
    if (!byUserMap.has(user)) {
      byUserMap.set(user, {
        user,
        permissions: new Set(),
        pairs: new Map(),  // pairKey → { psA, psB, perms: Set }
      });
    }
    const userData = byUserMap.get(user);
    userData.permissions.add(permKey);

    for (let i = 0; i < sortedPS.length; i++) {
      for (let j = i + 1; j < sortedPS.length; j++) {
        const pairKey = `${sortedPS[i]}||${sortedPS[j]}`;
        if (!userData.pairs.has(pairKey)) {
          userData.pairs.set(pairKey, { psA: sortedPS[i], psB: sortedPS[j], perms: new Set() });
        }
        userData.pairs.get(pairKey).perms.add(permKey);
      }
    }

    // Global PS pair
    for (let i = 0; i < sortedPS.length; i++) {
      for (let j = i + 1; j < sortedPS.length; j++) {
        const pairKey = `${sortedPS[i]}||${sortedPS[j]}`;
        if (!byPSPairMap.has(pairKey)) {
          byPSPairMap.set(pairKey, {
            psA: sortedPS[i], psB: sortedPS[j],
            permissions: new Set(), users: new Set(),
          });
        }
        const pairData = byPSPairMap.get(pairKey);
        pairData.permissions.add(permKey);
        pairData.users.add(user);
      }
    }

    // Permission-centric
    if (!byPermissionMap.has(permKey)) {
      byPermissionMap.set(permKey, {
        permission: permKey,
        permissionSets: new Set(),
        users: new Set(),
      });
    }
    const permData = byPermissionMap.get(permKey);
    for (const ps of permission_sets) permData.permissionSets.add(ps);
    permData.users.add(user);
  }

  const byUser = Array.from(byUserMap.values()).map(data => {
    const stats = userStats.get(data.user) || { totalPSCount: 0 };
    const redundantPerms = data.permissions.size;

    const worstPairs = Array.from(data.pairs.values())
      .map(p => ({ psA: p.psA, psB: p.psB, shared: p.perms.size }))
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 3);

    let score = 'Low';
    if (redundantPerms > 100) score = 'High';
    else if (redundantPerms > 30) score = 'Medium';

    return { user: data.user, redundantPerms, totalPS: stats.totalPSCount, worstPairs, score };
  }).sort((a, b) => b.redundantPerms - a.redundantPerms);

  const byPSPair = Array.from(byPSPairMap.values()).map(data => ({
    psA: data.psA,
    psB: data.psB,
    sharedPerms: data.permissions.size,
    usersWithBoth: data.users.size,
  })).sort((a, b) => b.sharedPerms - a.sharedPerms);

  const byPermission = Array.from(byPermissionMap.values()).map(data => ({
    permission: data.permission,
    psCount: data.permissionSets.size,
    userCount: data.users.size,
  })).sort((a, b) => b.psCount - a.psCount);

  return { byUser, byPSPair, byPermission };
}

/**
 * Aggregates PSG redundancy data by PSG.
 * @param {Array} rawDetails - Raw psg_redundancy.details
 * @returns {Object} { byPSG }
 */
export function aggregatePSGRedundancy(rawDetails) {
  if (!rawDetails || rawDetails.length === 0) {
    return { byPSG: [] };
  }

  const byPSGMap = new Map();

  for (const detail of rawDetails) {
    const { user, psg, redundant_ps } = detail;

    if (!byPSGMap.has(psg)) {
      byPSGMap.set(psg, {
        psg,
        psUserCounts: new Map(),
        users: new Set(),
        userList: [],
      });
    }

    const psgData = byPSGMap.get(psg);
    psgData.users.add(user);
    if (psgData.userList.length < 3) {
      psgData.userList.push(user);
    }

    for (const ps of redundant_ps) {
      psgData.psUserCounts.set(ps, (psgData.psUserCounts.get(ps) || 0) + 1);
    }
  }

  const byPSG = Array.from(byPSGMap.values()).map(data => ({
    psg: data.psg,
    redundantPS: Array.from(data.psUserCounts.entries())
      .map(([ps, userCount]) => ({ ps, userCount }))
      .sort((a, b) => b.userCount - a.userCount),
    totalUsers: data.users.size,
    exampleUsers: data.userList,
  })).sort((a, b) => b.totalUsers - a.totalUsers);

  return { byPSG };
}

/**
 * Enriches profile-only permission data with context and migration complexity.
 * @param {Array} rawDetails - Raw profile_only_permissions.details
 * @param {Map} profileStats - Profile statistics from getContextData
 * @returns {Array} Enriched profiles sorted by unique permission count DESC
 */
export function enrichProfileOnly(rawDetails, profileStats) {
  if (!rawDetails || rawDetails.length === 0) {
    return [];
  }

  const enriched = rawDetails.map(detail => {
    const stats = profileStats.get(detail.profile_name) || profileStats.get(detail.profile_id) || { totalPerms: 0, userCount: 0 };
    const uniquePerms = detail.count;
    const totalPerms = stats.totalPerms;
    const pctOfProfile = totalPerms > 0
      ? parseFloat(((uniquePerms / totalPerms) * 100).toFixed(1))
      : 0;

    let complexity = 'Low';
    if (uniquePerms > 100 || pctOfProfile > 80) complexity = 'High';
    else if (uniquePerms > 30 || pctOfProfile > 50) complexity = 'Medium';

    return {
      profile: detail.profile_name,
      uniquePerms,
      totalPerms,
      pctOfProfile,
      userCount: stats.userCount,
      complexity,
    };
  }).sort((a, b) => b.uniquePerms - a.uniquePerms);

  return enriched.map((item, index) => ({ rank: index + 1, ...item }));
}

/**
 * Classifies overlap pairs by relationship type.
 * @param {Array} pairs - Raw overlap pairs
 * @returns {Array} Pairs with added `relationship` field
 */
export function classifyOverlapPairs(pairs) {
  if (!pairs || pairs.length === 0) {
    return [];
  }

  return pairs.map(p => {
    const { permission_set_a, permission_set_b, metrics } = p;
    const overlapPct = metrics.overlap_percentage;

    let relationship;
    if (overlapPct >= 0.95) {
      const smallerPS = permission_set_a.permission_count <= permission_set_b.permission_count
        ? permission_set_a.name : permission_set_b.name;
      const largerPS = permission_set_a.permission_count > permission_set_b.permission_count
        ? permission_set_a.name : permission_set_b.name;
      relationship = `${smallerPS} is near-perfect subset of ${largerPS}`;
    } else if (overlapPct >= 0.80) {
      relationship = 'High overlap';
    } else {
      relationship = 'Moderate overlap';
    }

    return { ...p, relationship };
  });
}

/**
 * Builds executive summary from raw and aggregated results.
 * @param {Object} rawResults - Raw analyzer results
 * @param {Object} aggregated - Aggregated results
 * @param {Object} contextData - Context data from getContextData
 * @returns {Object} { metrics, findings }
 */
export function buildExecutiveSummary(rawResults, aggregated, contextData) {
  const metrics = [];
  const findings = [];

  metrics.push({ label: 'Total Users Analyzed', value: contextData.totalUsers, context: '' });

  if (rawResults.redundancy?.profile_ps_redundancy?.summary) {
    const s = rawResults.redundancy.profile_ps_redundancy.summary;
    metrics.push({
      label: 'Profile + PS Redundant Permissions',
      value: s.total_redundant_permissions,
      context: `across ${s.affected_users} users and ${s.affected_permission_sets} permission sets`,
    });
    if (aggregated.profilePSRedundancy?.byProfile?.length > 0) {
      const top = aggregated.profilePSRedundancy.byProfile[0];
      findings.push({
        title: 'Profile + PS Redundancy',
        detail: `${top.profile} has ${top.overlapPct}% overlap with assigned permission sets (${top.redundantPerms} redundant permissions)`,
      });
    }
  }

  if (rawResults.redundancy?.multiple_ps_redundancy?.summary) {
    const s = rawResults.redundancy.multiple_ps_redundancy.summary;
    metrics.push({
      label: 'Multiple PS Redundancies',
      value: s.total_redundant_permissions,
      context: `across ${s.affected_users} users`,
    });
    if (aggregated.multiplePSRedundancy?.byUser?.length > 0) {
      const top = aggregated.multiplePSRedundancy.byUser[0];
      findings.push({
        title: 'Multiple PS Redundancy',
        detail: `${top.user} has ${top.redundantPerms} redundant permissions across ${top.totalPS} permission sets`,
      });
    }
  }

  if (rawResults.redundancy?.psg_redundancy?.summary) {
    const s = rawResults.redundancy.psg_redundancy.summary;
    metrics.push({
      label: 'PSG Redundant Assignments',
      value: s.total_redundant_assignments,
      context: `across ${s.affected_users} users`,
    });
    if (aggregated.psgRedundancy?.byPSG?.length > 0) {
      const top = aggregated.psgRedundancy.byPSG[0];
      findings.push({
        title: 'PSG Redundancy',
        detail: `${top.psg} has ${top.totalUsers} users with redundant direct PS assignments`,
      });
    }
  }

  if (rawResults.overlap?.summary) {
    const s = rawResults.overlap.summary;
    metrics.push({
      label: 'High-Overlap PS Pairs',
      value: s.high_overlap_pairs,
      context: `(threshold: ${(s.threshold * 100).toFixed(0)}%)`,
    });
  }

  if (rawResults.redundancy?.profile_only_permissions?.summary) {
    const s = rawResults.redundancy.profile_only_permissions.summary;
    metrics.push({
      label: 'Profile-Only Permissions',
      value: s.total_profile_only,
      context: `across ${s.profiles_affected} profiles (${s.percentage_profile_only}% of profile permissions)`,
    });
    if (aggregated.profileOnly?.length > 0) {
      const top = aggregated.profileOnly[0];
      findings.push({
        title: 'Profile Dependency',
        detail: `${top.profile} has ${top.uniquePerms} unique permissions (${top.complexity} migration complexity)`,
      });
    }
  }

  return { metrics, findings };
}

/**
 * Main aggregation entry point. Runs all aggregation functions.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} rawResults - Raw analyzer results
 * @returns {Object} Complete aggregated report data
 */
export function aggregateForReport(dbPath, rawResults) {
  const context = getContextData(dbPath);

  const profilePSRedundancy = aggregateProfilePSRedundancy(
    rawResults.redundancy?.profile_ps_redundancy?.details,
    context.profileStats,
  );

  const multiplePSRedundancy = aggregateMultiplePSRedundancy(
    rawResults.redundancy?.multiple_ps_redundancy?.details,
    context.userStats,
  );

  const psgRedundancy = aggregatePSGRedundancy(
    rawResults.redundancy?.psg_redundancy?.details,
  );

  const profileOnly = enrichProfileOnly(
    rawResults.redundancy?.profile_only_permissions?.details,
    context.profileStats,
  );

  const overlapClassified = classifyOverlapPairs(
    rawResults.overlap?.pairs,
  );

  const aggregated = {
    profilePSRedundancy,
    multiplePSRedundancy,
    psgRedundancy,
    profileOnly,
    overlapClassified,
  };

  const executiveSummary = buildExecutiveSummary(rawResults, aggregated, context);

  return {
    context,
    executiveSummary,
    profilePSRedundancy,
    multiplePSRedundancy,
    psgRedundancy,
    profileOnly,
    overlapClassified,
    raw: rawResults,
  };
}
