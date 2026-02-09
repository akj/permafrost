import { withReadonlyDatabase } from '../database.js';
import { calculateJaccardSimilarity, calculateOverlapPercentage, setIntersection, setDifference } from '../metrics.js';

/**
 * Get all non-profile-owned Permission Sets with their permissions
 * @param {Database} db - SQLite database instance
 * @returns {Array<{id: string, label: string, permissions: Set<string>}>}
 */
function getPermissionSetsWithPermissions(db) {
  const query = `
    SELECT
      p.source_id,
      ps.label,
      p.permission_name,
      p.permission_value
    FROM permissions p
    INNER JOIN permission_sets ps ON p.source_id = ps.full_name
    WHERE p.source_type = 'PermissionSet'
      AND (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
    ORDER BY p.source_id
  `;

  const rows = db.prepare(query).all();
  const psMap = new Map();

  for (const row of rows) {
    if (!psMap.has(row.source_id)) {
      psMap.set(row.source_id, {
        id: row.source_id,
        label: row.label || row.source_id,
        permissions: new Set(),
      });
    }
    const permTuple = `${row.permission_name}::${row.permission_value}`;
    psMap.get(row.source_id).permissions.add(permTuple);
  }

  return Array.from(psMap.values());
}

/**
 * Get user assignment counts per Permission Set
 * @param {Database} db - SQLite database instance
 * @returns {Object} Map of assignee_id -> user_count
 */
function getUserCountsForPS(db) {
  const query = `
    SELECT
      assignee_id,
      COUNT(DISTINCT user_id) as user_count
    FROM user_assignments
    WHERE assignee_type = 'PermissionSet'
    GROUP BY assignee_id
  `;

  const rows = db.prepare(query).all();
  const counts = {};
  for (const row of rows) {
    counts[row.assignee_id] = row.user_count;
  }
  return counts;
}

/**
 * Analyze overlap between Permission Sets
 * Excludes profile-owned PS (DL-011)
 * Uses permission_name::permission_value tuples (DL-014)
 * Implements large org safety filter (DL-003)
 *
 * @param {string} dbPath - Path to SQLite database
 * @param {Object} options - Analysis options
 * @param {number} options.threshold - Minimum Jaccard similarity to report (default 0.5)
 * @param {number} options.largeOrgThreshold - PS count threshold for large org filter (default 500)
 * @param {number} options.minUsers - Minimum user assignments for large org filter (default 1)
 * @returns {Promise<Object>} Analysis results with pairs sorted by Jaccard similarity
 */
export async function analyzePermissionSetOverlap(dbPath, options = {}) {
  const {
    threshold = 0.5,
    largeOrgThreshold = 500,
    minUsers = 1,
  } = options;

  return withReadonlyDatabase(dbPath, (db) => {
    let psWithPerms = getPermissionSetsWithPermissions(db);

    if (psWithPerms.length === 0) {
      return {
        type: 'overlap_analysis',
        summary: {
          total_comparisons: 0,
          high_overlap_pairs: 0,
          threshold,
        },
        pairs: [],
      };
    }

    if (psWithPerms.length > largeOrgThreshold) {
      const userCounts = getUserCountsForPS(db);
      psWithPerms = psWithPerms.filter(ps => {
        const count = userCounts[ps.id] || 0;
        return count >= minUsers;
      });

      if (psWithPerms.length === 0) {
        return {
          type: 'overlap_analysis',
          summary: {
            total_comparisons: 0,
            high_overlap_pairs: 0,
            threshold,
          },
          pairs: [],
        };
      }
    }

    const pairs = [];
    let totalComparisons = 0;

    for (let i = 0; i < psWithPerms.length; i++) {
      for (let j = i + 1; j < psWithPerms.length; j++) {
        totalComparisons++;

        const psA = psWithPerms[i];
        const psB = psWithPerms[j];

        const jaccard = calculateJaccardSimilarity(psA.permissions, psB.permissions);

        if (jaccard >= threshold) {
          const overlapA = calculateOverlapPercentage(psA.permissions, psB.permissions);
          const shared = setIntersection(psA.permissions, psB.permissions);
          const uniqueA = setDifference(psA.permissions, psB.permissions);
          const uniqueB = setDifference(psB.permissions, psA.permissions);

          pairs.push({
            permission_set_a: {
              id: psA.id,
              name: psA.label,
              permission_count: psA.permissions.size,
            },
            permission_set_b: {
              id: psB.id,
              name: psB.label,
              permission_count: psB.permissions.size,
            },
            metrics: {
              jaccard_similarity: Math.round(jaccard * 1000) / 1000,
              overlap_percentage: Math.round(overlapA * 1000) / 1000,
              shared_permissions: shared.size,
              unique_to_a: uniqueA.size,
              unique_to_b: uniqueB.size,
            },
          });
        }
      }
    }

    pairs.sort((a, b) => b.metrics.jaccard_similarity - a.metrics.jaccard_similarity);

    return {
      type: 'overlap_analysis',
      summary: {
        total_comparisons: totalComparisons,
        high_overlap_pairs: pairs.length,
        threshold,
      },
      pairs,
    };
  });
}
