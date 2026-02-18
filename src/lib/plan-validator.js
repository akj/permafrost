/**
 * Plan structural validation.
 *
 * Detects duplicates, contradictions, missing entity references, and empty plans. Does not validate cross-entity conflicts
 * or type compatibility (requires org-specific schema knowledge).
 *
 * @see DL-004 Design decision: Structural validation only (no cross-entity or type checks)
 * @see DL-008 Design tradeoff: False positive risk from org-agnostic validation
 */
import Database from 'better-sqlite3';

export async function validatePlan(dbPath, planId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const plan = db.prepare('SELECT id FROM migration_plans WHERE id = ?').get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const errors = [];
    const warnings = [];

    const operations = db.prepare('SELECT * FROM plan_operations WHERE plan_id = ? ORDER BY execution_order, id').all(planId);

    if (operations.length === 0) {
      warnings.push({
        type: 'EMPTY_PLAN',
        severity: 'warning',
        message: 'Plan has no operations',
        operation_ids: [],
        details: {},
      });
    }

    checkDuplicates(operations, errors, warnings);
    checkContradictions(operations, errors);
    checkMissingEntityRefs(db, operations, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } finally {
    db.close();
  }
}

function normalizeParams(params) {
  if (!params) return null;
  const parsed = typeof params === 'string' ? JSON.parse(params) : params;
  const sorted = Object.keys(parsed).sort().reduce((acc, key) => {
    acc[key] = parsed[key];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

function checkDuplicates(operations, errors, warnings) {
  const seen = new Map();

  for (const op of operations) {
    const key = `${op.operation}:${op.entity_type}:${op.entity_id}`;
    if (!seen.has(key)) {
      seen.set(key, []);
    }
    seen.get(key).push(op);
  }

  for (const [key, ops] of seen.entries()) {
    if (ops.length > 1) {
      const paramValues = ops.map(o => normalizeParams(o.parameters));
      const allIdentical = paramValues.every(p => p === paramValues[0]);

      if (allIdentical) {
        errors.push({
          type: 'DUPLICATE_OPERATION',
          severity: 'error',
          message: `Duplicate operation: ${key}`,
          operation_ids: ops.map(o => o.id),
          details: { key },
        });
      } else {
        warnings.push({
          type: 'DUPLICATE_OPERATION_DIFFERENT_PARAMS',
          severity: 'warning',
          message: `Duplicate operation with different parameters: ${key}`,
          operation_ids: ops.map(o => o.id),
          details: { key },
        });
      }
    }
  }
}

function checkContradictions(operations, errors) {
  const addOps = operations.filter(op => op.operation === 'ADD_PERMISSION' || op.operation === 'ADD_PSG_MEMBER');
  const removeOps = operations.filter(op => op.operation === 'REMOVE_PERMISSION' || op.operation === 'REMOVE_PSG_MEMBER');

  for (const addOp of addOps) {
    for (const removeOp of removeOps) {
      if (addOp.entity_type === removeOp.entity_type && addOp.entity_id === removeOp.entity_id) {
        if (addOp.operation === 'ADD_PERMISSION' && removeOp.operation === 'REMOVE_PERMISSION') {
          const addNorm = normalizeParams(addOp.parameters);
          const removeNorm = normalizeParams(removeOp.parameters);

          if (addNorm === removeNorm) {
            errors.push({
              type: 'CONTRADICTORY_PERMISSION',
              severity: 'error',
              message: `Contradictory permission operations on ${addOp.entity_id}: ADD and REMOVE same permission`,
              operation_ids: [addOp.id, removeOp.id],
              details: { entity_id: addOp.entity_id, parameters: JSON.parse(addNorm || '{}') },
            });
          }
        } else if (addOp.operation === 'ADD_PSG_MEMBER' && removeOp.operation === 'REMOVE_PSG_MEMBER') {
          const addNorm = normalizeParams(addOp.parameters);
          const removeNorm = normalizeParams(removeOp.parameters);

          if (addNorm === removeNorm) {
            const addParams = JSON.parse(addNorm || '{}');
            errors.push({
              type: 'CONTRADICTORY_MEMBER',
              severity: 'error',
              message: `Contradictory member operations on ${addOp.entity_id}: ADD and REMOVE same member`,
              operation_ids: [addOp.id, removeOp.id],
              details: { entity_id: addOp.entity_id, member_id: addParams.member_id },
            });
          }
        }
      }
    }
  }
}

/**
 * Check for operations targeting entities not in database and not created by plan.
 *
 * Emits warnings (not errors) because entity may exist in target org but not source database.
 *
 * @param {Database} db - Open database connection
 * @param {Array} operations - Plan operations
 * @param {Array} warnings - Warning accumulator
 *
 * @see RSK-004 Risk: False warnings when migrating to org with entities not in source database
 */
function checkMissingEntityRefs(db, operations, warnings) {
  const psOps = operations.filter(op =>
    (op.operation === 'MODIFY_PS' || op.operation === 'ADD_PERMISSION' || op.operation === 'REMOVE_PERMISSION') &&
    op.entity_type === 'PermissionSet',
  );
  const psgOps = operations.filter(op =>
    (op.operation === 'MODIFY_PSG' || op.operation === 'ADD_PSG_MEMBER' || op.operation === 'REMOVE_PSG_MEMBER') &&
    op.entity_type === 'PermissionSetGroup',
  );

  const createPsIds = new Set(operations.filter(op => op.operation === 'CREATE_PS').map(op => op.entity_id));
  const createPsgIds = new Set(operations.filter(op => op.operation === 'CREATE_PSG').map(op => op.entity_id));

  for (const op of psOps) {
    if (createPsIds.has(op.entity_id)) continue;

    const exists = db.prepare('SELECT id FROM permission_sets WHERE id = ? AND (is_owned_by_profile = 0 OR is_owned_by_profile IS NULL)').get(op.entity_id);
    if (!exists) {
      warnings.push({
        type: 'MISSING_ENTITY_REF',
        severity: 'warning',
        message: `Operation ${op.operation} targets unknown PermissionSet: ${op.entity_id}`,
        operation_ids: [op.id],
        details: { entity_type: 'PermissionSet', entity_id: op.entity_id },
      });
    }
  }

  for (const op of psgOps) {
    if (createPsgIds.has(op.entity_id)) continue;

    const exists = db.prepare('SELECT id FROM permission_set_groups WHERE id = ?').get(op.entity_id);
    if (!exists) {
      warnings.push({
        type: 'MISSING_ENTITY_REF',
        severity: 'warning',
        message: `Operation ${op.operation} targets unknown PermissionSetGroup: ${op.entity_id}`,
        operation_ids: [op.id],
        details: { entity_type: 'PermissionSetGroup', entity_id: op.entity_id },
      });
    }
  }
}
