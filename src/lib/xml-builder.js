import Database from 'better-sqlite3';
import { XMLBuilder } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressEmptyNode: true,
});

export async function buildPermissionSetXml(dbPath, entityId, operations) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const ps = db.prepare('SELECT * FROM permission_sets WHERE full_name = ?').get(entityId);

    const isCreateOp = operations.some(op => op.operation === 'CREATE_PS');
    if (!ps && !isCreateOp) {
      throw new Error(`PermissionSet ${entityId} not found in database`);
    }

    let perms = [];
    if (ps) {
      perms = db.prepare(`
        SELECT permission_type, permission_name, permission_value
        FROM permissions
        WHERE source_id = ? AND source_type = 'PermissionSet'
      `).all(entityId);
    }

    const permSet = new Set(perms.map(p => `${p.permission_type}::${p.permission_name}::${p.permission_value}`));

    for (const op of operations) {
      if (op.operation === 'ADD_PERMISSION') {
        const params = JSON.parse(op.parameters);
        permSet.add(`${params.permission_type}::${params.permission_name}::${params.permission_value}`);
      } else if (op.operation === 'REMOVE_PERMISSION') {
        const params = JSON.parse(op.parameters);
        permSet.delete(`${params.permission_type}::${params.permission_name}::${params.permission_value}`);
      }
    }

    perms = Array.from(permSet).map(tuple => {
      const [type, name, value] = tuple.split('::');
      return { permission_type: type, permission_name: name, permission_value: value };
    });

    const permissionSet = {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
      label: ps?.label || entityId,
    };

    if (ps?.license) permissionSet.license = ps.license;

    const grouped = groupPermissions(perms);

    if (grouped.objectPermissions.length > 0) {
      permissionSet.objectPermissions = grouped.objectPermissions;
    }
    if (grouped.fieldPermissions.length > 0) {
      permissionSet.fieldPermissions = grouped.fieldPermissions;
    }
    if (grouped.userPermissions.length > 0) {
      permissionSet.userPermissions = grouped.userPermissions;
    }
    if (grouped.customPermissions.length > 0) {
      permissionSet.customPermissions = grouped.customPermissions;
    }
    if (grouped.applicationVisibilities.length > 0) {
      permissionSet.applicationVisibilities = grouped.applicationVisibilities;
    }
    if (grouped.classAccesses.length > 0) {
      permissionSet.classAccesses = grouped.classAccesses;
    }
    if (grouped.pageAccesses.length > 0) {
      permissionSet.pageAccesses = grouped.pageAccesses;
    }
    if (grouped.tabSettings.length > 0) {
      permissionSet.tabSettings = grouped.tabSettings;
    }
    if (grouped.recordTypeVisibilities.length > 0) {
      permissionSet.recordTypeVisibilities = grouped.recordTypeVisibilities;
    }
    if (grouped.customMetadataTypeAccesses.length > 0) {
      permissionSet.customMetadataTypeAccesses = grouped.customMetadataTypeAccesses;
    }

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build({ PermissionSet: permissionSet });
    const filename = `${entityId}.permissionset-meta.xml`;

    return { xml, filename };
  } finally {
    db.close();
  }
}

export async function buildPermissionSetGroupXml(dbPath, entityId, operations) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const psg = db.prepare('SELECT * FROM permission_set_groups WHERE full_name = ?').get(entityId);

    const isCreateOp = operations.some(op => op.operation === 'CREATE_PSG');
    if (!psg && !isCreateOp) {
      throw new Error(`PermissionSetGroup ${entityId} not found in database`);
    }

    let members = [];
    if (psg) {
      members = db.prepare(`
        SELECT ps_id FROM psg_members WHERE psg_id = ?
      `).all(entityId).map(m => m.ps_id);
    }

    const memberSet = new Set(members);

    for (const op of operations) {
      if (op.operation === 'ADD_PSG_MEMBER') {
        const params = JSON.parse(op.parameters);
        memberSet.add(params.member_id);
      } else if (op.operation === 'REMOVE_PSG_MEMBER') {
        const params = JSON.parse(op.parameters);
        memberSet.delete(params.member_id);
      }
    }

    const permissionSetGroup = {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
      label: psg?.label || entityId,
      permissionSets: Array.from(memberSet),
    };

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build({ PermissionSetGroup: permissionSetGroup });
    const filename = `${entityId}.permissionsetgroup-meta.xml`;

    return { xml, filename };
  } finally {
    db.close();
  }
}

export async function exportPlanToDirectory(dbPath, planId, outputDir) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const ops = db.prepare('SELECT * FROM plan_operations WHERE plan_id = ? ORDER BY execution_order, id').all(planId);

    const byEntity = {};
    for (const op of ops) {
      const key = `${op.entity_type}::${op.entity_id}`;
      if (!byEntity[key]) byEntity[key] = [];
      byEntity[key].push(op);
    }

    for (const [key, operations] of Object.entries(byEntity)) {
      const [entityType, entityId] = key.split('::');

      let result;
      if (entityType === 'PermissionSet') {
        result = await buildPermissionSetXml(dbPath, entityId, operations);
        const dir = path.join(outputDir, 'permissionsets');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, result.filename), result.xml, 'utf-8');
      } else if (entityType === 'PermissionSetGroup') {
        result = await buildPermissionSetGroupXml(dbPath, entityId, operations);
        const dir = path.join(outputDir, 'permissionsetgroups');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, result.filename), result.xml, 'utf-8');
      }
    }
  } finally {
    db.close();
  }
}

function groupPermissions(perms) {
  const objectPermissions = [];
  const fieldPermissions = [];
  const userPermissions = [];
  const customPermissions = [];
  const applicationVisibilities = [];
  const classAccesses = [];
  const pageAccesses = [];
  const tabSettings = [];
  const recordTypeVisibilities = [];
  const customMetadataTypeAccesses = [];

  const objPermsMap = {};

  for (const p of perms) {
    if (p.permission_type === 'ObjectPermission') {
      const [objName, perm] = p.permission_name.split('.');
      if (!objPermsMap[objName]) {
        objPermsMap[objName] = { object: objName };
      }
      if (perm === 'Create') objPermsMap[objName].allowCreate = p.permission_value === 'true';
      if (perm === 'Read') objPermsMap[objName].allowRead = p.permission_value === 'true';
      if (perm === 'Edit') objPermsMap[objName].allowEdit = p.permission_value === 'true';
      if (perm === 'Delete') objPermsMap[objName].allowDelete = p.permission_value === 'true';
      if (perm === 'ViewAll') objPermsMap[objName].viewAllRecords = p.permission_value === 'true';
      if (perm === 'ModifyAll') objPermsMap[objName].modifyAllRecords = p.permission_value === 'true';
    } else if (p.permission_type === 'FieldPermission') {
      const editable = p.permission_value === 'Edit';
      const readable = p.permission_value === 'Edit' || p.permission_value === 'Read';
      fieldPermissions.push({ field: p.permission_name, editable, readable });
    } else if (p.permission_type === 'UserPermission') {
      userPermissions.push({ name: p.permission_name, enabled: p.permission_value === 'true' });
    } else if (p.permission_type === 'CustomPermission') {
      customPermissions.push({ name: p.permission_name, enabled: p.permission_value === 'true' });
    } else if (p.permission_type === 'ApplicationVisibility') {
      applicationVisibilities.push({ application: p.permission_name, visible: p.permission_value === 'visible' });
    } else if (p.permission_type === 'ApexClassAccess') {
      classAccesses.push({ apexClass: p.permission_name.replace('ApexClass:', ''), enabled: p.permission_value === 'true' });
    } else if (p.permission_type === 'PageAccess') {
      pageAccesses.push({ apexPage: p.permission_name.replace('ApexPage:', ''), enabled: p.permission_value === 'true' });
    } else if (p.permission_type === 'TabSetting') {
      tabSettings.push({ tab: p.permission_name, visibility: p.permission_value });
    } else if (p.permission_type === 'RecordTypeVisibility') {
      const flags = p.permission_value.split(',');
      recordTypeVisibilities.push({
        recordType: p.permission_name,
        visible: flags.includes('visible'),
        default: flags.includes('default'),
      });
    } else if (p.permission_type === 'CustomMetadataTypeAccess') {
      customMetadataTypeAccesses.push({ name: p.permission_name, enabled: p.permission_value === 'true' });
    }
  }

  for (const obj of Object.values(objPermsMap)) {
    objectPermissions.push(obj);
  }

  return {
    objectPermissions,
    fieldPermissions,
    userPermissions,
    customPermissions,
    applicationVisibilities,
    classAccesses,
    pageAccesses,
    tabSettings,
    recordTypeVisibilities,
    customMetadataTypeAccesses,
  };
}
