import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { traceUserPermission } from '../../../src/lib/tracer.js';
import { seedDatabase } from '../../helpers/db-setup.js';

const tempDBs = [];

async function createTempDBFromSeed() {
  const memDB = seedDatabase();
  const dbPath = path.join(os.tmpdir(), `permafrost-test-${randomUUID()}.db`);
  tempDBs.push(dbPath);
  await memDB.backup(dbPath);
  memDB.close();
  return dbPath;
}

after(() => {
  for (const dbPath of tempDBs) {
    try {
      fs.unlinkSync(dbPath);
    } catch (err) {
      // ignore cleanup errors
    }
  }
});

describe('traceUserPermission', () => {
  describe('user lookup', () => {
    it('finds user by email', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'ManageUsers');

      assert.equal(result.user, 'admin@test.com');
      assert.equal(result.userId, 'user1');
      assert.equal(result.permission, 'ManageUsers');
    });

    it('finds user by username', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'standard@test.com', 'ManageUsers');

      assert.equal(result.user, 'standard@test.com');
      assert.equal(result.userId, 'user2');
    });

    it('finds user by Salesforce ID', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'user3', 'ManageUsers');

      assert.equal(result.user, 'readonly@test.com');
      assert.equal(result.userId, 'user3');
    });

    it('throws descriptive error for non-existent user', async () => {
      const dbPath = await createTempDBFromSeed();

      await assert.rejects(
        async () => traceUserPermission(dbPath, 'nonexistent@test.com', 'ManageUsers'),
        {
          name: 'Error',
          message: 'User not found: nonexistent@test.com',
        }
      );
    });
  });

  describe('direct permission lookup', () => {
    it('finds permission in Profile', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'ManageUsers');

      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].type, 'Profile');
      assert.equal(result.sources[0].name, 'Admin');
      assert.equal(result.sources[0].value, 'true');
    });

    it('finds permission in directly assigned Permission Set', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'ViewDashboard');

      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].type, 'PermissionSet');
      assert.equal(result.sources[0].name, 'Sales Operations');
      assert.equal(result.sources[0].value, 'true');
    });

    it('returns empty sources for permission not found', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'readonly@test.com', 'NonExistentPermission');

      assert.equal(result.user, 'readonly@test.com');
      assert.equal(result.userId, 'user3');
      assert.equal(result.permission, 'NonExistentPermission');
      assert.equal(result.sources.length, 0);
    });
  });

  describe('wildcard matching', () => {
    it('matches Account.* to Account.Industry field', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.*');

      assert.ok(result.sources.length > 0);
      const profileSource = result.sources.find(s => s.type === 'Profile');
      assert.ok(profileSource);
      assert.equal(profileSource.name, 'Admin');
    });

    it('matches Account.* to all Account field permissions', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.*');

      const profileSource = result.sources.find(s => s.type === 'Profile');
      assert.ok(profileSource);
    });
  });

  describe('implication rules', () => {
    it('finds field permission directly when editable/readable', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.Industry');

      assert.ok(result.sources.length > 0);
      const profileSource = result.sources.find(s => s.type === 'Profile');
      assert.ok(profileSource);
      assert.equal(profileSource.value, 'Edit');
    });

    it('Object Read implies field Read', async () => {
      const dbPath = await createTempDBFromSeed();
      const db = new Database(dbPath);

      db.prepare(`
        INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value)
        VALUES ('Profile', 'Standard', 'ObjectPermission', 'Contact.Read', 'true')
      `).run();

      db.close();

      const result = await traceUserPermission(dbPath, 'readonly@test.com', 'Contact.SomeField');

      const profileSource = result.sources.find(s => s.type === 'Profile');
      assert.ok(profileSource);
      assert.equal(profileSource.value, 'true');
    });
  });

  describe('Permission Set Group expansion', () => {
    it('expands PSG to member Permission Sets for object permissions', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'standard@test.com', 'Account.*');

      const psgSource = result.sources.find(s =>
        s.type === 'PermissionSet' && s.name === 'Sales Operations'
      );
      assert.ok(psgSource, 'Should find SalesOps PS via SalesBundle PSG');
      assert.ok(['true'].includes(psgSource.value));
    });

    it('traces permission through PSG chain to underlying PS', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'standard@test.com', 'ViewDashboard');

      const psgSource = result.sources.find(s =>
        s.type === 'PermissionSet' && s.name === 'Sales Operations'
      );
      assert.ok(psgSource, 'Should find ViewDashboard in SalesOps PS via PSG');
      assert.equal(psgSource.value, 'true');
    });
  });

  describe('multiple sources', () => {
    it('returns all granting sources when permission exists in multiple places', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.*');

      assert.ok(result.sources.length >= 2, 'Should find in both Profile and PS');

      const profileSource = result.sources.find(s => s.type === 'Profile');
      assert.ok(profileSource);
      assert.equal(profileSource.name, 'Admin');

      const psSource = result.sources.find(s => s.type === 'PermissionSet');
      assert.ok(psSource);
      assert.equal(psSource.name, 'Sales Operations');
    });

    it('includes both direct PS and PSG-sourced PS', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'standard@test.com', 'Account.*');

      assert.ok(result.sources.length >= 2);
      assert.ok(result.sources.some(s => s.name === 'Marketing User'));
      assert.ok(result.sources.some(s => s.name === 'Sales Operations'));
    });
  });

  describe('verbose option', () => {
    it('includes chain array when verbose is true', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.*', { verbose: true });

      assert.ok(result.sources.length > 0);
      const source = result.sources[0];
      assert.ok(source.chain);
      assert.ok(Array.isArray(source.chain));
    });

    it('omits chain when verbose is false', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.*', { verbose: false });

      assert.ok(result.sources.length > 0);
      const source = result.sources[0];
      assert.equal(source.chain, undefined);
    });

    it('omits chain by default', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'Account.*');

      assert.ok(result.sources.length > 0);
      const source = result.sources[0];
      assert.equal(source.chain, undefined);
    });

    it('chain shows PSG expansion path', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'standard@test.com', 'ViewDashboard', { verbose: true });

      const psgSource = result.sources.find(s => s.name === 'Sales Operations');
      assert.ok(psgSource);
      assert.ok(psgSource.chain);
      assert.equal(psgSource.chain.length, 2);
      assert.ok(psgSource.chain[0].includes('PermissionSetGroup'));
      assert.ok(psgSource.chain[1].includes('PermissionSet'));
    });
  });

  describe('case insensitivity', () => {
    it('matches permission names case-insensitively', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'manageusers');

      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].type, 'Profile');
      assert.equal(result.sources[0].value, 'true');
    });

    it('matches permission names with mixed case', async () => {
      const dbPath = await createTempDBFromSeed();
      const result = await traceUserPermission(dbPath, 'admin@test.com', 'aCcOuNt.*');

      assert.ok(result.sources.length > 0);
    });
  });
});
