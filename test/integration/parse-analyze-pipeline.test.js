import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { initDatabase, insertProfiles, insertPermissionSets, insertPermissionSetGroups, insertPSGMembers, insertPermissions, insertUserAssignments } from '../../src/lib/database.js';
import { parseProfiles, parsePermissionSets, parsePermissionSetGroups } from '../../src/lib/parser.js';
import { analyzeAllRedundancy } from '../../src/lib/analyzers/redundancy.js';
import { analyzePermissionSetOverlap } from '../../src/lib/analyzers/overlap.js';
import { analyzeObjectAccess } from '../../src/lib/analyzers/object-view.js';
import { aggregateForReport } from '../../src/lib/analyzers/report-aggregator.js';
import { generateJsonReport } from '../../src/lib/reporters/json.js';
import { generateMarkdownReport } from '../../src/lib/reporters/markdown.js';
import { fixturePath, FIXTURES_DIR } from '../helpers/fixture-path.js';

describe('Parse-Analyze Pipeline Integration Tests', () => {
  let testDB;

  it('should execute end-to-end pipeline from parse to report', async () => {
    testDB = path.join(os.tmpdir(), `permafrost-test-${randomUUID()}.db`);

    await initDatabase(testDB);

    const profiles = await parseProfiles(FIXTURES_DIR);
    const permissionSets = await parsePermissionSets(FIXTURES_DIR);
    const permissionSetGroups = await parsePermissionSetGroups(FIXTURES_DIR);

    assert.ok(profiles.length > 0, 'Should parse profiles');
    assert.ok(permissionSets.length > 0, 'Should parse permission sets');
    assert.ok(permissionSetGroups.length > 0, 'Should parse permission set groups');

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

    const redundancyResults = await analyzeAllRedundancy(testDB);
    assert.ok(redundancyResults.profile_ps_redundancy, 'Should have profile_ps_redundancy');
    assert.ok(redundancyResults.multiple_ps_redundancy, 'Should have multiple_ps_redundancy');
    assert.ok(redundancyResults.psg_redundancy, 'Should have psg_redundancy');
    assert.ok(redundancyResults.profile_only_permissions, 'Should have profile_only_permissions');
    assert.ok(typeof redundancyResults.profile_ps_redundancy.summary === 'object', 'Should have summary object');

    const overlapResults = await analyzePermissionSetOverlap(testDB);
    assert.ok(overlapResults.pairs, 'Should have pairs array');
    assert.ok(Array.isArray(overlapResults.pairs), 'Pairs should be an array');

    const objectAccessResults = await analyzeObjectAccess(testDB, 'Account');
    assert.ok(objectAccessResults.sources, 'Should have sources array');
    assert.ok(Array.isArray(objectAccessResults.sources), 'Sources should be an array');
    assert.ok(objectAccessResults.sources.length > 0, 'Should have at least one source');
    assert.strictEqual(objectAccessResults.object, 'Account', 'Should analyze Account object');

    const rawResults = {
      redundancy: redundancyResults,
      overlap: overlapResults,
      objectAccess: objectAccessResults,
    };

    const aggregated = aggregateForReport(testDB, rawResults);
    assert.ok(aggregated.executiveSummary, 'Should have executiveSummary');
    assert.ok(aggregated.executiveSummary.metrics, 'Should have metrics');
    assert.ok(Array.isArray(aggregated.executiveSummary.metrics), 'Metrics should be an array');

    const jsonReport = generateJsonReport(rawResults, { dbPath: testDB });
    assert.ok(jsonReport.length > 0, 'JSON report should not be empty');
    assert.ok(jsonReport.includes('"metadata"'), 'JSON should contain metadata');
    assert.ok(jsonReport.includes('"analysis"'), 'JSON should contain analysis');

    const markdownReport = generateMarkdownReport(rawResults, aggregated);
    assert.ok(markdownReport.length > 0, 'Markdown report should not be empty');
    assert.ok(markdownReport.includes('# Salesforce Permission Analysis Report'), 'Markdown should contain title');
    assert.ok(markdownReport.includes('## Analysis Summary'), 'Markdown should contain summary section');
  });

  after(() => {
    if (testDB && fs.existsSync(testDB)) {
      fs.unlinkSync(testDB);
    }
  });
});
