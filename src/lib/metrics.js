/**
 * metrics.js - Permission Set Similarity Metrics
 *
 * Pure utility module for calculating set-based similarity metrics.
 * No database access (DL-006).
 *
 * Set elements use `name::value` tuple format (DL-014):
 * - 'Account.Industry::Edit'
 * - 'ManageUsers::true'
 * - 'Account.Create::null' (ObjectPermissions with null value)
 */

/**
 * Calculates Jaccard similarity coefficient between two sets.
 * J(A,B) = |A ∩ B| / |A ∪ B|
 *
 * @param {Set|Array} setA - First set of permissions
 * @param {Set|Array} setB - Second set of permissions
 * @returns {number} Similarity score from 0.0 to 1.0
 */
export function calculateJaccardSimilarity(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);

  // Empty sets have no similarity
  if (a.size === 0 && b.size === 0) {
    return 0.0;
  }

  const intersection = setIntersection(a, b);
  const unionSize = a.size + b.size - intersection.size;

  return unionSize === 0 ? 0.0 : intersection.size / unionSize;
}

/**
 * Calculates overlap percentage between two sets.
 * Overlap(A,B) = |A ∩ B| / min(|A|, |B|)
 *
 * Indicates subset relationship: returns 1.0 when smaller set is fully contained.
 *
 * @param {Set|Array} setA - First set of permissions
 * @param {Set|Array} setB - Second set of permissions
 * @returns {number} Overlap percentage from 0.0 to 1.0
 */
export function calculateOverlapPercentage(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);

  // Cannot compute overlap with empty set
  if (a.size === 0 || b.size === 0) {
    return 0.0;
  }

  const intersection = setIntersection(a, b);
  const minSize = Math.min(a.size, b.size);

  return intersection.size / minSize;
}

/**
 * Calculates average number of assignments per user (complexity score).
 *
 * @param {number} totalAssignments - Total permission set assignments
 * @param {number} totalUsers - Total number of users
 * @returns {number} Average assignments per user (0 if no users)
 */
export function calculateComplexityScore(totalAssignments, totalUsers) {
  return totalUsers === 0 ? 0 : totalAssignments / totalUsers;
}

/**
 * Returns intersection of two sets (elements in both A and B).
 *
 * @param {Set|Array} setA - First set
 * @param {Set|Array} setB - Second set
 * @returns {Set} New set containing common elements
 */
export function setIntersection(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  const result = new Set();

  for (const elem of a) {
    if (b.has(elem)) {
      result.add(elem);
    }
  }

  return result;
}

/**
 * Returns difference of two sets (elements in A but not in B).
 *
 * @param {Set|Array} setA - First set
 * @param {Set|Array} setB - Second set
 * @returns {Set} New set containing elements only in A
 */
export function setDifference(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  const result = new Set();

  for (const elem of a) {
    if (!b.has(elem)) {
      result.add(elem);
    }
  }

  return result;
}
