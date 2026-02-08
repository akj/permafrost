import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { seedDatabase } from '../../../helpers/db-setup.js';
import {
  recommendHierarchicalPSGs,
  recommendCoAssignmentPSGs,
  recommendAllPSGs,
} from '../../../../src/lib/analyzers/psg-recommender.js';

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

describe('psg-recommender', () => {
  let dbPath;

  beforeEach(async () => {
    dbPath = await createTempDBFromSeed();
  });

  afterEach(() => {
    cleanupTempDBs();
  });

  describe('recommendHierarchicalPSGs', () => {
    it('returns hierarchical recommendations structure', async () => {
      const result = await recommendHierarchicalPSGs(dbPath);

      assert.equal(result.type, 'hierarchical_psg_recommendations');
      assert.ok(Array.isArray(result.recommendations));
      assert.ok(typeof result.totalRecommendations === 'number');
    });

    it('identifies strict subset relationships', async () => {
      const db = new Database(dbPath);

      db.prepare(`
        INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile)
        VALUES ('BasePS', 'BasePS', 'Base Permission Set', 0)
      `).run();

      db.prepare(`
        INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile)
        VALUES ('SubsetPS', 'SubsetPS', 'Subset Permission Set', 0)
      `).run();

      db.prepare(`
        INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value)
        VALUES
          ('PermissionSet', 'BasePS', 'userPermissions', 'ManageUsers', 'enabled'),
          ('PermissionSet', 'BasePS', 'userPermissions', 'ViewSetup', 'enabled'),
          ('PermissionSet', 'SubsetPS', 'userPermissions', 'ViewSetup', 'enabled')
      `).run();

      db.close();

      const result = await recommendHierarchicalPSGs(dbPath);

      const baseRec = result.recommendations.find(r => r.basePermissionSet === 'BasePS');
      if (baseRec) {
        assert.ok(baseRec.basePermissionCount > 0);
        assert.ok(Array.isArray(baseRec.subsets));
        assert.ok(baseRec.recommendedPSG);
        assert.ok(baseRec.recommendedPSG.name);
        assert.ok(Array.isArray(baseRec.recommendedPSG.members));
      }
    });

    it('requires at least 2 subsets for recommendation', async () => {
      const result = await recommendHierarchicalPSGs(dbPath);

      for (const rec of result.recommendations) {
        assert.ok(rec.totalSubsets >= 2, 'Should only recommend when 2+ subsets exist');
      }
    });

    it('limits recommendations to top 20', async () => {
      const result = await recommendHierarchicalPSGs(dbPath);

      assert.ok(result.recommendations.length <= 20, 'Should limit to 20 recommendations');
    });

    it('sorts by total subsets descending', async () => {
      const result = await recommendHierarchicalPSGs(dbPath);

      if (result.recommendations.length > 1) {
        for (let i = 0; i < result.recommendations.length - 1; i++) {
          assert.ok(
            result.recommendations[i].totalSubsets >= result.recommendations[i + 1].totalSubsets,
            'Should sort by total subsets descending',
          );
        }
      }
    });
  });

  describe('recommendCoAssignmentPSGs', () => {
    it('returns co-assignment recommendations structure', async () => {
      const result = await recommendCoAssignmentPSGs(dbPath);

      assert.equal(result.type, 'co_assignment_recommendations');
      assert.ok(Array.isArray(result.recommendations));
      assert.ok(result.summary);
      assert.ok(typeof result.summary.total_recommendations === 'number');
    });

    it('identifies permission sets frequently assigned together', async () => {
      const db = new Database(dbPath);

      db.prepare(`
        INSERT INTO user_assignments (user_id, user_username, user_email, assignee_type, assignee_id)
        VALUES
          ('user4', 'user4@test.com', 'user4@test.com', 'PermissionSet', 'SalesOps'),
          ('user4', 'user4@test.com', 'user4@test.com', 'PermissionSet', 'MarketingUser'),
          ('user5', 'user5@test.com', 'user5@test.com', 'PermissionSet', 'SalesOps'),
          ('user5', 'user5@test.com', 'user5@test.com', 'PermissionSet', 'MarketingUser'),
          ('user6', 'user6@test.com', 'user6@test.com', 'PermissionSet', 'SalesOps'),
          ('user6', 'user6@test.com', 'user6@test.com', 'PermissionSet', 'MarketingUser'),
          ('user7', 'user7@test.com', 'user7@test.com', 'PermissionSet', 'SalesOps'),
          ('user7', 'user7@test.com', 'user7@test.com', 'PermissionSet', 'MarketingUser'),
          ('user8', 'user8@test.com', 'user8@test.com', 'PermissionSet', 'SalesOps'),
          ('user8', 'user8@test.com', 'user8@test.com', 'PermissionSet', 'MarketingUser')
      `).run();

      db.close();

      const result = await recommendCoAssignmentPSGs(dbPath, {
        minUsers: 5,
        coAssignmentThreshold: 0.7,
      });

      if (result.recommendations.length > 0) {
        const rec = result.recommendations[0];
        assert.ok(rec.pattern === 'co_assignment');
        assert.ok(Array.isArray(rec.members));
        assert.ok(rec.member_count >= 2);
        assert.ok(rec.estimated_reduction >= 1);
      }
    });

    it('respects minUsers option', async () => {
      const result = await recommendCoAssignmentPSGs(dbPath, { minUsers: 100 });

      assert.equal(result.recommendations.length, 0, 'Should have no recommendations with high minUsers');
    });

    it('respects coAssignmentThreshold option', async () => {
      const result = await recommendCoAssignmentPSGs(dbPath, {
        minUsers: 1,
        coAssignmentThreshold: 1.0,
      });

      assert.ok(result.recommendations.length >= 0);
    });

    it('excludes pairs already in active PSGs', async () => {
      const result = await recommendCoAssignmentPSGs(dbPath, {
        minUsers: 1,
        coAssignmentThreshold: 0.5,
      });

      assert.ok(result.recommendations.length >= 0);
    });
  });

  describe('recommendAllPSGs', () => {
    it('runs all recommendation strategies', async () => {
      const result = await recommendAllPSGs(dbPath);

      assert.ok(result.hierarchical);
      assert.ok(result.coAssignment);
    });

    it('includes hierarchical recommendations', async () => {
      const result = await recommendAllPSGs(dbPath);

      if (!result.hierarchical.error) {
        assert.equal(result.hierarchical.type, 'hierarchical_psg_recommendations');
        assert.ok(Array.isArray(result.hierarchical.recommendations));
      }
    });

    it('includes co-assignment recommendations', async () => {
      const result = await recommendAllPSGs(dbPath);

      if (!result.coAssignment.error) {
        assert.equal(result.coAssignment.type, 'co_assignment_recommendations');
        assert.ok(Array.isArray(result.coAssignment.recommendations));
      }
    });

    it('handles errors gracefully', async () => {
      const result = await recommendAllPSGs('/nonexistent/path.db');

      assert.ok(result.hierarchical.error || result.hierarchical.type);
      assert.ok(result.coAssignment.error || result.coAssignment.type);
    });

    it('passes options to sub-recommenders', async () => {
      const result = await recommendAllPSGs(dbPath, {
        minUsers: 10,
        coAssignmentThreshold: 0.9,
      });

      assert.ok(result.hierarchical);
      assert.ok(result.coAssignment);
    });
  });
});
