import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { seedSourceDatabase, seedTargetDatabase } from '../../../helpers/db-setup.js';
import { diffPSGs } from '../../../../src/lib/comparators/psg-differ.js';

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    try { unlinkSync(file); } catch {}
  }
  tempFiles.length = 0;
});

describe('psg-differ', () => {
  describe('diffPSGs', () => {
    it('detects missing PSG in target (CREATE_PSG + ADD_PSG_MEMBER)', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPSGs(sourcePath, targetPath);

      const createPSG = changes.filter(c => c.operation === 'CREATE_PSG');
      assert.strictEqual(createPSG.length, 1);
      assert.strictEqual(createPSG[0].entity_id, 'SalesBundle');

      const addMembers = changes.filter(c => c.operation === 'ADD_PSG_MEMBER' && c.entity_id === 'SalesBundle');
      assert.strictEqual(addMembers.length, 1);
      assert.strictEqual(addMembers[0].details.member_id, 'SalesOps');
    });

    it('detects added members (ADD_PSG_MEMBER)', async () => {
      const sourceDb = seedSourceDatabase();
      sourceDb.prepare('INSERT INTO psg_members (psg_id, ps_id) VALUES (?, ?)').run('SalesBundle', 'MarketingUser');

      const targetDb = seedTargetDatabase();
      targetDb.prepare('INSERT INTO permission_set_groups (id, full_name, label, status) VALUES (?, ?, ?, ?)').run('SalesBundle', 'SalesBundle', 'Sales Bundle', 'Updated');
      targetDb.prepare('INSERT INTO psg_members (psg_id, ps_id) VALUES (?, ?)').run('SalesBundle', 'SalesOps');

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPSGs(sourcePath, targetPath);

      const addMembers = changes.filter(c => c.operation === 'ADD_PSG_MEMBER' && c.details.member_id === 'MarketingUser');
      assert.strictEqual(addMembers.length, 1);
    });

    it('detects removed members (REMOVE_PSG_MEMBER)', async () => {
      const sourceDb = seedSourceDatabase();

      const targetDb = seedTargetDatabase();
      targetDb.prepare('INSERT INTO permission_set_groups (id, full_name, label, status) VALUES (?, ?, ?, ?)').run('SalesBundle', 'SalesBundle', 'Sales Bundle', 'Updated');
      targetDb.prepare('INSERT INTO psg_members (psg_id, ps_id) VALUES (?, ?)').run('SalesBundle', 'SalesOps');
      targetDb.prepare('INSERT INTO psg_members (psg_id, ps_id) VALUES (?, ?)').run('SalesBundle', 'MarketingUser');

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPSGs(sourcePath, targetPath);

      const removeMembers = changes.filter(c => c.operation === 'REMOVE_PSG_MEMBER' && c.details.member_id === 'MarketingUser');
      assert.strictEqual(removeMembers.length, 1);
    });

    it('detects metadata changes (MODIFY_PSG)', async () => {
      const sourceDb = seedSourceDatabase();

      const targetDb = seedTargetDatabase();
      targetDb.prepare('INSERT INTO permission_set_groups (id, full_name, label, status) VALUES (?, ?, ?, ?)').run('SalesBundle', 'SalesBundle', 'Old Label', 'Updated');

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPSGs(sourcePath, targetPath);

      const modifyChanges = changes.filter(c => c.operation === 'MODIFY_PSG');
      assert.strictEqual(modifyChanges.length, 1);
      assert.strictEqual(modifyChanges[0].details.label, 'Sales Bundle');
    });

    it('excludes inactive PSGs', async () => {
      const sourceDb = seedSourceDatabase();
      sourceDb.prepare('INSERT INTO permission_set_groups (id, full_name, label, status) VALUES (?, ?, ?, ?)').run('OutdatedPSG', 'OutdatedPSG', 'Outdated', 'Outdated');

      const targetDb = seedTargetDatabase();

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPSGs(sourcePath, targetPath);
      const outdatedChanges = changes.filter(c => c.entity_id === 'OutdatedPSG');
      assert.strictEqual(outdatedChanges.length, 0);
    });
  });
});
