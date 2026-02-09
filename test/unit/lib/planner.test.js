import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initDatabase } from '../../../src/lib/database.js';
import { initMigrationSchema } from '../../../src/lib/migration-db.js';
import { createPlan, getPlan, listPlans, addOperation, removeOperation, EXECUTION_ORDER_MAP } from '../../../src/lib/planner.js';

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      const dir = path.dirname(file);
      if (fs.existsSync(dir) && dir !== os.tmpdir()) {
        fs.rmSync(dir, { recursive: true });
      }
    } catch {}
  }
  tempFiles.length = 0;
});

function getTempDbPath() {
  const tempPath = path.join(os.tmpdir(), 'permafrost-planner-test-' + randomUUID(), 'test.db');
  tempFiles.push(tempPath);
  return tempPath;
}

describe('planner module', () => {
  describe('createPlan', () => {
    it('creates plan with UUID and timestamps', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });

      assert.ok(plan.id);
      assert.strictEqual(plan.name, 'Test Plan');
      assert.strictEqual(plan.status, 'draft');
      assert.ok(plan.created_at);
      assert.ok(plan.updated_at);
    });

    it('throws on missing name', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      await assert.rejects(
        async () => createPlan(dbPath, { targetOrg: 'target@example.com' }),
        { message: 'Plan name is required' }
      );
    });

    it('throws on missing targetOrg', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      await assert.rejects(
        async () => createPlan(dbPath, { name: 'Test Plan' }),
        { message: 'Target org is required' }
      );
    });
  });

  describe('getPlan', () => {
    it('returns plan with operations', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const created = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });
      const plan = await getPlan(dbPath, created.id);

      assert.ok(plan);
      assert.strictEqual(plan.id, created.id);
      assert.ok(Array.isArray(plan.operations));
    });

    it('returns null for nonexistent plan', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await getPlan(dbPath, 'nonexistent-id');
      assert.strictEqual(plan, null);
    });
  });

  describe('listPlans', () => {
    it('returns empty array for fresh DB', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plans = await listPlans(dbPath);
      assert.deepStrictEqual(plans, []);
    });

    it('returns plans with operation counts', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });
      await addOperation(dbPath, plan.id, { operation: 'ADD_PERMISSION', entityType: 'PermissionSet', entityId: 'PS1', parameters: '{}' });

      const plans = await listPlans(dbPath);
      assert.strictEqual(plans.length, 1);
      assert.strictEqual(plans[0].operation_count, 1);
    });
  });

  describe('addOperation', () => {
    it('assigns correct execution_order for all 11 operation types', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });

      for (const [opType, expectedOrder] of Object.entries(EXECUTION_ORDER_MAP)) {
        const op = await addOperation(dbPath, plan.id, { operation: opType, entityType: 'PermissionSet', entityId: 'PS1', parameters: '{}' });
        assert.strictEqual(op.execution_order, expectedOrder);
      }
    });

    it('throws on invalid operation type', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });

      await assert.rejects(
        async () => addOperation(dbPath, plan.id, { operation: 'INVALID_OP', entityType: 'PermissionSet', entityId: 'PS1' }),
        { message: /Invalid operation type/ }
      );
    });

    it('throws on nonexistent planId', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      await assert.rejects(
        async () => addOperation(dbPath, 'nonexistent-id', { operation: 'ADD_PERMISSION', entityType: 'PermissionSet', entityId: 'PS1' }),
        { message: /not found/ }
      );
    });
  });

  describe('removeOperation', () => {
    it('deletes operation', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });
      const op = await addOperation(dbPath, plan.id, { operation: 'ADD_PERMISSION', entityType: 'PermissionSet', entityId: 'PS1' });

      await removeOperation(dbPath, plan.id, op.id);

      const retrieved = await getPlan(dbPath, plan.id);
      assert.strictEqual(retrieved.operations.length, 0);
    });

    it('is no-op for nonexistent operationId', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const plan = await createPlan(dbPath, { name: 'Test Plan', targetOrg: 'target@example.com' });
      await removeOperation(dbPath, plan.id, 'nonexistent-id');
    });
  });
});
