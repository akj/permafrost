import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { seedDatabase } from '../helpers/db-setup.js';
import { initMigrationSchema } from '../../src/lib/migration-db.js';
import { recommendAllPSGs } from '../../src/lib/analyzers/psg-recommender.js';
import { createPlan, addOperation, getPlan } from '../../src/lib/planner.js';
import { transformRecommendationsToOperations } from '../../src/lib/import-transformer.js';

describe('Recommend-Plan Pipeline Integration Tests', () => {
  let dbPath;

  afterEach(() => {
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should pipe recommendAllPSGs output through transformRecommendationsToOperations into a plan', async () => {
    dbPath = path.join(os.tmpdir(), `recommend-pipeline-${randomUUID()}.db`);

    const db = seedDatabase();
    await db.backup(dbPath);
    db.close();

    await initMigrationSchema(dbPath);

    const recOutput = await recommendAllPSGs(dbPath);

    assert.ok(recOutput, 'recommendAllPSGs should return a result');
    assert.ok(recOutput.hierarchical, 'Should have hierarchical key');
    assert.ok(recOutput.coAssignment, 'Should have coAssignment key');

    // Verify real output shape is wrapper objects, not raw arrays
    assert.ok(!Array.isArray(recOutput.hierarchical), 'hierarchical should be a wrapper object, not an array');
    assert.ok(!Array.isArray(recOutput.coAssignment), 'coAssignment should be a wrapper object, not an array');
    assert.strictEqual(recOutput.hierarchical.type, 'hierarchical_psg_recommendations');
    assert.strictEqual(recOutput.coAssignment.type, 'co_assignment_recommendations');

    const operations = transformRecommendationsToOperations(recOutput);

    assert.ok(Array.isArray(operations), 'Operations should be an array');

    // Create a plan and import operations
    const plan = await createPlan(dbPath, {
      name: 'PSG Recommendation Plan',
      targetOrg: 'test-org',
      sourceOrg: 'test-org',
      description: 'Integration test: recommend → plan import',
    });

    assert.ok(plan.id, 'Plan should have an ID');

    for (const op of operations) {
      await addOperation(dbPath, plan.id, {
        operation: op.operation,
        entityType: op.entity_type,
        entityId: op.entity_id,
        parameters: op.parameters,
      });
    }

    const retrievedPlan = await getPlan(dbPath, plan.id);

    assert.ok(retrievedPlan, 'Should retrieve plan');
    assert.strictEqual(retrievedPlan.operations.length, operations.length, 'Plan should have same number of operations');

    if (operations.length > 0) {
      const operationTypes = new Set(retrievedPlan.operations.map(op => op.operation));
      assert.ok(operationTypes.has('CREATE_PSG') || operationTypes.has('ADD_PSG_MEMBER'),
        'Should have PSG-related operations');
    }
  });
});
