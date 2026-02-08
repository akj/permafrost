import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { seedDatabase } from '../../../helpers/db-setup.js';
import {
  analyzeProfilePSRedundancy,
  analyzeMultiplePSRedundancy,
  analyzePSGRedundancy,
  analyzeProfileOnlyPermissions,
  analyzeAllRedundancy,
} from '../../../../src/lib/analyzers/redundancy.js';

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

describe('redundancy analyzers', () => {
  let dbPath;

  beforeEach(async () => {
    dbPath = await createTempDBFromSeed();
  });

  afterEach(() => {
    cleanupTempDBs();
  });

  describe('analyzeProfilePSRedundancy', () => {
    it('identifies permissions redundant between profiles and permission sets', async () => {
      const result = await analyzeProfilePSRedundancy(dbPath);

      assert.equal(result.type, 'profile_ps_redundancy');
      assert.ok(result.summary);
      assert.ok(Array.isArray(result.details));

      assert.ok(result.summary.total_redundant_permissions >= 0);
      assert.ok(result.summary.affected_users >= 0);
      assert.ok(result.summary.affected_permission_sets >= 0);
    });

    it('finds redundant permissions for admin user', async () => {
      const result = await analyzeProfilePSRedundancy(dbPath);

      const adminEntry = result.details.find(d => d.user === 'admin@test.com');
      assert.ok(adminEntry, 'Should find admin user with redundant permissions');
      assert.ok(adminEntry.permission_sets.includes('SalesOps'));
    });

    it('excludes profile-owned permission sets', async () => {
      const result = await analyzeProfilePSRedundancy(dbPath);

      const hasProfileOwned = result.details.some(d =>
        d.permission_sets.includes('ProfileMirrorPS'),
      );
      assert.equal(hasProfileOwned, false, 'Should exclude profile-owned PS');
    });
  });

  describe('analyzeMultiplePSRedundancy', () => {
    it('identifies permissions granted by multiple permission sets', async () => {
      const result = await analyzeMultiplePSRedundancy(dbPath);

      assert.equal(result.type, 'multiple_ps_redundancy');
      assert.ok(result.summary);
      assert.ok(Array.isArray(result.details));

      assert.ok(result.summary.total_redundant_permissions >= 0);
      assert.ok(result.summary.affected_users >= 0);
    });

    it('includes source_count for each redundant permission', async () => {
      const result = await analyzeMultiplePSRedundancy(dbPath);

      if (result.details.length > 0) {
        const entry = result.details[0];
        assert.ok(entry.source_count >= 2, 'Redundant permission should have 2+ sources');
        assert.ok(Array.isArray(entry.permission_sets));
      }
    });

    it('excludes profile-owned permission sets', async () => {
      const result = await analyzeMultiplePSRedundancy(dbPath);

      const hasProfileOwned = result.details.some(d =>
        d.permission_sets.includes('ProfileMirrorPS'),
      );
      assert.equal(hasProfileOwned, false, 'Should exclude profile-owned PS');
    });
  });

  describe('analyzePSGRedundancy', () => {
    it('identifies users assigned to both PSG and member PS', async () => {
      const result = await analyzePSGRedundancy(dbPath);

      assert.equal(result.type, 'psg_redundancy');
      assert.ok(result.summary);
      assert.ok(Array.isArray(result.details));

      assert.ok(result.summary.total_redundant_assignments >= 0);
      assert.ok(result.summary.affected_users >= 0);
    });

    it('finds redundant SalesBundle assignment for user2', async () => {
      const result = await analyzePSGRedundancy(dbPath);

      const user2Entry = result.details.find(d => d.user === 'standard@test.com');
      if (user2Entry) {
        assert.equal(user2Entry.psg, 'SalesBundle');
        assert.ok(user2Entry.redundant_ps.includes('SalesOps'));
      }
    });

    it('only includes active PSGs (status=Updated)', async () => {
      const result = await analyzePSGRedundancy(dbPath);

      const hasInactive = result.details.some(d => d.psg === 'InactiveBundle');
      assert.equal(hasInactive, false, 'Should exclude inactive PSGs');
    });
  });

  describe('analyzeProfileOnlyPermissions', () => {
    it('identifies permissions that exist only in profiles', async () => {
      const result = await analyzeProfileOnlyPermissions(dbPath);

      assert.equal(result.type, 'profile_only_permissions');
      assert.ok(result.summary);
      assert.ok(Array.isArray(result.details));

      assert.ok(result.summary.total_profile_only >= 0);
      assert.ok(result.summary.profiles_affected >= 0);
      assert.ok(result.summary.percentage_profile_only >= 0);
    });

    it('groups permissions by profile', async () => {
      const result = await analyzeProfileOnlyPermissions(dbPath);

      if (result.details.length > 0) {
        const profile = result.details[0];
        assert.ok(profile.profile_id);
        assert.ok(Array.isArray(profile.permissions));
        assert.ok(profile.count >= 0);
      }
    });

    it('includes permission type in details', async () => {
      const result = await analyzeProfileOnlyPermissions(dbPath);

      const adminProfile = result.details.find(d =>
        d.profile_id === 'Admin' || d.profile_name === 'Admin',
      );
      if (adminProfile && adminProfile.permissions.length > 0) {
        const perm = adminProfile.permissions[0];
        assert.ok(perm.name);
        assert.ok(perm.type);
      }
    });
  });

  describe('analyzeAllRedundancy', () => {
    it('runs all redundancy analyses', async () => {
      const result = await analyzeAllRedundancy(dbPath);

      assert.ok(result.profile_ps_redundancy);
      assert.ok(result.multiple_ps_redundancy);
      assert.ok(result.psg_redundancy);
      assert.ok(result.profile_only_permissions);

      assert.equal(result.profile_ps_redundancy.type, 'profile_ps_redundancy');
      assert.equal(result.multiple_ps_redundancy.type, 'multiple_ps_redundancy');
      assert.equal(result.psg_redundancy.type, 'psg_redundancy');
      assert.equal(result.profile_only_permissions.type, 'profile_only_permissions');
    });

    it('handles errors gracefully with error property', async () => {
      const result = await analyzeAllRedundancy('/nonexistent/path.db');

      assert.ok(result.profile_ps_redundancy.error || result.profile_ps_redundancy.summary);
      assert.ok(result.multiple_ps_redundancy.error || result.multiple_ps_redundancy.summary);
    });
  });
});
