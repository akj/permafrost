import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { initDatabase } from '../../../src/lib/database.js';
import { initMigrationSchema } from '../../../src/lib/migration-db.js';

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      const dir = path.dirname(file);
      if (fs.existsSync(dir) && dir !== os.tmpdir()) {
        fs.rmSync(dir, { recursive: true });
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }
  tempFiles.length = 0;
});

function getTempDbPath() {
  const tempPath = path.join(os.tmpdir(), 'permafrost-test-' + randomUUID(), 'test.db');
  tempFiles.push(tempPath);
  return tempPath;
}

describe('migration-db module', () => {
  describe('initMigrationSchema', () => {
    it('creates 3 new tables alongside existing 6 tables', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const db = new Database(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      db.close();

      const tableNames = tables.map(t => t.name);
      assert.deepStrictEqual(tableNames, [
        'migration_plans',
        'migration_snapshots',
        'permission_set_groups',
        'permission_sets',
        'permissions',
        'plan_operations',
        'profiles',
        'psg_members',
        'user_assignments',
      ]);
    });

    it('creates idx_plan_operations_plan_id index', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);

      const db = new Database(dbPath);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_plan_operations_plan_id'").all();
      db.close();

      assert.strictEqual(indexes.length, 1);
    });

    it('is idempotent', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      await initMigrationSchema(dbPath);
      const result = await initMigrationSchema(dbPath);

      assert.strictEqual(result, dbPath);
    });

    it('returns dbPath', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);
      const result = await initMigrationSchema(dbPath);

      assert.strictEqual(result, dbPath);
    });
  });
});
