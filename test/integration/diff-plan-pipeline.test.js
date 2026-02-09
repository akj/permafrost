import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import Database from 'better-sqlite3';

import { seedSourceDatabase, seedTargetDatabase } from '../helpers/db-setup.js';
import { initDatabase } from '../../src/lib/database.js';
import { initMigrationSchema } from '../../src/lib/migration-db.js';
import { compareOrgs } from '../../src/lib/comparators/org-diff.js';
import { createPlan, addOperation, getPlan } from '../../src/lib/planner.js';
import { transformDiffToOperations } from '../../src/lib/import-transformer.js';
import { exportPlanToDirectory } from '../../src/lib/xml-builder.js';

describe('Diff-Plan Pipeline Integration Tests', () => {
  let sourceDbPath;
  let targetDbPath;
  let outputDir;

  afterEach(() => {
    if (sourceDbPath && fs.existsSync(sourceDbPath)) {
      fs.unlinkSync(sourceDbPath);
    }
    if (targetDbPath && fs.existsSync(targetDbPath)) {
      fs.unlinkSync(targetDbPath);
    }
    if (outputDir && fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('should execute end-to-end diff-plan-export pipeline', async () => {
    sourceDbPath = path.join(os.tmpdir(), `source-${randomUUID()}.db`);
    targetDbPath = path.join(os.tmpdir(), `target-${randomUUID()}.db`);
    outputDir = path.join(os.tmpdir(), `export-${randomUUID()}`);

    const sourceDb = seedSourceDatabase();
    await sourceDb.backup(sourceDbPath);
    sourceDb.close();

    const targetDb = seedTargetDatabase();
    await targetDb.backup(targetDbPath);
    targetDb.close();

    await initMigrationSchema(sourceDbPath);

    const diff = await compareOrgs(sourceDbPath, targetDbPath);

    assert.ok(diff.changes, 'Diff should have changes array');
    assert.ok(Array.isArray(diff.changes), 'Changes should be an array');
    assert.ok(diff.changes.length > 0, 'Should have at least one change');
    assert.ok(diff.source_org, 'Should have source_org');
    assert.ok(diff.target_org, 'Should have target_org');
    assert.ok(diff.summary, 'Should have summary');
    assert.strictEqual(typeof diff.summary.total_changes, 'number', 'Summary should have total_changes count');

    const plan = await createPlan(sourceDbPath, {
      name: 'Test Migration Plan',
      targetOrg: 'target-org',
      sourceOrg: 'source-org',
      description: 'Integration test plan',
    });

    assert.ok(plan.id, 'Plan should have an ID');
    assert.strictEqual(plan.name, 'Test Migration Plan', 'Plan should have correct name');
    assert.strictEqual(plan.status, 'draft', 'Plan should be in draft status');

    const operations = transformDiffToOperations(diff);

    assert.ok(Array.isArray(operations), 'Operations should be an array');
    assert.ok(operations.length > 0, 'Should have at least one operation');

    for (const op of operations) {
      await addOperation(sourceDbPath, plan.id, {
        operation: op.operation,
        entityType: op.entity_type,
        entityId: op.entity_id,
        parameters: op.parameters,
      });
    }

    const retrievedPlan = await getPlan(sourceDbPath, plan.id);

    assert.ok(retrievedPlan, 'Should retrieve plan');
    assert.strictEqual(retrievedPlan.id, plan.id, 'Retrieved plan should match created plan ID');
    assert.ok(retrievedPlan.operations, 'Plan should have operations');
    assert.ok(Array.isArray(retrievedPlan.operations), 'Operations should be an array');
    assert.strictEqual(retrievedPlan.operations.length, operations.length, 'Should have same number of operations');

    const operationTypes = new Set(retrievedPlan.operations.map(op => op.operation));
    assert.ok(operationTypes.size > 0, 'Should have at least one operation type');

    await exportPlanToDirectory(sourceDbPath, plan.id, outputDir);

    assert.ok(fs.existsSync(outputDir), 'Output directory should exist');

    const permissionSetsDir = path.join(outputDir, 'permissionsets');
    const permissionSetGroupsDir = path.join(outputDir, 'permissionsetgroups');

    let xmlFileCount = 0;
    const xmlParser = new XMLParser({ ignoreAttributes: false });

    if (fs.existsSync(permissionSetsDir)) {
      const psFiles = fs.readdirSync(permissionSetsDir).filter(f => f.endsWith('.permissionset-meta.xml'));
      xmlFileCount += psFiles.length;

      for (const file of psFiles) {
        const xmlContent = fs.readFileSync(path.join(permissionSetsDir, file), 'utf-8');
        assert.ok(xmlContent.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'PS XML should have XML declaration');
        assert.ok(xmlContent.includes('<PermissionSet'), 'PS XML should have PermissionSet element');

        const parsed = xmlParser.parse(xmlContent);
        assert.ok(parsed.PermissionSet, 'Should parse valid PermissionSet XML');
        assert.ok(parsed.PermissionSet.label, 'PermissionSet should have label');
      }
    }

    if (fs.existsSync(permissionSetGroupsDir)) {
      const psgFiles = fs.readdirSync(permissionSetGroupsDir).filter(f => f.endsWith('.permissionsetgroup-meta.xml'));
      xmlFileCount += psgFiles.length;

      for (const file of psgFiles) {
        const xmlContent = fs.readFileSync(path.join(permissionSetGroupsDir, file), 'utf-8');
        assert.ok(xmlContent.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'PSG XML should have XML declaration');
        assert.ok(xmlContent.includes('<PermissionSetGroup'), 'PSG XML should have PermissionSetGroup element');

        const parsed = xmlParser.parse(xmlContent);
        assert.ok(parsed.PermissionSetGroup, 'Should parse valid PermissionSetGroup XML');
        assert.ok(parsed.PermissionSetGroup.label, 'PermissionSetGroup should have label');
      }
    }

    assert.ok(xmlFileCount > 0, 'Should generate at least one XML file');
  });
});
