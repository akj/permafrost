import { withReadonlyDatabase } from '../database.js';

/**
 * Analyzes all permission sources that grant access to a specific Salesforce object.
 * Excludes profile-owned permission sets per DL-011.
 *
 * @param {string} dbPath - Path to SQLite database
 * @param {string} objectName - Salesforce object name (e.g., 'Account', 'Opportunity')
 * @returns {Promise<Object>} Analysis result with sources, permissions, and user counts
 */
export async function analyzeObjectAccess(dbPath, objectName) {
  return withReadonlyDatabase(dbPath, (db) => {
    // Query all permissions for this object, excluding profile-owned PS
    const permissions = db.prepare(`
      SELECT
        p.source_type,
        p.source_id,
        p.permission_type,
        p.permission_name,
        p.permission_value
      FROM permissions p
      LEFT JOIN permission_sets ps ON p.source_type = 'PermissionSet' AND p.source_id = ps.full_name
      WHERE (p.permission_name LIKE ? OR p.permission_name = ?)
        AND (p.source_type = 'Profile' OR ps.is_owned_by_profile IS NULL OR ps.is_owned_by_profile = 0)
      ORDER BY p.source_type, p.source_id, p.permission_type, p.permission_name
    `).all(`${objectName}.%`, objectName);

    // Group by source
    const sourceMap = new Map();

    for (const perm of permissions) {
      const key = `${perm.source_type}:${perm.source_id}`;

      if (!sourceMap.has(key)) {
        sourceMap.set(key, {
          source_type: perm.source_type,
          source_id: perm.source_id,
          source_name: null,
          object_permissions: [],
          field_permissions: [],
          user_count: 0,
          via_psg: null,
        });
      }

      const source = sourceMap.get(key);

      if (perm.permission_type === 'ObjectPermission') {
        source.object_permissions.push({
          permission: perm.permission_name,
          value: perm.permission_value,
        });
      } else if (perm.permission_type === 'FieldPermission') {
        source.field_permissions.push({
          permission: perm.permission_name,
          value: perm.permission_value,
        });
      }
    }

    // Enrich sources with labels and user counts
    const sources = [];

    for (const [, source] of sourceMap.entries()) {
      // Get source label
      if (source.source_type === 'Profile') {
        const profile = db.prepare(`
          SELECT full_name FROM profiles WHERE full_name = ?
        `).get(source.source_id);
        source.source_name = profile ? profile.full_name : source.source_id;
      } else {
        const ps = db.prepare(`
          SELECT label, full_name FROM permission_sets WHERE full_name = ?
        `).get(source.source_id);
        source.source_name = ps ? (ps.label || ps.full_name) : source.source_id;
      }

      // Get user count
      const assigneeType = source.source_type === 'Profile' ? 'Profile' : 'PermissionSet';
      const userCount = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as count
        FROM user_assignments
        WHERE assignee_type = ? AND assignee_id = ?
      `).get(assigneeType, source.source_id);
      source.user_count = userCount ? userCount.count : 0;

      // For PS sources, check if included in active PSGs
      if (source.source_type === 'PermissionSet') {
        const psgs = db.prepare(`
          SELECT psg.id, psg.label, psg.full_name
          FROM psg_members pm
          JOIN permission_set_groups psg ON pm.psg_id = psg.full_name
          WHERE pm.ps_id = ? AND psg.status = 'Updated'
        `).all(source.source_id);

        if (psgs.length > 0) {
          source.via_psg = psgs.map(psg => ({
            id: psg.full_name,
            label: psg.label || psg.full_name,
          }));
        }
      }

      sources.push(source);
    }

    // Calculate summary
    const profileCount = sources.filter(s => s.source_type === 'Profile').length;
    const psCount = sources.filter(s => s.source_type === 'PermissionSet').length;
    const totalUsers = sources.reduce((sum, s) => sum + s.user_count, 0);

    return {
      type: 'object_access_analysis',
      object: objectName,
      sources,
      summary: {
        total_sources: sources.length,
        total_profiles: profileCount,
        total_permission_sets: psCount,
        estimated_users_with_access: totalUsers,
      },
    };
  });
}

/**
 * Lists all unique Salesforce object names that have permissions defined.
 *
 * @param {string} dbPath - Path to SQLite database
 * @returns {Promise<string[]>} Sorted array of object names
 */
export async function listAllObjects(dbPath) {
  return withReadonlyDatabase(dbPath, (db) => {
    const objects = db.prepare(`
      SELECT DISTINCT
        CASE
          WHEN permission_name LIKE '%.%' THEN SUBSTR(permission_name, 1, INSTR(permission_name, '.') - 1)
          ELSE permission_name
        END as object_name
      FROM permissions
      WHERE permission_type IN ('ObjectPermission', 'FieldPermission')
        AND permission_name IS NOT NULL
        AND permission_name != ''
      ORDER BY object_name
    `).all();

    return objects.map(row => row.object_name).filter(name => name && name.length > 0);
  });
}
