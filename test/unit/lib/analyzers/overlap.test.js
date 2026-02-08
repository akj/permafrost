import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { seedDatabase } from '../../../helpers/db-setup.js';
import { analyzePermissionSetOverlap } from '../../../../src/lib/analyzers/overlap.js';

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

describe('overlap analyzer', () => {
  let dbPath;

  beforeEach(async () => {
    dbPath = await createTempDBFromSeed();
  });

  afterEach(() => {
    cleanupTempDBs();
  });

  describe('analyzePermissionSetOverlap', () => {
    it('returns overlap analysis with correct structure', async () => {
      const result = await analyzePermissionSetOverlap(dbPath);

      assert.equal(result.type, 'overlap_analysis');
      assert.ok(result.summary);
      assert.ok(Array.isArray(result.pairs));

      assert.ok(result.summary.total_comparisons >= 0);
      assert.ok(result.summary.high_overlap_pairs >= 0);
      assert.equal(result.summary.threshold, 0.5);
    });

    it('calculates Jaccard similarity for PS pairs', async () => {
      const result = await analyzePermissionSetOverlap(dbPath, { threshold: 0.0 });

      if (result.pairs.length > 0) {
        const pair = result.pairs[0];
        assert.ok(pair.permission_set_a);
        assert.ok(pair.permission_set_b);
        assert.ok(pair.metrics);
        assert.ok(pair.metrics.jaccard_similarity >= 0);
        assert.ok(pair.metrics.jaccard_similarity <= 1);
      }
    });

    it('includes overlap percentage in metrics', async () => {
      const result = await analyzePermissionSetOverlap(dbPath, { threshold: 0.0 });

      if (result.pairs.length > 0) {
        const pair = result.pairs[0];
        assert.ok(pair.metrics.overlap_percentage >= 0);
        assert.ok(pair.metrics.overlap_percentage <= 1);
        assert.ok(typeof pair.metrics.shared_permissions === 'number');
        assert.ok(typeof pair.metrics.unique_to_a === 'number');
        assert.ok(typeof pair.metrics.unique_to_b === 'number');
      }
    });

    it('excludes profile-owned permission sets', async () => {
      const result = await analyzePermissionSetOverlap(dbPath, { threshold: 0.0 });

      const hasProfileMirror = result.pairs.some(p =>
        p.permission_set_a.id === 'ProfileMirrorPS' ||
        p.permission_set_b.id === 'ProfileMirrorPS',
      );

      assert.equal(hasProfileMirror, false, 'ProfileMirrorPS should not appear in overlap analysis');
    });

    it('sorts pairs by Jaccard similarity descending', async () => {
      const result = await analyzePermissionSetOverlap(dbPath, { threshold: 0.0 });

      if (result.pairs.length > 1) {
        for (let i = 0; i < result.pairs.length - 1; i++) {
          const currentSim = result.pairs[i].metrics.jaccard_similarity;
          const nextSim = result.pairs[i + 1].metrics.jaccard_similarity;
          assert.ok(currentSim >= nextSim, 'Pairs should be sorted by Jaccard descending');
        }
      }
    });

    it('respects custom threshold option', async () => {
      const threshold = 0.8;
      const result = await analyzePermissionSetOverlap(dbPath, { threshold });

      assert.equal(result.summary.threshold, threshold);

      for (const pair of result.pairs) {
        assert.ok(pair.metrics.jaccard_similarity >= threshold,
          'All pairs should meet threshold');
      }
    });

    it('handles empty database gracefully', async () => {
      const emptyDB = new Database(':memory:');
      emptyDB.exec(`
        CREATE TABLE permission_sets (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          label TEXT,
          is_owned_by_profile BOOLEAN
        );
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

      const result = await analyzePermissionSetOverlap(emptyPath);

      assert.equal(result.summary.total_comparisons, 0);
      assert.equal(result.summary.high_overlap_pairs, 0);
      assert.equal(result.pairs.length, 0);
    });

    it('applies large org filter when PS count exceeds threshold', async () => {
      const result = await analyzePermissionSetOverlap(dbPath, {
        threshold: 0.0,
        largeOrgThreshold: 1,
        minUsers: 1,
      });

      assert.ok(result.summary.total_comparisons >= 0);
    });
  });
});
