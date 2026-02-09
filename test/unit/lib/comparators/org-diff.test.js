import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { seedSourceDatabase, seedTargetDatabase } from '../../../helpers/db-setup.js';
import { compareOrgs } from '../../../../src/lib/comparators/org-diff.js';

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
  tempFiles.length = 0;
});

function getTempDbPath() {
  const tempPath = path.join(os.tmpdir(), 'permafrost-diff-test-' + randomUUID() + '.db');
  tempFiles.push(tempPath);
  return tempPath;
}

describe('org-diff', () => {
  describe('compareOrgs', () => {
    it('compares both PS and PSG by default', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();

      const sourcePath = getTempDbPath();
      const targetPath = getTempDbPath();
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();

      const result = await compareOrgs(sourcePath, targetPath);

      assert.ok(result.summary);
      assert.ok(result.summary.total_changes > 0);
      assert.ok(result.changes.length > 0);
    });

    it('respects include option (ps only)', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();

      const sourcePath = getTempDbPath();
      const targetPath = getTempDbPath();
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();

      const result = await compareOrgs(sourcePath, targetPath, { include: ['ps'] });

      const psgChanges = result.changes.filter(c => c.entity_type === 'PermissionSetGroup');
      assert.strictEqual(psgChanges.length, 0);

      const psChanges = result.changes.filter(c => c.entity_type === 'PermissionSet');
      assert.ok(psChanges.length > 0);
    });

    it('applies filter glob pattern', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();

      const sourcePath = getTempDbPath();
      const targetPath = getTempDbPath();
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();

      const result = await compareOrgs(sourcePath, targetPath, { filter: 'Sales*' });

      assert.ok(result.changes.every(c => c.entity_id.startsWith('Sales')));
    });

    it('returns correct output structure', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();

      const sourcePath = getTempDbPath();
      const targetPath = getTempDbPath();
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();

      const result = await compareOrgs(sourcePath, targetPath);

      assert.ok(result.source_org);
      assert.ok(result.target_org);
      assert.ok(result.summary);
      assert.ok(result.summary.total_changes >= 0);
      assert.ok(result.summary.by_operation);
      assert.ok(Array.isArray(result.changes));
      assert.strictEqual(result.changes.length, result.summary.total_changes);
    });
  });
});
