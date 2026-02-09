import Database from 'better-sqlite3';

/**
 * Analyzes redundancy between Profile and Permission Set permissions
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<Object>} Redundancy analysis results
 */
export async function analyzeProfilePSRedundancy(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const query = `
      WITH user_profiles AS (
        SELECT ua.user_id, ua.user_email, ua.assignee_id AS profile_id
        FROM user_assignments ua
        WHERE ua.assignee_type = 'Profile'
      ),
      user_ps AS (
        SELECT DISTINCT ua.user_id, ua.assignee_id AS ps_id
        FROM user_assignments ua
        LEFT JOIN permission_sets ps ON ua.assignee_id = ps.id
        WHERE ua.assignee_type = 'PermissionSet'
          AND (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
        UNION
        SELECT DISTINCT ua.user_id, pm.ps_id
        FROM user_assignments ua
        JOIN permission_set_groups psg ON ua.assignee_id = psg.id
        JOIN psg_members pm ON psg.full_name = pm.psg_id
        LEFT JOIN permission_sets ps ON pm.ps_id = ps.id
        WHERE ua.assignee_type = 'PermissionSetGroup'
          AND psg.status = 'Updated'
          AND (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
      ),
      profile_perms AS (
        SELECT up.user_id, up.user_email, up.profile_id,
               p.permission_name, p.permission_value,
               p.permission_name || '::' || COALESCE(p.permission_value, '') AS perm_tuple
        FROM user_profiles up
        JOIN permissions p ON up.profile_id = p.source_id AND p.source_type = 'Profile'
      ),
      ps_perms AS (
        SELECT ups.user_id, ups.ps_id,
               p.permission_name, p.permission_value,
               p.permission_name || '::' || COALESCE(p.permission_value, '') AS perm_tuple
        FROM user_ps ups
        JOIN permissions p ON ups.ps_id = p.source_id AND p.source_type = 'PermissionSet'
      )
      SELECT DISTINCT
        pp.user_id,
        pp.user_email,
        pp.permission_name,
        pp.permission_value,
        pp.profile_id,
        GROUP_CONCAT(DISTINCT psp.ps_id) AS permission_sets
      FROM profile_perms pp
      JOIN ps_perms psp ON pp.user_id = psp.user_id AND pp.perm_tuple = psp.perm_tuple
      GROUP BY pp.user_id, pp.permission_name, pp.permission_value, pp.profile_id
      ORDER BY pp.user_id, pp.permission_name
    `;

    const rows = db.prepare(query).all();

    const uniqueUsers = new Set(rows.map(r => r.user_id));
    const uniquePS = new Set();
    rows.forEach(r => {
      if (r.permission_sets) {
        r.permission_sets.split(',').forEach(ps => uniquePS.add(ps));
      }
    });

    const details = rows.map(row => ({
      user: row.user_email || row.user_id,
      permission: row.permission_name,
      value: row.permission_value,
      profile: row.profile_id,
      permission_sets: row.permission_sets ? row.permission_sets.split(',') : [],
    }));

    return {
      type: 'profile_ps_redundancy',
      summary: {
        total_redundant_permissions: rows.length,
        affected_users: uniqueUsers.size,
        affected_permission_sets: uniquePS.size,
      },
      details,
    };
  } finally {
    db.close();
  }
}

/**
 * Analyzes redundancy when multiple Permission Sets grant the same permission
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<Object>} Redundancy analysis results
 */
export async function analyzeMultiplePSRedundancy(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const query = `
      WITH user_ps AS (
        SELECT DISTINCT ua.user_id, ua.user_email, ua.assignee_id AS ps_id
        FROM user_assignments ua
        LEFT JOIN permission_sets ps ON ua.assignee_id = ps.id
        WHERE ua.assignee_type = 'PermissionSet'
          AND (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
        UNION
        SELECT DISTINCT ua.user_id, ua.user_email, pm.ps_id
        FROM user_assignments ua
        JOIN permission_set_groups psg ON ua.assignee_id = psg.id
        JOIN psg_members pm ON psg.full_name = pm.psg_id
        LEFT JOIN permission_sets ps ON pm.ps_id = ps.id
        WHERE ua.assignee_type = 'PermissionSetGroup'
          AND psg.status = 'Updated'
          AND (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
      )
      SELECT
        ups.user_id,
        ups.user_email,
        p.permission_name,
        p.permission_value,
        COUNT(DISTINCT p.source_id) AS source_count,
        GROUP_CONCAT(DISTINCT p.source_id) AS permission_sets
      FROM user_ps ups
      JOIN permissions p ON ups.ps_id = p.source_id AND p.source_type = 'PermissionSet'
      GROUP BY ups.user_id, p.permission_name, p.permission_value
      HAVING COUNT(DISTINCT p.source_id) > 1
      ORDER BY ups.user_id, p.permission_name
    `;

    const rows = db.prepare(query).all();

    const uniqueUsers = new Set(rows.map(r => r.user_id));

    const details = rows.map(row => ({
      user: row.user_email || row.user_id,
      permission: row.permission_name,
      value: row.permission_value,
      permission_sets: row.permission_sets ? row.permission_sets.split(',') : [],
      source_count: row.source_count,
    }));

    return {
      type: 'multiple_ps_redundancy',
      summary: {
        total_redundant_permissions: rows.length,
        affected_users: uniqueUsers.size,
      },
      details,
    };
  } finally {
    db.close();
  }
}

/**
 * Analyzes redundancy when users are assigned to both a PSG and one of its member PS
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<Object>} Redundancy analysis results
 */
export async function analyzePSGRedundancy(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const query = `
      SELECT DISTINCT
        ua_psg.user_id,
        ua_psg.user_email,
        ua_psg.assignee_id AS psg_id,
        GROUP_CONCAT(DISTINCT ua_ps.assignee_id) AS redundant_ps
      FROM user_assignments ua_psg
      JOIN permission_set_groups psg ON ua_psg.assignee_id = psg.id
      JOIN psg_members pm ON psg.full_name = pm.psg_id
      JOIN user_assignments ua_ps ON ua_psg.user_id = ua_ps.user_id
        AND ua_ps.assignee_type = 'PermissionSet'
        AND ua_ps.assignee_id = pm.ps_id
      WHERE ua_psg.assignee_type = 'PermissionSetGroup'
        AND psg.status = 'Updated'
      GROUP BY ua_psg.user_id, ua_psg.assignee_id
      ORDER BY ua_psg.user_id
    `;

    const rows = db.prepare(query).all();

    const uniqueUsers = new Set(rows.map(r => r.user_id));

    const details = rows.map(row => ({
      user: row.user_email || row.user_id,
      psg: row.psg_id,
      redundant_ps: row.redundant_ps ? row.redundant_ps.split(',') : [],
    }));

    return {
      type: 'psg_redundancy',
      summary: {
        total_redundant_assignments: rows.length,
        affected_users: uniqueUsers.size,
      },
      details,
    };
  } finally {
    db.close();
  }
}

/**
 * Analyzes permissions that exist only in Profiles, not in any Permission Set
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeProfileOnlyPermissions(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const query = `
      SELECT
        p.source_id AS profile_id,
        pr.full_name AS profile_name,
        p.permission_name,
        p.permission_value,
        p.permission_type
      FROM permissions p
      LEFT JOIN profiles pr ON p.source_id = pr.id
      WHERE p.source_type = 'Profile'
        AND p.permission_name NOT IN (
          SELECT DISTINCT permission_name
          FROM permissions
          WHERE source_type = 'PermissionSet'
        )
      ORDER BY p.source_id, p.permission_name
    `;

    const rows = db.prepare(query).all();

    const totalProfilePerms = db.prepare(`
      SELECT COUNT(DISTINCT permission_name) AS total
      FROM permissions
      WHERE source_type = 'Profile'
    `).get();

    const profileMap = new Map();
    rows.forEach(row => {
      if (!profileMap.has(row.profile_id)) {
        profileMap.set(row.profile_id, {
          profile_id: row.profile_id,
          profile_name: row.profile_name || row.profile_id,
          permissions: [],
          count: 0,
        });
      }
      const profile = profileMap.get(row.profile_id);
      profile.permissions.push({
        name: row.permission_name,
        value: row.permission_value,
        type: row.permission_type,
      });
      profile.count++;
    });

    const details = Array.from(profileMap.values());
    const uniqueProfileOnlyPerms = new Set(rows.map(r => r.permission_name));

    const percentageProfileOnly = totalProfilePerms.total > 0
      ? Math.round((uniqueProfileOnlyPerms.size / totalProfilePerms.total) * 100)
      : 0;

    return {
      type: 'profile_only_permissions',
      summary: {
        total_profile_only: uniqueProfileOnlyPerms.size,
        profiles_affected: profileMap.size,
        percentage_profile_only: percentageProfileOnly,
      },
      details,
    };
  } finally {
    db.close();
  }
}

/**
 * Runs all redundancy analyses
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<Object>} Combined analysis results
 */
export async function analyzeAllRedundancy(dbPath) {
  const results = {};

  try {
    results.profile_ps_redundancy = await analyzeProfilePSRedundancy(dbPath);
  } catch (error) {
    results.profile_ps_redundancy = {
      type: 'profile_ps_redundancy',
      error: error.message,
      summary: { total_redundant_permissions: 0, affected_users: 0, affected_permission_sets: 0 },
      details: [],
    };
  }

  try {
    results.multiple_ps_redundancy = await analyzeMultiplePSRedundancy(dbPath);
  } catch (error) {
    results.multiple_ps_redundancy = {
      type: 'multiple_ps_redundancy',
      error: error.message,
      summary: { total_redundant_permissions: 0, affected_users: 0 },
      details: [],
    };
  }

  try {
    results.psg_redundancy = await analyzePSGRedundancy(dbPath);
  } catch (error) {
    results.psg_redundancy = {
      type: 'psg_redundancy',
      error: error.message,
      summary: { total_redundant_assignments: 0, affected_users: 0 },
      details: [],
    };
  }

  try {
    results.profile_only_permissions = await analyzeProfileOnlyPermissions(dbPath);
  } catch (error) {
    results.profile_only_permissions = {
      type: 'profile_only_permissions',
      error: error.message,
      summary: { total_profile_only: 0, profiles_affected: 0, percentage_profile_only: 0 },
      details: [],
    };
  }

  return results;
}
