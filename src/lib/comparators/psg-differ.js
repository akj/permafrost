import Database from 'better-sqlite3';

export async function diffPSGs(sourceDbPath, targetDbPath) {
  const sourceDb = new Database(sourceDbPath, { readonly: true });
  const targetDb = new Database(targetDbPath, { readonly: true });

  try {
    const changes = [];

    const sourcePSGQuery = sourceDb.prepare(`
      SELECT id, full_name, label, status
      FROM permission_set_groups
      WHERE status = 'Updated'
    `);
    const sourcePSGs = sourcePSGQuery.all();

    const targetPSGQuery = targetDb.prepare(`
      SELECT id, full_name, label, status
      FROM permission_set_groups
      WHERE status = 'Updated'
    `);
    const targetPSGs = targetPSGQuery.all();

    const targetPSGMap = new Map(targetPSGs.map(psg => [psg.full_name, psg]));

    const sourceMembersQuery = sourceDb.prepare(`
      SELECT ps.full_name
      FROM psg_members m
      JOIN permission_sets ps ON m.ps_id = ps.id
      WHERE m.psg_id = ?
    `);
    const targetMembersQuery = targetDb.prepare(`
      SELECT ps.full_name
      FROM psg_members m
      JOIN permission_sets ps ON m.ps_id = ps.id
      WHERE m.psg_id = ?
    `);

    for (const sourcePSG of sourcePSGs) {
      const targetPSG = targetPSGMap.get(sourcePSG.full_name);

      if (!targetPSG) {
        changes.push({
          operation: 'CREATE_PSG',
          entity_type: 'PermissionSetGroup',
          entity_id: sourcePSG.full_name,
          details: { label: sourcePSG.label },
        });

        const members = sourceMembersQuery.all(sourcePSG.full_name);
        for (const member of members) {
          changes.push({
            operation: 'ADD_PSG_MEMBER',
            entity_type: 'PermissionSetGroup',
            entity_id: sourcePSG.full_name,
            details: { member_id: member.full_name },
          });
        }
        continue;
      }

      if (sourcePSG.label !== targetPSG.label) {
        changes.push({
          operation: 'MODIFY_PSG',
          entity_type: 'PermissionSetGroup',
          entity_id: sourcePSG.full_name,
          details: { label: sourcePSG.label },
        });
      }

      const sourceMembers = new Set(sourceMembersQuery.all(sourcePSG.full_name).map(m => m.full_name));
      const targetMembers = new Set(targetMembersQuery.all(targetPSG.full_name).map(m => m.full_name));

      for (const member of sourceMembers) {
        if (!targetMembers.has(member)) {
          changes.push({
            operation: 'ADD_PSG_MEMBER',
            entity_type: 'PermissionSetGroup',
            entity_id: sourcePSG.full_name,
            details: { member_id: member },
          });
        }
      }

      for (const member of targetMembers) {
        if (!sourceMembers.has(member)) {
          changes.push({
            operation: 'REMOVE_PSG_MEMBER',
            entity_type: 'PermissionSetGroup',
            entity_id: sourcePSG.full_name,
            details: { member_id: member },
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
