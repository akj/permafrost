import { EXECUTION_ORDER_MAP } from './planner.js';

export function transformDiffToOperations(diffJson) {
  if (!diffJson) {
    throw new Error('Input cannot be null or undefined');
  }
  if (!diffJson.changes) {
    throw new Error('Invalid diff format: missing changes array');
  }

  if (diffJson.changes.length === 0) {
    return [];
  }

  return diffJson.changes.map(change => ({
    operation: change.operation,
    entity_type: change.entity_type,
    entity_id: change.entity_id,
    parameters: JSON.stringify(change.details),
    execution_order: EXECUTION_ORDER_MAP[change.operation],
    source_type: 'diff',
    source_json: JSON.stringify(change),
    status: 'pending',
  }));
}

export function transformRecommendationsToOperations(recJson) {
  if (!recJson) {
    throw new Error('Input cannot be null or undefined');
  }
  if (!recJson.hierarchical && !recJson.coAssignment) {
    throw new Error('Invalid recommendation format: missing hierarchical or coAssignment key');
  }

  const operations = [];

  if (recJson.hierarchical) {
    for (const rec of recJson.hierarchical.recommendations) {
      const psgName = rec.recommendedPSG.name;

      operations.push({
        operation: 'CREATE_PSG',
        entity_type: 'PermissionSetGroup',
        entity_id: psgName,
        parameters: JSON.stringify({ label: rec.recommendedPSG.label || psgName }),
        execution_order: EXECUTION_ORDER_MAP.CREATE_PSG,
        source_type: 'recommendation',
        source_json: JSON.stringify(rec),
        status: 'pending',
      });

      for (const member of rec.recommendedPSG.members) {
        operations.push({
          operation: 'ADD_PSG_MEMBER',
          entity_type: 'PermissionSetGroup',
          entity_id: psgName,
          parameters: JSON.stringify({ member_id: member }),
          execution_order: EXECUTION_ORDER_MAP.ADD_PSG_MEMBER,
          source_type: 'recommendation',
          source_json: JSON.stringify(rec),
          status: 'pending',
        });
      }
    }
  }

  if (recJson.coAssignment) {
    for (const rec of recJson.coAssignment.recommendations) {
      const psgName = `CoAssignment_${rec.members[0]}_${rec.members.length}`;

      operations.push({
        operation: 'CREATE_PSG',
        entity_type: 'PermissionSetGroup',
        entity_id: psgName,
        parameters: JSON.stringify({ label: psgName }),
        execution_order: EXECUTION_ORDER_MAP.CREATE_PSG,
        source_type: 'recommendation',
        source_json: JSON.stringify(rec),
        status: 'pending',
      });

      for (const member of rec.members) {
        operations.push({
          operation: 'ADD_PSG_MEMBER',
          entity_type: 'PermissionSetGroup',
          entity_id: psgName,
          parameters: JSON.stringify({ member_id: member }),
          execution_order: EXECUTION_ORDER_MAP.ADD_PSG_MEMBER,
          source_type: 'recommendation',
          source_json: JSON.stringify(rec),
          status: 'pending',
        });
      }
    }
  }

  return operations;
}

export function transformRedundancyToOperations(redundancyJson) {
  if (!redundancyJson) {
    throw new Error('Input cannot be null or undefined');
  }

  const operations = [];

  if (redundancyJson.profile_ps_redundancy && redundancyJson.profile_ps_redundancy.details) {
    for (const detail of redundancyJson.profile_ps_redundancy.details) {
      for (const ps of detail.permission_sets || []) {
        operations.push({
          operation: 'REMOVE_PERMISSION',
          entity_type: 'PermissionSet',
          entity_id: ps,
          parameters: JSON.stringify({ permission_name: detail.permission_name, permission_value: detail.permission_value }),
          execution_order: EXECUTION_ORDER_MAP.REMOVE_PERMISSION,
          source_type: 'recommendation',
          source_json: JSON.stringify(detail),
          status: 'pending',
        });
      }
    }
  }

  return operations;
}
