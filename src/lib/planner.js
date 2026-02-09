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
