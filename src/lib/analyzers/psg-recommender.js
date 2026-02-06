/**
 * PSG Recommendation Engine
 * Recommends Permission Set Groups based on hierarchical containment and co-assignment patterns
 */

import Database from 'better-sqlite3';
import { calculateJaccardSimilarity, setIntersection } from '../metrics.js';

/**
 * Recommends PSGs based on hierarchical containment (strict subset relationships)
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<Object>} - Hierarchical PSG recommendations
 */
export async function recommendHierarchicalPSGs(dbPath) {
  const db = new Database(dbPath, { readonly: true });

  try {
    // Get all non-profile-owned permission sets
    const permissionSets = db.prepare(`
      SELECT id, full_name
      FROM permission_sets
      WHERE is_owned_by_profile = 0 OR is_owned_by_profile IS NULL
    `).all();

    // Load permissions for each PS as Set of 'name::value' strings
    const psPermissions = new Map();
    const getPermissionsStmt = db.prepare(`
      SELECT permission_name, permission_value
      FROM permissions
      WHERE source_type = 'PermissionSet' AND source_id = ?
    `);

    for (const ps of permissionSets) {
      const permissions = getPermissionsStmt.all(ps.id);
      const permSet = new Set(
        permissions.map(p => `${p.permission_name}::${p.permission_value}`)
      );
      psPermissions.set(ps.id, { fullName: ps.full_name, permissions: permSet });
    }

    // Find strict subset relationships
    const subsetRelationships = new Map(); // basePS -> [subsets]

    for (const [psIdA, dataA] of psPermissions) {
      for (const [psIdB, dataB] of psPermissions) {
        if (psIdA === psIdB) continue;

        // Check if B is a strict subset of A
        if (dataB.permissions.size < dataA.permissions.size) {
          let isSubset = true;
          for (const perm of dataB.permissions) {
            if (!dataA.permissions.has(perm)) {
              isSubset = false;
              break;
            }
          }

          if (isSubset) {
            if (!subsetRelationships.has(psIdA)) {
              subsetRelationships.set(psIdA, []);
            }
            subsetRelationships.get(psIdA).push({
              psId: psIdB,
              psFullName: dataB.fullName,
              permissionCount: dataB.permissions.size,
              coveragePercentage: Math.round((dataB.permissions.size / dataA.permissions.size) * 100)
            });
          }
        }
      }
    }

    // Filter to bases with 2+ subsets, sort subsets, limit
    const recommendations = [];
    for (const [basePS, subsets] of subsetRelationships) {
      if (subsets.length < 2) continue;

      // Sort by permission count descending, take top 5
      const sortedSubsets = subsets
        .sort((a, b) => b.permissionCount - a.permissionCount)
        .slice(0, 5);

      const baseData = psPermissions.get(basePS);
      recommendations.push({
        basePermissionSet: baseData.fullName,
        basePermissionCount: baseData.permissions.size,
        subsets: sortedSubsets.map(s => ({
          psId: s.psFullName,
          permissionCount: s.permissionCount,
          coveragePercentage: s.coveragePercentage
        })),
        totalSubsets: subsets.length,
        recommendedPSG: {
          name: `${baseData.fullName}_Hierarchy`,
          members: [baseData.fullName, ...sortedSubsets.map(s => s.psFullName)]
        }
      });
    }

    // Sort by number of subsets descending, limit to top 20
    recommendations.sort((a, b) => b.totalSubsets - a.totalSubsets);
    const topRecommendations = recommendations.slice(0, 20);

    return {
      type: 'hierarchical_psg_recommendations',
      recommendations: topRecommendations,
      totalRecommendations: topRecommendations.length
    };

  } finally {
    db.close();
  }
}

/**
 * Recommends PSGs based on co-assignment patterns (users assigned to multiple PS)
 * Uses complete-linkage clustering
 * @param {string} dbPath - Path to SQLite database
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Co-assignment PSG recommendations
 */
export async function recommendCoAssignmentPSGs(dbPath, options = {}) {
  const { minUsers = 5, coAssignmentThreshold = 0.7 } = options;
  const db = new Database(dbPath, { readonly: true });

  try {
    // Get PS assignments excluding profile-owned
    const assignments = db.prepare(`
      SELECT ua.user_id, ua.assignee_id
      FROM user_assignments ua
      JOIN permission_sets ps ON ua.assignee_id = ps.id
      WHERE ua.assignee_type = 'PermissionSet'
        AND (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
    `).all();

    // Build user→PS and PS→users maps
    const userToPS = new Map();
    const psToUsers = new Map();

    for (const { user_id, assignee_id } of assignments) {
      if (!userToPS.has(user_id)) userToPS.set(user_id, new Set());
      userToPS.get(user_id).add(assignee_id);

      if (!psToUsers.has(assignee_id)) psToUsers.set(assignee_id, new Set());
      psToUsers.get(assignee_id).add(user_id);
    }

    // Filter to PS with >= minUsers
    const eligiblePS = Array.from(psToUsers.entries())
      .filter(([_, users]) => users.size >= minUsers)
      .map(([psId, _]) => psId);

    // Get full names for eligible PS
    const psFullNames = new Map();
    for (const psId of eligiblePS) {
      const row = db.prepare('SELECT full_name FROM permission_sets WHERE id = ?').get(psId);
      if (row) psFullNames.set(psId, row.full_name);
    }

    // Get existing active PSG memberships to avoid duplicates
    const existingPSGPairs = new Set();
    const activePSGs = db.prepare(`
      SELECT id FROM permission_set_groups WHERE status = 'Updated'
    `).all();

    for (const { id } of activePSGs) {
      const members = db.prepare(`
        SELECT ps_id FROM psg_members WHERE psg_id = ?
      `).all(id).map(row => row.ps_id);

      // Store all pairs in this PSG
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pair = [members[i], members[j]].sort().join('::');
          existingPSGPairs.add(pair);
        }
      }
    }

    // Calculate co-occurrence for all PS pairs
    const coOccurrences = [];
    for (let i = 0; i < eligiblePS.length; i++) {
      for (let j = i + 1; j < eligiblePS.length; j++) {
        const psA = eligiblePS[i];
        const psB = eligiblePS[j];

        // Check if pair already in active PSG
        const pairKey = [psA, psB].sort().join('::');
        if (existingPSGPairs.has(pairKey)) continue;

        const usersA = psToUsers.get(psA);
        const usersB = psToUsers.get(psB);

        const sharedUsers = setIntersection(usersA, usersB).size;
        const percentageA = sharedUsers / usersA.size;
        const percentageB = sharedUsers / usersB.size;

        // Either percentage >= threshold
        if (percentageA >= coAssignmentThreshold || percentageB >= coAssignmentThreshold) {
          coOccurrences.push({
            psA,
            psB,
            sharedUsers,
            percentageA,
            percentageB,
            maxPercentage: Math.max(percentageA, percentageB)
          });
        }
      }
    }

    // Complete-linkage clustering
    const clusters = [];
    const clustered = new Set();

    // Sort by maxPercentage descending to prioritize strong relationships
    coOccurrences.sort((a, b) => b.maxPercentage - a.maxPercentage);

    for (const occurrence of coOccurrences) {
      const { psA, psB } = occurrence;

      // Try to add to existing cluster (must co-occur with ALL members)
      let addedToCluster = false;
      for (const cluster of clusters) {
        let coOccursWithAll = true;

        for (const memberPS of cluster) {
          if (memberPS === psA || memberPS === psB) {
            coOccursWithAll = false;
            break;
          }

          // Check if psA and psB both co-occur with memberPS
          const usersA = psToUsers.get(psA);
          const usersB = psToUsers.get(psB);
          const usersMember = psToUsers.get(memberPS);

          const sharedA = setIntersection(usersA, usersMember).size;
          const sharedB = setIntersection(usersB, usersMember).size;

          const percentageA = sharedA / usersA.size;
          const percentageB = sharedB / usersB.size;
          const percentageMemberA = sharedA / usersMember.size;
          const percentageMemberB = sharedB / usersMember.size;

          const coOccursA = percentageA >= coAssignmentThreshold || percentageMemberA >= coAssignmentThreshold;
          const coOccursB = percentageB >= coAssignmentThreshold || percentageMemberB >= coAssignmentThreshold;

          if (!coOccursA || !coOccursB) {
            coOccursWithAll = false;
            break;
          }
        }

        if (coOccursWithAll) {
          if (!cluster.includes(psA)) cluster.push(psA);
          if (!cluster.includes(psB)) cluster.push(psB);
          clustered.add(psA);
          clustered.add(psB);
          addedToCluster = true;
          break;
        }
      }

      // If not added to existing cluster, create new cluster
      if (!addedToCluster && !clustered.has(psA) && !clustered.has(psB)) {
        clusters.push([psA, psB]);
        clustered.add(psA);
        clustered.add(psB);
      }
    }

    // Format recommendations
    const recommendations = clusters.map(cluster => ({
      pattern: 'co_assignment',
      members: cluster.map(psId => psFullNames.get(psId) || psId),
      member_count: cluster.length,
      estimated_reduction: cluster.length - 1
    }));

    return {
      type: 'co_assignment_recommendations',
      recommendations,
      summary: {
        total_recommendations: recommendations.length
      }
    };

  } finally {
    db.close();
  }
}

/**
 * Orchestrates all PSG recommendation strategies
 * @param {string} dbPath - Path to SQLite database
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Combined recommendations from all strategies
 */
export async function recommendAllPSGs(dbPath, options = {}) {
  const results = {
    hierarchical: null,
    coAssignment: null
  };

  try {
    results.hierarchical = await recommendHierarchicalPSGs(dbPath);
  } catch (error) {
    results.hierarchical = { error: error.message };
  }

  try {
    results.coAssignment = await recommendCoAssignmentPSGs(dbPath, options);
  } catch (error) {
    results.coAssignment = { error: error.message };
  }

  return results;
}
