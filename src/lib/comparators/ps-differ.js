// Permission Set cross-org diff comparator.
// Uses in-memory Maps for comparison to preserve read-only database access (ref: DL-002).

import Database from 'better-sqlite3';

/**
 * Compares permission sets across orgs and returns operations representing source→target changes.
 * @param {string} sourceDbPath - Source org database path (read-only)
 * @param {string} targetDbPath - Target org database path (read-only)
 * @returns {Promise<Array>} Array of operation objects {operation, entity_type, entity_id, details}
 */
export async function diffPermissionSets(sourceDbPath, targetDbPath) {
  const sourceDb = new Database(sourceDbPath, { readonly: true });
  const targetDb = new Database(targetDbPath, { readonly: true });

  try {
    const changes = [];

    const sourcePSQuery = sourceDb.prepare(`
      SELECT id, full_name, label, license
      FROM permission_sets
      WHERE is_owned_by_profile = 0 OR is_owned_by_profile IS NULL
    `);
    const sourcePS = sourcePSQuery.all();

    // Exclude profile-owned PS: prevents migration of permissions owned by profiles (ref: constraint)
    const targetPSQuery = targetDb.prepare(`
      SELECT id, full_name, label, license
      FROM permission_sets
      WHERE is_owned_by_profile = 0 OR is_owned_by_profile IS NULL
    `);
    const targetPS = targetPSQuery.all();

    const targetPSMap = new Map(targetPS.map(ps => [ps.full_name, ps]));

    // Permission tuples loaded for set comparison: type::name::value format enables Set.has() lookups (ref: constraint)
    const sourcePermsQuery = sourceDb.prepare(`
      SELECT permission_type, permission_name, permission_value
      FROM permissions
      WHERE source_id = ? AND source_type = 'PermissionSet'
    `);
    const targetPermsQuery = targetDb.prepare(`
      SELECT permission_type, permission_name, permission_value
      FROM permissions
      WHERE source_id = ? AND source_type = 'PermissionSet'
    `);

    for (const sourceSet of sourcePS) {
      const targetSet = targetPSMap.get(sourceSet.full_name);

      if (!targetSet) {
        changes.push({
          operation: 'CREATE_PS',
          entity_type: 'PermissionSet',
          entity_id: sourceSet.full_name,
          details: { label: sourceSet.label, license: sourceSet.license },
        });
        continue;
      }

      if (sourceSet.label !== targetSet.label || sourceSet.license !== targetSet.license) {
        changes.push({
          operation: 'MODIFY_PS',
          entity_type: 'PermissionSet',
          entity_id: sourceSet.full_name,
          details: {
            label: sourceSet.label !== targetSet.label ? sourceSet.label : undefined,
            license: sourceSet.license !== targetSet.license ? sourceSet.license : undefined,
          },
        });
      }

      const sourcePerms = sourcePermsQuery.all(sourceSet.full_name);
      const targetPerms = targetPermsQuery.all(sourceSet.full_name);

      // Set operations require type::name::value tuple format (ref: constraint - permission tuples for set operations)
      const sourceTuples = new Set(sourcePerms.map(p => `${p.permission_type}::${p.permission_name}::${p.permission_value}`));
      const targetTuples = new Set(targetPerms.map(p => `${p.permission_type}::${p.permission_name}::${p.permission_value}`));

      for (const tuple of sourceTuples) {
        if (!targetTuples.has(tuple)) {
          const [type, name, value] = tuple.split('::');
          changes.push({
            operation: 'ADD_PERMISSION',
            entity_type: 'PermissionSet',
            entity_id: sourceSet.full_name,
            details: { permission_type: type, permission_name: name, permission_value: value },
          });
        }
      }

      for (const tuple of targetTuples) {
        if (!sourceTuples.has(tuple)) {
          const [type, name, value] = tuple.split('::');
          changes.push({
            operation: 'REMOVE_PERMISSION',
            entity_type: 'PermissionSet',
            entity_id: sourceSet.full_name,
            details: { permission_type: type, permission_name: name, permission_value: value },
          });
        }
      }
    }

    return changes;
  } finally {
    sourceDb.close();
    targetDb.close();
  }
}
