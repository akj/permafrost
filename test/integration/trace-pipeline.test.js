import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { initDatabase, insertProfiles, insertPermissionSets, insertPermissionSetGroups, insertPSGMembers, insertPermissions, insertUserAssignments } from '../../src/lib/database.js';
import { parseProfiles, parsePermissionSets, parsePermissionSetGroups } from '../../src/lib/parser.js';
import { traceUserPermission } from '../../src/lib/tracer.js';
import { FIXTURES_DIR } from '../helpers/fixture-path.js';

describe('Trace Pipeline Integration Tests', () => {
  let testDB;

  it('should setup database with parsed fixtures and user assignments', async () => {
    testDB = path.join(os.tmpdir(), `permafrost-test-${randomUUID()}.db`);

    await initDatabase(testDB);

    const profiles = await parseProfiles(FIXTURES_DIR);
    const permissionSets = await parsePermissionSets(FIXTURES_DIR);
    const permissionSetGroups = await parsePermissionSetGroups(FIXTURES_DIR);

    await insertProfiles(testDB, profiles);
    await insertPermissionSets(testDB, permissionSets);
    await insertPermissionSetGroups(testDB, permissionSetGroups);

    const psgMembers = [];
    for (const psg of permissionSetGroups) {
      for (const memberName of psg.members) {
        psgMembers.push({
          psgId: psg.fullName,
          psId: memberName,
        });
      }
    }
    await insertPSGMembers(testDB, psgMembers);

    const allPermissions = [];

    for (const profile of profiles) {
      for (const perm of profile.permissions) {
        allPermissions.push({
          sourceType: 'Profile',
          sourceId: profile.fullName,
          permissionType: perm.type,
          permissionName: perm.name,
          permissionValue: perm.value,
        });
      }
    }

    for (const ps of permissionSets) {
      for (const perm of ps.permissions) {
        allPermissions.push({
          sourceType: 'PermissionSet',
          sourceId: ps.fullName,
          permissionType: perm.type,
          permissionName: perm.name,
          permissionValue: perm.value,
        });
      }
    }

    await insertPermissions(testDB, allPermissions);

    const userAssignments = [
      {
        Id: 'user1-id',
        Username: 'user1@example.com',
        Email: 'user1@example.com',
        ProfileId: 'Admin',
        Profile: { Name: 'Admin' },
      },
      {
        AssigneeId: 'user1-id',
        Assignee: { Username: 'user1@example.com', Email: 'user1@example.com' },
        PermissionSet: { Name: 'SalesOps' },
        Id: 'assignment1',
      },
      {
        Id: 'user2-id',
        Username: 'user2@example.com',
        Email: 'user2@example.com',
        ProfileId: 'Standard',
        Profile: { Name: 'Standard' },
      },
      {
        AssigneeId: 'user2-id',
        Assignee: { Username: 'user2@example.com', Email: 'user2@example.com' },
        PermissionSet: { Name: 'MarketingUser' },
        Id: 'assignment2',
      },
      {
        AssigneeId: 'user2-id',
        Assignee: { Username: 'user2@example.com', Email: 'user2@example.com' },
        PermissionSetGroupId: 'SalesBundle',
        PermissionSetGroup: { DeveloperName: 'SalesBundle' },
        Id: 'assignment3',
      },
    ];

    await insertUserAssignments(testDB, userAssignments);

    assert.ok(true, 'Database setup complete');
  });

  it('should trace exact match permission from profile', async () => {
    const result = await traceUserPermission(testDB, 'user1@example.com', 'ManageUsers');

    assert.strictEqual(result.user, 'user1@example.com', 'Should identify user');
    assert.strictEqual(result.userId, 'user1-id', 'Should have user ID');
    assert.strictEqual(result.permission, 'ManageUsers', 'Should have permission name');
    assert.ok(result.sources.length > 0, 'Should have at least one source');

    const profileSource = result.sources.find(s => s.type === 'Profile');
    assert.ok(profileSource, 'Should find permission from Profile');
    assert.strictEqual(profileSource.name, 'Admin', 'Should be from Admin profile');
  });

  it('should trace permission from permission set', async () => {
    const result = await traceUserPermission(testDB, 'user1@example.com', 'ViewDashboard');

    assert.strictEqual(result.user, 'user1@example.com', 'Should identify user');
    assert.ok(result.sources.length > 0, 'Should have at least one source');

    const psSource = result.sources.find(s => s.type === 'PermissionSet' && s.name === 'Sales Operations');
    assert.ok(psSource, 'Should find permission from SalesOps PS');
  });

  it('should return empty sources for non-existent permission', async () => {
    const result = await traceUserPermission(testDB, 'user1@example.com', 'NonExistentPermission');

    assert.strictEqual(result.user, 'user1@example.com', 'Should identify user');
    assert.strictEqual(result.sources.length, 0, 'Should have no sources');
  });

  it('should trace permission via PSG expansion', async () => {
    const result = await traceUserPermission(testDB, 'user2@example.com', 'ViewDashboard');

    assert.strictEqual(result.user, 'user2@example.com', 'Should identify user');
    assert.ok(result.sources.length > 0, 'Should have at least one source');

    const psgSource = result.sources.find(s => s.type === 'PermissionSet' && s.name === 'Sales Operations');
    assert.ok(psgSource, 'Should find permission from SalesOps via PSG');
  });

  it('should trace wildcard permissions', async () => {
    const result = await traceUserPermission(testDB, 'user1@example.com', 'Account.*');

    assert.strictEqual(result.user, 'user1@example.com', 'Should identify user');
    assert.ok(result.sources.length > 0, 'Should have sources with Account permissions');

    const profileSource = result.sources.find(s => s.type === 'Profile');
    assert.ok(profileSource, 'Should find Account.* matches from Profile');
  });

  it('should trace object permissions from multiple sources', async () => {
    const result = await traceUserPermission(testDB, 'user1@example.com', 'Account.Edit');

    assert.strictEqual(result.user, 'user1@example.com', 'Should identify user');
    assert.ok(result.sources.length > 0, 'Should have sources');

    const profileSource = result.sources.find(s => s.type === 'Profile');
    assert.ok(profileSource, 'Should find from Profile');

    const psSource = result.sources.find(s => s.type === 'PermissionSet');
    assert.ok(psSource, 'Should find from PermissionSet');
  });

  after(() => {
    if (testDB && fs.existsSync(testDB)) {
      fs.unlinkSync(testDB);
    }
  });
});
