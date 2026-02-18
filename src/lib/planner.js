import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export const EXECUTION_ORDER_MAP = {
  CREATE_PS: 100,
  CREATE_PSG: 100,
  MODIFY_PS: 200,
  MODIFY_PSG: 200,
  ADD_PERMISSION: 300,
  REMOVE_PERMISSION: 400,
  ADD_PSG_MEMBER: 500,
  REMOVE_PSG_MEMBER: 500,
  DELETE_PS: 600,
  DELETE_PSG: 600,
  CHANGE_ASSIGNMENT: 700,
};

export async function createPlan(dbPath, { name, targetOrg, sourceOrg, description }) {
  if (!name) {
    throw new Error('Plan name is required');
  }
  if (!targetOrg) {
    throw new Error('Target org is required');
  }

  const db = new Database(dbPath);
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO migration_plans (id, name, description, source_org, target_org, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(id, name, description || null, sourceOrg || null, targetOrg, 'draft', now, now);

    return {
      id,
      name,
      description,
      source_org: sourceOrg,
      target_org: targetOrg,
      status: 'draft',
      created_at: now,
      updated_at: now,
    };
  } finally {
    db.close();
  }
}

export async function getPlan(dbPath, planId) {
  const db = new Database(dbPath);
  try {
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId);
    if (!plan) return null;

    const operations = db.prepare('SELECT * FROM plan_operations WHERE plan_id = ? ORDER BY execution_order, id').all(planId);

    return { ...plan, operations };
  } finally {
    db.close();
  }
}

export async function listPlans(dbPath) {
  const db = new Database(dbPath);
  try {
    const plans = db.prepare(`
      SELECT p.*, COUNT(o.id) as operation_count
      FROM migration_plans p
      LEFT JOIN plan_operations o ON p.id = o.plan_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all();

    return plans;
  } finally {
    db.close();
  }
}

export async function addOperation(dbPath, planId, { operation, entityType, entityId, parameters }) {
  const db = new Database(dbPath);
  try {
    const plan = db.prepare('SELECT id FROM migration_plans WHERE id = ?').get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    if (!(operation in EXECUTION_ORDER_MAP)) {
      throw new Error(`Invalid operation type: ${operation}. Valid types: ${Object.keys(EXECUTION_ORDER_MAP).join(', ')}`);
    }

    const id = randomUUID();
    const executionOrder = EXECUTION_ORDER_MAP[operation];
    const parametersJson = typeof parameters === 'object' ? JSON.stringify(parameters) : parameters;

    const insert = db.prepare(`
      INSERT INTO plan_operations (id, plan_id, operation, entity_type, entity_id, parameters, execution_order, source_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(id, planId, operation, entityType, entityId, parametersJson, executionOrder, 'manual', 'pending');

    updatePlanTimestamp(db, planId);

    return {
      id,
      plan_id: planId,
      operation,
      entity_type: entityType,
      entity_id: entityId,
      parameters: parametersJson,
      execution_order: executionOrder,
      source_type: 'manual',
      status: 'pending',
    };
  } finally {
    db.close();
  }
}

export async function removeOperation(dbPath, planId, operationId) {
  const db = new Database(dbPath);
  try {
    db.prepare('DELETE FROM plan_operations WHERE id = ? AND plan_id = ?').run(operationId, planId);
    updatePlanTimestamp(db, planId);
  } finally {
    db.close();
  }
}

function updatePlanTimestamp(db, planId) {
  const now = new Date().toISOString();
  db.prepare('UPDATE migration_plans SET updated_at = ? WHERE id = ?').run(now, planId);
}

/**
 * Export plan to portable JSON format.
 *
 * Serializes plan metadata and operations for cross-database sharing. Operation statuses default to 'pending' if null.
 *
 * @param {string} dbPath - Path to database file
 * @param {string} planId - Plan UUID
 * @returns {Promise<Object>} JSON object with version:1 (integer), exported_at timestamp, plan metadata, and operations array
 *
 * @see importPlanFromJson for inverse operation
 * @see DL-002 Design decision: Non-idempotent import (new UUIDs on each import)
 * @see DL-006 Design decision: Version field as integer 1 (not string) for forward compatibility
 */
export async function exportPlanToJson(dbPath, planId) {
  const plan = await getPlan(dbPath, planId);
  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    plan: {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      source_org: plan.source_org,
      target_org: plan.target_org,
      status: plan.status,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
    },
    operations: plan.operations.map(op => ({
      id: op.id,
      operation: op.operation,
      entity_type: op.entity_type,
      entity_id: op.entity_id,
      parameters: op.parameters,
      execution_order: op.execution_order,
      source_type: op.source_type,
      status: op.status || 'pending',
    })),
  };
}

export async function importPlanFromJson(dbPath, jsonData) {
  if (jsonData.version !== 1) {
    throw new Error(`Unsupported plan version: ${jsonData.version}. Expected version 1.`);
  }

  const requiredFields = ['version', 'plan.name', 'plan.target_org', 'operations'];
  for (const field of requiredFields) {
    const keys = field.split('.');
    let value = jsonData;
    for (const key of keys) {
      value = value?.[key];
    }
    if (value === undefined) {
      throw new Error(`Invalid plan format: missing required field: ${field}`);
    }
  }

  if (!Array.isArray(jsonData.operations)) {
    throw new Error('Invalid plan format: operations must be an array');
  }

  const db = new Database(dbPath);
  try {
    const newPlanId = randomUUID();
    const now = new Date().toISOString();

    const insertPlan = db.prepare(`
      INSERT INTO migration_plans (id, name, description, source_org, target_org, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertOp = db.prepare(`
      INSERT INTO plan_operations (id, plan_id, operation, entity_type, entity_id, parameters, execution_order, source_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      insertPlan.run(newPlanId, jsonData.plan.name, jsonData.plan.description || null, jsonData.plan.source_org || null, jsonData.plan.target_org, 'draft', now, now);

      for (const op of jsonData.operations) {
        if (!(op.operation in EXECUTION_ORDER_MAP)) {
          throw new Error(`Invalid operation type: ${op.operation}`);
        }
        if (!op.entity_type || !op.entity_id) {
          throw new Error('Invalid operation: missing entity_type or entity_id');
        }
        const newOpId = randomUUID();
        const parametersJson = typeof op.parameters === 'object' ? JSON.stringify(op.parameters) : op.parameters;
        insertOp.run(newOpId, newPlanId, op.operation, op.entity_type, op.entity_id, parametersJson, op.execution_order, op.source_type || 'manual', 'pending');
      }
    });

    transaction();

    return { id: newPlanId, operation_count: jsonData.operations.length };
  } finally {
    db.close();
  }
}

export async function markOperationDeployed(dbPath, planId, operationId, options = {}) {
  const db = new Database(dbPath);
  try {
    const plan = db.prepare('SELECT id FROM migration_plans WHERE id = ?').get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const operation = db.prepare('SELECT id FROM plan_operations WHERE id = ? AND plan_id = ?').get(operationId, planId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found in plan ${planId}`);
    }

    const now = new Date().toISOString();
    const status = options.error ? 'failed' : 'deployed';
    const errorMessage = options.error || null;

    db.prepare('UPDATE plan_operations SET status = ?, executed_at = ?, error_message = ? WHERE id = ?').run(status, now, errorMessage, operationId);

    updatePlanTimestamp(db, planId);
  } finally {
    db.close();
  }
}

export async function skipOperation(dbPath, planId, operationId) {
  const db = new Database(dbPath);
  try {
    const plan = db.prepare('SELECT id FROM migration_plans WHERE id = ?').get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const operation = db.prepare('SELECT id FROM plan_operations WHERE id = ? AND plan_id = ?').get(operationId, planId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found in plan ${planId}`);
    }

    db.prepare('UPDATE plan_operations SET status = ? WHERE id = ? AND plan_id = ?').run('skipped', operationId, planId);

    updatePlanTimestamp(db, planId);
  } finally {
    db.close();
  }
}

export async function updatePlanStatus(dbPath, planId, newStatus) {
  const validTransitions = {
    draft: ['ready'],
    ready: ['draft', 'executed'],
    executed: ['draft'],
  };

  const db = new Database(dbPath);
  try {
    const plan = db.prepare('SELECT status FROM migration_plans WHERE id = ?').get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const currentStatus = plan.status || 'draft';
    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new Error(`Invalid transition from ${currentStatus} to ${newStatus}`);
    }

    if (newStatus === 'executed') {
      const pendingOps = db.prepare('SELECT COUNT(*) as count FROM plan_operations WHERE plan_id = ? AND (status IN (?, ?) OR status IS NULL)').get(planId, 'pending', 'failed');
      if (pendingOps.count > 0) {
        throw new Error(`Cannot transition to executed: ${pendingOps.count} operation(s) have pending or failed status`);
      }
    }

    db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run(newStatus, planId);
    updatePlanTimestamp(db, planId);
  } finally {
    db.close();
  }
}
