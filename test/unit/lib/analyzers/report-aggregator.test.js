import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { seedDatabase } from '../../../helpers/db-setup.js';
import {
  getContextData,
  aggregateProfilePSRedundancy,
  aggregateMultiplePSRedundancy,
  aggregatePSGRedundancy,
  enrichProfileOnly,
  classifyOverlapPairs,
  buildExecutiveSummary,
  aggregateForReport,
} from '../../../../src/lib/analyzers/report-aggregator.js';

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

describe('report-aggregator', () => {
  let dbPath;

  beforeEach(async () => {
    dbPath = await createTempDBFromSeed();
  });

  afterEach(() => {
    cleanupTempDBs();
  });

  describe('getContextData', () => {
    it('returns context with profile stats', () => {
      const context = getContextData(dbPath);

      assert.ok(context.profileStats instanceof Map);
      assert.ok(context.userStats instanceof Map);
      assert.ok(typeof context.totalUsers === 'number');
    });

    it('includes total permissions per profile', () => {
      const context = getContextData(dbPath);

      if (context.profileStats.size > 0) {
        const [, stats] = context.profileStats.entries().next().value;
        assert.ok(typeof stats.totalPerms === 'number');
        assert.ok(typeof stats.userCount === 'number');
      }
    });

    it('includes user counts per profile', () => {
      const context = getContextData(dbPath);

      const adminStats = context.profileStats.get('Admin');
      if (adminStats) {
        assert.ok(adminStats.userCount >= 0);
      }
    });

    it('includes PS/PSG count per user', () => {
      const context = getContextData(dbPath);

      if (context.userStats.size > 0) {
        const [, stats] = context.userStats.entries().next().value;
        assert.ok(typeof stats.totalPSCount === 'number');
        assert.ok(stats.profileId !== undefined);
      }
    });

    it('indexes userStats by both user_id and email', () => {
      const context = getContextData(dbPath);

      const byEmail = context.userStats.get('admin@test.com');
      const byId = context.userStats.get('user1');

      if (byEmail && byId) {
        assert.equal(byEmail.email, byId.email);
      }
    });
  });

  describe('aggregateProfilePSRedundancy', () => {
    it('aggregates by profile and by PS', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'admin@test.com',
          permission: 'Account',
          value: 'allowEdit',
          profile: 'Admin',
          permission_sets: ['SalesOps'],
        },
      ];

      const result = aggregateProfilePSRedundancy(rawDetails, context.profileStats);

      assert.ok(Array.isArray(result.byProfile));
      assert.ok(Array.isArray(result.byPS));
    });

    it('calculates overlap percentage per profile', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'admin@test.com',
          permission: 'Account',
          value: 'allowEdit',
          profile: 'Admin',
          permission_sets: ['SalesOps'],
        },
      ];

      const result = aggregateProfilePSRedundancy(rawDetails, context.profileStats);

      if (result.byProfile.length > 0) {
        const profile = result.byProfile[0];
        assert.ok(typeof profile.overlapPct === 'number');
        assert.ok(profile.overlapPct >= 0);
        assert.ok(profile.redundantPerms >= 0);
        assert.ok(profile.totalPerms >= 0);
      }
    });

    it('identifies top overlapping PS per profile', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'admin@test.com',
          permission: 'Account',
          value: 'allowEdit',
          profile: 'Admin',
          permission_sets: ['SalesOps', 'MarketingUser'],
        },
      ];

      const result = aggregateProfilePSRedundancy(rawDetails, context.profileStats);

      if (result.byProfile.length > 0) {
        const profile = result.byProfile[0];
        assert.ok(Array.isArray(profile.topOverlappingPS));
        assert.ok(profile.topOverlappingPS.length <= 3);
      }
    });

    it('sorts byProfile by overlap percentage descending', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'admin@test.com',
          permission: 'Account',
          value: 'allowEdit',
          profile: 'Admin',
          permission_sets: ['SalesOps'],
        },
        {
          user: 'standard@test.com',
          permission: 'Account',
          value: 'allowRead',
          profile: 'Standard',
          permission_sets: ['MarketingUser'],
        },
      ];

      const result = aggregateProfilePSRedundancy(rawDetails, context.profileStats);

      if (result.byProfile.length > 1) {
        for (let i = 0; i < result.byProfile.length - 1; i++) {
          assert.ok(result.byProfile[i].overlapPct >= result.byProfile[i + 1].overlapPct);
        }
      }
    });

    it('handles empty details gracefully', () => {
      const context = getContextData(dbPath);
      const result = aggregateProfilePSRedundancy([], context.profileStats);

      assert.deepEqual(result.byProfile, []);
      assert.deepEqual(result.byPS, []);
    });
  });

  describe('aggregateMultiplePSRedundancy', () => {
    it('aggregates by user, PS pair, and permission', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'admin@test.com',
          permission: 'Account',
          value: 'allowEdit',
          permission_sets: ['SalesOps', 'MarketingUser'],
          source_count: 2,
        },
      ];

      const result = aggregateMultiplePSRedundancy(rawDetails, context.userStats);

      assert.ok(Array.isArray(result.byUser));
      assert.ok(Array.isArray(result.byPSPair));
      assert.ok(Array.isArray(result.byPermission));
    });

    it('calculates worst pairs per user', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'admin@test.com',
          permission: 'Account',
          value: 'allowEdit',
          permission_sets: ['SalesOps', 'MarketingUser'],
          source_count: 2,
        },
      ];

      const result = aggregateMultiplePSRedundancy(rawDetails, context.userStats);

      if (result.byUser.length > 0) {
        const user = result.byUser[0];
        assert.ok(Array.isArray(user.worstPairs));
        assert.ok(user.worstPairs.length <= 3);
        assert.ok(user.score);
        assert.ok(['Low', 'Medium', 'High'].includes(user.score));
      }
    });

    it('sorts byUser by redundant perms descending', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          user: 'user1@test.com',
          permission: 'Account',
          value: 'allowEdit',
          permission_sets: ['SalesOps', 'MarketingUser'],
          source_count: 2,
        },
        {
          user: 'user2@test.com',
          permission: 'Contact',
          value: 'allowRead',
          permission_sets: ['SalesOps', 'MarketingUser'],
          source_count: 2,
        },
      ];

      const result = aggregateMultiplePSRedundancy(rawDetails, context.userStats);

      if (result.byUser.length > 1) {
        for (let i = 0; i < result.byUser.length - 1; i++) {
          assert.ok(result.byUser[i].redundantPerms >= result.byUser[i + 1].redundantPerms);
        }
      }
    });

    it('handles empty details gracefully', () => {
      const context = getContextData(dbPath);
      const result = aggregateMultiplePSRedundancy([], context.userStats);

      assert.deepEqual(result.byUser, []);
      assert.deepEqual(result.byPSPair, []);
      assert.deepEqual(result.byPermission, []);
    });
  });

  describe('aggregatePSGRedundancy', () => {
    it('aggregates by PSG', () => {
      const rawDetails = [
        {
          user: 'admin@test.com',
          psg: 'SalesBundle',
          redundant_ps: ['SalesOps'],
        },
      ];

      const result = aggregatePSGRedundancy(rawDetails);

      assert.ok(Array.isArray(result.byPSG));
    });

    it('counts users per redundant PS', () => {
      const rawDetails = [
        {
          user: 'admin@test.com',
          psg: 'SalesBundle',
          redundant_ps: ['SalesOps', 'MarketingUser'],
        },
        {
          user: 'user2@test.com',
          psg: 'SalesBundle',
          redundant_ps: ['SalesOps'],
        },
      ];

      const result = aggregatePSGRedundancy(rawDetails);

      if (result.byPSG.length > 0) {
        const psg = result.byPSG[0];
        assert.ok(Array.isArray(psg.redundantPS));
        assert.ok(psg.redundantPS.length > 0);
        const ps = psg.redundantPS[0];
        assert.ok(ps.ps);
        assert.ok(ps.userCount > 0);
      }
    });

    it('includes example users', () => {
      const rawDetails = [
        {
          user: 'admin@test.com',
          psg: 'SalesBundle',
          redundant_ps: ['SalesOps'],
        },
      ];

      const result = aggregatePSGRedundancy(rawDetails);

      if (result.byPSG.length > 0) {
        const psg = result.byPSG[0];
        assert.ok(Array.isArray(psg.exampleUsers));
        assert.ok(psg.exampleUsers.length <= 3);
      }
    });

    it('handles empty details gracefully', () => {
      const result = aggregatePSGRedundancy([]);
      assert.deepEqual(result.byPSG, []);
    });
  });

  describe('enrichProfileOnly', () => {
    it('enriches profile-only data with context', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          profile_id: 'Admin',
          profile_name: 'Admin',
          permissions: [
            { name: 'ManageUsers', value: 'enabled', type: 'userPermissions' },
          ],
          count: 1,
        },
      ];

      const result = enrichProfileOnly(rawDetails, context.profileStats);

      assert.ok(Array.isArray(result));
      if (result.length > 0) {
        const profile = result[0];
        assert.ok(profile.rank >= 1);
        assert.ok(profile.uniquePerms >= 0);
        assert.ok(profile.pctOfProfile >= 0);
        assert.ok(['Low', 'Medium', 'High'].includes(profile.complexity));
      }
    });

    it('calculates migration complexity', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        {
          profile_id: 'Admin',
          profile_name: 'Admin',
          permissions: Array(150).fill().map((_, i) => ({
            name: `Perm${i}`,
            value: 'enabled',
            type: 'userPermissions',
          })),
          count: 150,
        },
      ];

      const result = enrichProfileOnly(rawDetails, context.profileStats);

      if (result.length > 0) {
        const profile = result[0];
        assert.equal(profile.complexity, 'High');
      }
    });

    it('sorts by unique perms descending and adds rank', () => {
      const context = getContextData(dbPath);
      const rawDetails = [
        { profile_id: 'Admin', profile_name: 'Admin', permissions: [], count: 10 },
        { profile_id: 'Standard', profile_name: 'Standard', permissions: [], count: 5 },
      ];

      const result = enrichProfileOnly(rawDetails, context.profileStats);

      assert.equal(result[0].rank, 1);
      assert.ok(result[0].uniquePerms >= result[1].uniquePerms);
    });

    it('handles empty details gracefully', () => {
      const context = getContextData(dbPath);
      const result = enrichProfileOnly([], context.profileStats);
      assert.deepEqual(result, []);
    });
  });

  describe('classifyOverlapPairs', () => {
    it('classifies overlap relationships', () => {
      const pairs = [
        {
          permission_set_a: { id: 'PSA', name: 'Permission Set A', permission_count: 10 },
          permission_set_b: { id: 'PSB', name: 'Permission Set B', permission_count: 100 },
          metrics: { overlap_percentage: 0.98, jaccard_similarity: 0.5 },
        },
      ];

      const result = classifyOverlapPairs(pairs);

      assert.equal(result.length, 1);
      assert.ok(result[0].relationship);
      assert.ok(result[0].relationship.includes('subset'));
    });

    it('identifies high overlap', () => {
      const pairs = [
        {
          permission_set_a: { id: 'PSA', name: 'Permission Set A', permission_count: 50 },
          permission_set_b: { id: 'PSB', name: 'Permission Set B', permission_count: 50 },
          metrics: { overlap_percentage: 0.85, jaccard_similarity: 0.7 },
        },
      ];

      const result = classifyOverlapPairs(pairs);

      assert.equal(result[0].relationship, 'High overlap');
    });

    it('identifies moderate overlap', () => {
      const pairs = [
        {
          permission_set_a: { id: 'PSA', name: 'Permission Set A', permission_count: 50 },
          permission_set_b: { id: 'PSB', name: 'Permission Set B', permission_count: 50 },
          metrics: { overlap_percentage: 0.6, jaccard_similarity: 0.4 },
        },
      ];

      const result = classifyOverlapPairs(pairs);

      assert.equal(result[0].relationship, 'Moderate overlap');
    });

    it('handles empty pairs gracefully', () => {
      const result = classifyOverlapPairs([]);
      assert.deepEqual(result, []);
    });
  });

  describe('buildExecutiveSummary', () => {
    it('builds metrics and findings from raw results', () => {
      const context = getContextData(dbPath);
      const rawResults = {
        redundancy: {
          profile_ps_redundancy: {
            summary: { total_redundant_permissions: 10, affected_users: 3, affected_permission_sets: 2 },
            details: [],
          },
        },
      };
      const aggregated = {
        profilePSRedundancy: { byProfile: [] },
      };

      const result = buildExecutiveSummary(rawResults, aggregated, context);

      assert.ok(Array.isArray(result.metrics));
      assert.ok(Array.isArray(result.findings));
    });

    it('includes total users metric', () => {
      const context = getContextData(dbPath);
      const rawResults = {};
      const aggregated = {};

      const result = buildExecutiveSummary(rawResults, aggregated, context);

      const totalUsersMetric = result.metrics.find(m => m.label === 'Total Users Analyzed');
      assert.ok(totalUsersMetric);
      assert.ok(totalUsersMetric.value >= 0);
    });

    it('includes findings from top aggregated results', () => {
      const context = getContextData(dbPath);
      const rawResults = {
        redundancy: {
          profile_ps_redundancy: {
            summary: { total_redundant_permissions: 10, affected_users: 3, affected_permission_sets: 2 },
            details: [],
          },
        },
      };
      const aggregated = {
        profilePSRedundancy: {
          byProfile: [
            { profile: 'Admin', overlapPct: 75, redundantPerms: 10 },
          ],
        },
      };

      const result = buildExecutiveSummary(rawResults, aggregated, context);

      const finding = result.findings.find(f => f.title === 'Profile + PS Redundancy');
      if (finding) {
        assert.ok(finding.detail);
        assert.ok(finding.detail.includes('Admin'));
      }
    });
  });

  describe('aggregateForReport', () => {
    it('runs all aggregation functions', () => {
      const rawResults = {
        redundancy: {
          profile_ps_redundancy: { details: [] },
          multiple_ps_redundancy: { details: [] },
          psg_redundancy: { details: [] },
          profile_only_permissions: { details: [] },
        },
        overlap: { pairs: [] },
      };

      const result = aggregateForReport(dbPath, rawResults);

      assert.ok(result.context);
      assert.ok(result.executiveSummary);
      assert.ok(result.profilePSRedundancy);
      assert.ok(result.multiplePSRedundancy);
      assert.ok(result.psgRedundancy);
      assert.ok(result.profileOnly);
      assert.ok(result.overlapClassified);
      assert.ok(result.raw);
    });

    it('includes raw results in output', () => {
      const rawResults = {
        redundancy: {
          profile_ps_redundancy: { details: [] },
          multiple_ps_redundancy: { details: [] },
          psg_redundancy: { details: [] },
          profile_only_permissions: { details: [] },
        },
        overlap: { pairs: [] },
      };

      const result = aggregateForReport(dbPath, rawResults);

      assert.deepEqual(result.raw, rawResults);
    });
  });
});
