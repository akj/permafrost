import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { seedDatabase } from '../../../helpers/db-setup.js';
import {
  analyzeObjectAccess,
  listAllObjects,
} from '../../../../src/lib/analyzers/object-view.js';

let tempDBs = [];

async function createTempDBFromSeed() {
  const memDB = seedDatabase();
  const dbPath = path.join(os.tmpdir(), `permafrost-test-${randomUUID()}.db`);
  tempDBs.push(dbPath);

  await memDB.backup(dbPath);
  memDB.close();

  return dbPath;
}

function cleanupTempDBs() {
  for (const dbPath of tempDBs) {
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch (err) {
      console.error(`Failed to cleanup ${dbPath}:`, err);
    }
  }
  tempDBs = [];
}

describe('object-view analyzer', () => {
  let dbPath;

  beforeEach(async () => {
    dbPath = await createTempDBFromSeed();
  });

  afterEach(() => {
    cleanupTempDBs();
  });

  describe('analyzeObjectAccess', () => {
    it('returns object access analysis for Account', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      assert.equal(result.type, 'object_access_analysis');
      assert.equal(result.object, 'Account');
      assert.ok(Array.isArray(result.sources));
      assert.ok(result.summary);
    });

    it('includes both profiles and permission sets in sources', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      const hasProfile = result.sources.some(s => s.source_type === 'Profile');
      const hasPS = result.sources.some(s => s.source_type === 'PermissionSet');

      assert.ok(hasProfile || result.sources.length === 0, 'Should include profiles if they exist');
      assert.ok(hasPS || result.sources.length === 0, 'Should include permission sets if they exist');
    });

    it('separates object and field permissions', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      if (result.sources.length > 0) {
        const source = result.sources[0];
        assert.ok(Array.isArray(source.object_permissions));
        assert.ok(Array.isArray(source.field_permissions));
      }
    });

    it('includes user count per source', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      if (result.sources.length > 0) {
        const source = result.sources[0];
        assert.ok(typeof source.user_count === 'number');
        assert.ok(source.user_count >= 0);
      }
    });

    it('identifies PSG membership for permission sets', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      const salesOpsSource = result.sources.find(s =>
        s.source_type === 'PermissionSet' && s.source_id === 'SalesOps',
      );

      if (salesOpsSource && salesOpsSource.via_psg) {
        assert.ok(Array.isArray(salesOpsSource.via_psg));
        if (salesOpsSource.via_psg.length > 0) {
          const psg = salesOpsSource.via_psg[0];
          assert.ok(psg.id);
          assert.ok(psg.label);
        }
      }
    });

    it('calculates summary statistics', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      assert.ok(typeof result.summary.total_sources === 'number');
      assert.ok(typeof result.summary.total_profiles === 'number');
      assert.ok(typeof result.summary.total_permission_sets === 'number');
      assert.ok(typeof result.summary.estimated_users_with_access === 'number');

      const totalCalculated = result.summary.total_profiles + result.summary.total_permission_sets;
      assert.equal(result.summary.total_sources, totalCalculated);
    });

    it('excludes profile-owned permission sets', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      const hasProfileOwned = result.sources.some(s =>
        s.source_id === 'ProfileMirrorPS',
      );

      assert.equal(hasProfileOwned, false, 'Should exclude profile-owned PS');
    });

    it('handles non-existent object gracefully', async () => {
      const result = await analyzeObjectAccess(dbPath, 'NonExistentObject');

      assert.equal(result.type, 'object_access_analysis');
      assert.equal(result.object, 'NonExistentObject');
      assert.equal(result.sources.length, 0);
      assert.equal(result.summary.total_sources, 0);
    });

    it('includes source labels/names', async () => {
      const result = await analyzeObjectAccess(dbPath, 'Account');

      if (result.sources.length > 0) {
        const source = result.sources[0];
        assert.ok(source.source_name, 'Should include human-readable source name');
      }
    });
  });

  describe('listAllObjects', () => {
    it('returns sorted array of object names', async () => {
      const result = await listAllObjects(dbPath);

      assert.ok(Array.isArray(result));

      if (result.length > 1) {
        for (let i = 0; i < result.length - 1; i++) {
          assert.ok(result[i] <= result[i + 1], 'Objects should be sorted');
        }
      }
    });

    it('includes Account object', async () => {
      const result = await listAllObjects(dbPath);

      assert.ok(result.includes('Account'), 'Should include Account object');
    });

    it('extracts object names from field permissions', async () => {
      const result = await listAllObjects(dbPath);

      assert.ok(result.length > 0, 'Should extract objects from field permissions');
    });

    it('returns unique object names', async () => {
      const result = await listAllObjects(dbPath);

      const uniqueObjects = new Set(result);
      assert.equal(result.length, uniqueObjects.size, 'Should return only unique objects');
    });

    it('filters out empty/null object names', async () => {
      const result = await listAllObjects(dbPath);

      const hasEmpty = result.some(obj => !obj || obj.length === 0);
      assert.equal(hasEmpty, false, 'Should filter out empty object names');
    });

    it('handles database with no permissions', async () => {
      const emptyDB = new Database(':memory:');
      emptyDB.exec(`
        CREATE TABLE permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          permission_type TEXT NOT NULL,
          permission_name TEXT NOT NULL,
          permission_value TEXT
        );
      `);

      const emptyPath = path.join(os.tmpdir(), `permafrost-empty-${randomUUID()}.db`);
      tempDBs.push(emptyPath);

      await emptyDB.backup(emptyPath);
      emptyDB.close();

      const result = await listAllObjects(emptyPath);

      assert.ok(Array.isArray(result));
      assert.equal(result.length, 0);
    });
  });
});
