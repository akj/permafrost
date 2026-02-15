import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  initDatabase,
  insertProfiles,
  insertPermissionSets,
  insertPermissionSetGroups,
  insertPSGMembers,
  insertPermissions,
  insertUserAssignments,
  withTransaction,
  exportDatabase,
  seedUniversalDependencies,
} from '../../../src/lib/database.js';

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

describe('database module', () => {
  describe('initDatabase', () => {
    it('creates directory if missing', async () => {
      const dbPath = getTempDbPath();
      const dir = path.dirname(dbPath);
      assert.strictEqual(fs.existsSync(dir), false);

      await initDatabase(dbPath);

      assert.strictEqual(fs.existsSync(dir), true);
      assert.strictEqual(fs.existsSync(dbPath), true);
    });

    it('creates 7 tables', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const db = new Database(dbPath);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      db.close();

      const tableNames = tables.map(t => t.name);
      assert.deepStrictEqual(tableNames, [
        'permission_dependencies',
        'permission_set_groups',
        'permission_sets',
        'permissions',
        'profiles',
        'psg_members',
        'user_assignments',
      ]);
    });

    it('creates 5 indexes', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const db = new Database(dbPath);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      db.close();

      const indexNames = indexes.map(i => i.name);
      assert.deepStrictEqual(indexNames, [
        'idx_dep_from',
        'idx_dep_to',
        'idx_permission_lookup',
        'idx_user_email_lookup',
        'idx_user_lookup',
      ]);
    });

    it('returns dbPath', async () => {
      const dbPath = getTempDbPath();
      const result = await initDatabase(dbPath);
      assert.strictEqual(result, dbPath);
    });
  });

  describe('insertProfiles', () => {
    it('inserts profiles', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const profiles = [
        { fullName: 'Admin', userLicense: 'Salesforce', custom: false },
        { fullName: 'CustomProfile', userLicense: 'Platform', custom: true },
      ];

      await insertProfiles(dbPath, profiles);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM profiles ORDER BY full_name').all();
      db.close();

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].full_name, 'Admin');
      assert.strictEqual(rows[0].user_license, 'Salesforce');
      assert.strictEqual(rows[0].is_custom, 0);
      assert.strictEqual(rows[1].full_name, 'CustomProfile');
      assert.strictEqual(rows[1].user_license, 'Platform');
      assert.strictEqual(rows[1].is_custom, 1);
    });

    it('handles duplicates with INSERT OR REPLACE', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const profiles = [{ fullName: 'Admin', userLicense: 'Salesforce', custom: false }];
      await insertProfiles(dbPath, profiles);

      const updatedProfiles = [{ fullName: 'Admin', userLicense: 'Updated', custom: true }];
      await insertProfiles(dbPath, updatedProfiles);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM profiles').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].user_license, 'Updated');
      assert.strictEqual(rows[0].is_custom, 1);
    });
  });

  describe('insertPermissionSets', () => {
    it('inserts permission sets', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissionSets = [
        { fullName: 'PS1', label: 'Permission Set 1', license: 'Salesforce' },
        { fullName: 'PS2', label: 'Permission Set 2', license: null },
      ];

      await insertPermissionSets(dbPath, permissionSets);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM permission_sets ORDER BY full_name').all();
      db.close();

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].full_name, 'PS1');
      assert.strictEqual(rows[0].label, 'Permission Set 1');
      assert.strictEqual(rows[0].license, 'Salesforce');
      assert.strictEqual(rows[1].full_name, 'PS2');
    });
  });

  describe('insertPermissionSetGroups', () => {
    it('inserts permission set groups with status', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissionSetGroups = [
        { fullName: 'PSG1', label: 'Group 1', status: 'Updated' },
        { fullName: 'PSG2', label: 'Group 2', status: 'Outdated' },
      ];

      await insertPermissionSetGroups(dbPath, permissionSetGroups);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM permission_set_groups ORDER BY full_name').all();
      db.close();

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].full_name, 'PSG1');
      assert.strictEqual(rows[0].status, 'Updated');
      assert.strictEqual(rows[1].full_name, 'PSG2');
      assert.strictEqual(rows[1].status, 'Outdated');
    });
  });

  describe('insertPSGMembers', () => {
    it('inserts valid members', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await insertPermissionSets(dbPath, [{ fullName: 'PS1', label: 'PS1' }]);
      await insertPermissionSetGroups(dbPath, [{ fullName: 'PSG1', label: 'PSG1', status: 'Updated' }]);

      const members = [{ psgId: 'PSG1', psId: 'PS1' }];
      await insertPSGMembers(dbPath, members);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM psg_members').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].psg_id, 'PSG1');
      assert.strictEqual(rows[0].ps_id, 'PS1');
    });

    it('skips members referencing non-existent PS', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await insertPermissionSetGroups(dbPath, [{ fullName: 'PSG1', label: 'PSG1', status: 'Updated' }]);

      const members = [{ psgId: 'PSG1', psId: 'NonExistent' }];
      await insertPSGMembers(dbPath, members);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM psg_members').all();
      db.close();

      assert.strictEqual(rows.length, 0);
    });

    it('skips members referencing non-existent PSG', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await insertPermissionSets(dbPath, [{ fullName: 'PS1', label: 'PS1' }]);

      const members = [{ psgId: 'NonExistent', psId: 'PS1' }];
      await insertPSGMembers(dbPath, members);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM psg_members').all();
      db.close();

      assert.strictEqual(rows.length, 0);
    });
  });

  describe('insertPermissions', () => {
    it('inserts permissions', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissions = [
        {
          sourceType: 'Profile',
          sourceId: 'Admin',
          permissionType: 'objectPermissions',
          permissionName: 'Account',
          permissionValue: 'read::true',
        },
        {
          sourceType: 'PermissionSet',
          sourceId: 'PS1',
          permissionType: 'userPermissions',
          permissionName: 'ViewSetup',
          permissionValue: 'true',
        },
      ];

      await insertPermissions(dbPath, permissions);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM permissions ORDER BY id').all();
      db.close();

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].source_type, 'Profile');
      assert.strictEqual(rows[0].source_id, 'Admin');
      assert.strictEqual(rows[0].permission_type, 'objectPermissions');
      assert.strictEqual(rows[0].permission_name, 'Account');
      assert.strictEqual(rows[1].source_id, 'PS1');
    });

    it('DELETE-before-INSERT idempotency', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissions = [
        {
          sourceType: 'Profile',
          sourceId: 'Admin',
          permissionType: 'objectPermissions',
          permissionName: 'Account',
          permissionValue: 'read::true',
        },
      ];

      await insertPermissions(dbPath, permissions);

      const db1 = new Database(dbPath);
      const count1 = db1.prepare('SELECT COUNT(*) as count FROM permissions WHERE source_id = ?').get('Admin');
      db1.close();
      assert.strictEqual(count1.count, 1);

      const updatedPermissions = [
        {
          sourceType: 'Profile',
          sourceId: 'Admin',
          permissionType: 'userPermissions',
          permissionName: 'ViewSetup',
          permissionValue: 'true',
        },
      ];

      await insertPermissions(dbPath, updatedPermissions);

      const db2 = new Database(dbPath);
      const rows = db2.prepare('SELECT * FROM permissions WHERE source_id = ?').all('Admin');
      db2.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].permission_type, 'userPermissions');
      assert.strictEqual(rows[0].permission_name, 'ViewSetup');
    });
  });

  describe('insertUserAssignments', () => {
    it('handles Profile assignments', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const assignments = [
        {
          Id: 'user1',
          Username: 'admin@example.com',
          Email: 'admin@example.com',
          ProfileId: 'profile123',
          Profile: { Name: 'Admin' },
        },
      ];

      await insertUserAssignments(dbPath, assignments);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM user_assignments').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].user_id, 'user1');
      assert.strictEqual(rows[0].user_username, 'admin@example.com');
      assert.strictEqual(rows[0].assignee_type, 'Profile');
      assert.strictEqual(rows[0].assignee_id, 'Admin');
      assert.strictEqual(rows[0].assignment_id, null);
    });

    it('handles PermissionSet assignments', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const assignments = [
        {
          Id: 'assign1',
          AssigneeId: 'user1',
          Assignee: { Username: 'user@example.com', Email: 'user@example.com' },
          PermissionSetId: 'ps123',
          PermissionSet: { Name: 'CustomPS' },
        },
      ];

      await insertUserAssignments(dbPath, assignments);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM user_assignments').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].user_id, 'user1');
      assert.strictEqual(rows[0].assignee_type, 'PermissionSet');
      assert.strictEqual(rows[0].assignee_id, 'CustomPS');
      assert.strictEqual(rows[0].assignment_id, 'assign1');
    });

    it('handles PermissionSetGroup assignments', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const assignments = [
        {
          Id: 'assign2',
          AssigneeId: 'user2',
          Assignee: { Username: 'user2@example.com', Email: 'user2@example.com' },
          PermissionSetGroupId: 'psg123',
          PermissionSetGroup: { DeveloperName: 'CustomPSG' },
        },
      ];

      await insertUserAssignments(dbPath, assignments);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM user_assignments').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].user_id, 'user2');
      assert.strictEqual(rows[0].assignee_type, 'PermissionSetGroup');
      assert.strictEqual(rows[0].assignee_id, 'CustomPSG');
      assert.strictEqual(rows[0].assignment_id, 'assign2');
    });

    it('handles duplicates with INSERT OR REPLACE', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const assignments = [
        {
          Id: 'user1',
          Username: 'admin@example.com',
          Email: 'admin@example.com',
          ProfileId: 'profile123',
          Profile: { Name: 'Admin' },
        },
      ];

      await insertUserAssignments(dbPath, assignments);

      const updatedAssignments = [
        {
          Id: 'user1',
          Username: 'admin-updated@example.com',
          Email: 'admin-updated@example.com',
          ProfileId: 'profile123',
          Profile: { Name: 'Admin' },
        },
      ];

      await insertUserAssignments(dbPath, updatedAssignments);

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM user_assignments').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].user_username, 'admin-updated@example.com');
    });
  });

  describe('withTransaction', () => {
    it('commits on success', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await withTransaction(dbPath, (db) => {
        db.prepare("INSERT INTO profiles (id, full_name, user_license, is_custom) VALUES ('test', 'test', 'SF', 0)").run();
      });

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM profiles').all();
      db.close();

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].full_name, 'test');
    });

    it('rolls back on error and re-throws', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await assert.rejects(
        async () => {
          await withTransaction(dbPath, (db) => {
            db.prepare("INSERT INTO profiles (id, full_name, user_license, is_custom) VALUES ('test', 'test', 'SF', 0)").run();
            throw new Error('Test error');
          });
        },
        { message: 'Test error' },
      );

      const db = new Database(dbPath);
      const rows = db.prepare('SELECT * FROM profiles').all();
      db.close();

      assert.strictEqual(rows.length, 0);
    });
  });

  describe('exportDatabase', () => {
    it('returns all tables with include=all', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await insertProfiles(dbPath, [{ fullName: 'Admin', userLicense: 'SF', custom: false }]);
      await insertPermissionSets(dbPath, [{ fullName: 'PS1', label: 'PS1' }]);

      const data = await exportDatabase(dbPath, { include: ['all'] });

      assert.ok(data.profiles);
      assert.ok(data.permissionSets);
      assert.ok(data.permissionSetGroups);
      assert.ok(data.permissions);
      assert.ok(data.userAssignments);
      assert.strictEqual(data.profiles.length, 1);
      assert.strictEqual(data.permissionSets.length, 1);
    });

    it('respects include filter for profiles only', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await insertProfiles(dbPath, [{ fullName: 'Admin', userLicense: 'SF', custom: false }]);
      await insertPermissionSets(dbPath, [{ fullName: 'PS1', label: 'PS1' }]);

      const data = await exportDatabase(dbPath, { include: ['profiles'] });

      assert.ok(data.profiles);
      assert.strictEqual(data.permissionSets, undefined);
      assert.strictEqual(data.profiles.length, 1);
    });

    it('respects include filter for multiple tables', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      await insertProfiles(dbPath, [{ fullName: 'Admin', userLicense: 'SF', custom: false }]);
      await insertPermissionSets(dbPath, [{ fullName: 'PS1', label: 'PS1' }]);

      const data = await exportDatabase(dbPath, { include: ['profiles', 'permissionsets'] });

      assert.ok(data.profiles);
      assert.ok(data.permissionSets);
      assert.strictEqual(data.permissionSetGroups, undefined);
      assert.strictEqual(data.permissions, undefined);
    });
  });

  describe('seedUniversalDependencies', () => {
    it('seeds CRUD hierarchy edges for objects', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissions = [
        {
          sourceType: 'PermissionSet',
          sourceId: 'PS1',
          permissionType: 'ObjectPermission',
          permissionName: 'Account.Read',
          permissionValue: 'true',
        },
      ];

      await insertPermissions(dbPath, permissions);
      const count = await seedUniversalDependencies(dbPath);

      assert.strictEqual(count, 1);

      const db = new Database(dbPath);
      const deps = db.prepare('SELECT * FROM permission_dependencies WHERE dependency_type = ? ORDER BY from_permission, to_permission').all('CRUD_HIERARCHY');
      db.close();

      assert.strictEqual(deps.length, 8);
      assert.strictEqual(deps[0].from_permission, 'Account.Delete');
      assert.strictEqual(deps[0].to_permission, 'Account.Read');
      assert.strictEqual(deps[0].severity, 'WARNING');
      assert.strictEqual(deps[0].is_universal, 1);
    });

    it('is idempotent', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissions = [
        {
          sourceType: 'PermissionSet',
          sourceId: 'PS1',
          permissionType: 'ObjectPermission',
          permissionName: 'Account.Read',
          permissionValue: 'true',
        },
      ];

      await insertPermissions(dbPath, permissions);
      await seedUniversalDependencies(dbPath);
      const count = await seedUniversalDependencies(dbPath);

      assert.strictEqual(count, 1);

      const db = new Database(dbPath);
      const deps = db.prepare('SELECT COUNT(*) as count FROM permission_dependencies WHERE dependency_type = ?').get('CRUD_HIERARCHY');
      db.close();

      assert.strictEqual(deps.count, 8);
    });

    it('seeds for multiple objects', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const permissions = [
        {
          sourceType: 'PermissionSet',
          sourceId: 'PS1',
          permissionType: 'ObjectPermission',
          permissionName: 'Account.Read',
          permissionValue: 'true',
        },
        {
          sourceType: 'PermissionSet',
          sourceId: 'PS1',
          permissionType: 'ObjectPermission',
          permissionName: 'Contact.Edit',
          permissionValue: 'true',
        },
      ];

      await insertPermissions(dbPath, permissions);
      const count = await seedUniversalDependencies(dbPath);

      assert.strictEqual(count, 2);

      const db = new Database(dbPath);
      const deps = db.prepare('SELECT COUNT(*) as count FROM permission_dependencies WHERE dependency_type = ?').get('CRUD_HIERARCHY');
      db.close();

      assert.strictEqual(deps.count, 16);
    });

    it('handles empty permissions table', async () => {
      const dbPath = getTempDbPath();
      await initDatabase(dbPath);

      const count = await seedUniversalDependencies(dbPath);

      assert.strictEqual(count, 0);

      const db = new Database(dbPath);
      const deps = db.prepare('SELECT COUNT(*) as count FROM permission_dependencies').get();
      db.close();

      assert.strictEqual(deps.count, 0);
    });
  });
});
