import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { seedSourceDatabase, seedTargetDatabase } from '../../../helpers/db-setup.js';
import { diffPermissionSets } from '../../../../src/lib/comparators/ps-differ.js';

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    try { unlinkSync(file); } catch {}
  }
  tempFiles.length = 0;
});

describe('ps-differ', () => {
  describe('diffPermissionSets', () => {
    it('detects missing PS in target', async () => {
      const sourceDb = seedSourceDatabase();
      sourceDb.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)').run('NewPS', 'NewPS', 'New PS', 0);
      const targetDb = seedTargetDatabase();

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPermissionSets(sourcePath, targetPath);

      const createChanges = changes.filter(c => c.operation === 'CREATE_PS');
      assert.strictEqual(createChanges.length, 1);
      assert.strictEqual(createChanges[0].entity_id, 'NewPS');
      assert.strictEqual(createChanges[0].entity_type, 'PermissionSet');
    });

    it('detects missing permissions (ADD_PERMISSION)', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPermissionSets(sourcePath, targetPath);

      const addPerms = changes.filter(c => c.operation === 'ADD_PERMISSION');
      assert.ok(addPerms.length > 0);

      const accountCreate = addPerms.find(c => c.details.permission_name === 'Account.Create');
      assert.ok(accountCreate);
      assert.strictEqual(accountCreate.entity_id, 'SalesOps');
      assert.strictEqual(accountCreate.details.permission_value, 'true');
    });

    it('detects extra permissions in target (REMOVE_PERMISSION)', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();
      targetDb.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)').run('PermissionSet', 'SalesOps', 'UserPermission', 'ExtraPermission', 'true');

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPermissionSets(sourcePath, targetPath);

      const removePerms = changes.filter(c => c.operation === 'REMOVE_PERMISSION');
      const extraPerm = removePerms.find(c => c.details.permission_name === 'ExtraPermission');
      assert.ok(extraPerm);
      assert.strictEqual(extraPerm.entity_id, 'SalesOps');
    });

    it('detects metadata changes (MODIFY_PS)', async () => {
      const sourceDb = seedSourceDatabase();
      const targetDb = seedTargetDatabase();
      targetDb.prepare('UPDATE permission_sets SET label = ? WHERE id = ?').run('Old Label', 'SalesOps');

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPermissionSets(sourcePath, targetPath);

      const modifyChanges = changes.filter(c => c.operation === 'MODIFY_PS');
      assert.strictEqual(modifyChanges.length, 1);
      assert.strictEqual(modifyChanges[0].entity_id, 'SalesOps');
      assert.strictEqual(modifyChanges[0].details.label, 'Sales Operations');
    });

    it('excludes profile-owned PS', async () => {
      const sourceDb = seedSourceDatabase();
      sourceDb.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)').run('ProfilePS', 'ProfilePS', 'Profile PS', 1);
      sourceDb.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)').run('PermissionSet', 'ProfilePS', 'UserPermission', 'SomePermission', 'true');

      const targetDb = seedTargetDatabase();

      const sourcePath = join(tmpdir(), `test-source-${randomUUID()}.db`);
      const targetPath = join(tmpdir(), `test-target-${randomUUID()}.db`);
      await sourceDb.backup(sourcePath);
      await targetDb.backup(targetPath);
      sourceDb.close();
      targetDb.close();
      tempFiles.push(sourcePath, targetPath);

      const changes = await diffPermissionSets(sourcePath, targetPath);

      const profilePSChanges = changes.filter(c => c.entity_id === 'ProfilePS');
      assert.strictEqual(profilePSChanges.length, 0);
    });
  });
});
