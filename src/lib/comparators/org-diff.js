import Database from 'better-sqlite3';
import path from 'node:path';
import { diffPermissionSets } from './ps-differ.js';
import { diffPSGs } from './psg-differ.js';

export async function compareOrgs(sourceDbPath, targetDbPath, options = {}) {
  const include = options.include || ['ps', 'psg'];
  const filter = options.filter;

  let allChanges = [];

  if (include.includes('ps')) {
    const psChanges = await diffPermissionSets(sourceDbPath, targetDbPath);
    allChanges = allChanges.concat(psChanges);
  }

  if (include.includes('psg')) {
    const psgChanges = await diffPSGs(sourceDbPath, targetDbPath);
    allChanges = allChanges.concat(psgChanges);
  }

  if (filter) {
    const filterRegex = new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*'));
    allChanges = allChanges.filter(change => filterRegex.test(change.entity_id));
  }

  const byOperation = {};
  for (const change of allChanges) {
    byOperation[change.operation] = (byOperation[change.operation] || 0) + 1;
  }

  let sourceOrg = options.sourceOrg || sourceDbPath;
  let targetOrg = options.targetOrg || targetDbPath;

  if (!options.sourceOrg || !options.targetOrg) {
    const sourceDb = new Database(sourceDbPath, { readonly: true });
    const targetDb = new Database(targetDbPath, { readonly: true });

    try {
      const sourceOrgQuery = sourceDb.prepare("SELECT DISTINCT source_id FROM permissions WHERE source_type = 'PermissionSet' LIMIT 1");
      const targetOrgQuery = targetDb.prepare("SELECT DISTINCT source_id FROM permissions WHERE source_type = 'PermissionSet' LIMIT 1");

      const sourceRow = sourceOrgQuery.get();
      const targetRow = targetOrgQuery.get();

      if (!options.sourceOrg && sourceRow) sourceOrg = sourceDbPath.split(path.sep).slice(-2, -1)[0] || sourceDbPath;
      if (!options.targetOrg && targetRow) targetOrg = targetDbPath.split(path.sep).slice(-2, -1)[0] || targetDbPath;
    } catch {
      // Fallback to dbPath
    } finally {
      try {
        sourceDb.close();
      } catch {
        // Ignore close errors
      }
      try {
        targetDb.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  return {
    source_org: sourceOrg,
    target_org: targetOrg,
    summary: {
      total_changes: allChanges.length,
      by_operation: byOperation,
    },
    changes: allChanges,
  };
}
