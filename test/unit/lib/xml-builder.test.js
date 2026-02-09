import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XMLParser } from 'fast-xml-parser';
import { seedMigrationDatabase } from '../../helpers/migration-db-setup.js';
import { buildPermissionSetXml, buildPermissionSetGroupXml, exportPlanToDirectory } from '../../../src/lib/xml-builder.js';
import { extractPermissions } from '../../../src/lib/parser.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
});

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { recursive: true, force: true });
    }
  }
  tempFiles.length = 0;
});

function createTempDbPath() {
  const tempPath = path.join(os.tmpdir(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempFiles.push(tempPath);
  return tempPath;
}

describe('xml-builder', () => {
  describe('buildPermissionSetXml', () => {
    it('generates valid XML with correct namespace and declaration', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', []);

      assert.ok(result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(result.xml.includes('xmlns="http://soap.sforce.com/2006/04/metadata"'));
      assert.strictEqual(result.filename, 'SalesOps.permissionset-meta.xml');
    });

    it('groups ObjectPermissions by object with boolean CRUD flags', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', []);
      const parsed = xmlParser.parse(result.xml);

      const objPerms = Array.isArray(parsed.PermissionSet.objectPermissions)
        ? parsed.PermissionSet.objectPermissions
        : [parsed.PermissionSet.objectPermissions];

      const accountPerm = objPerms.find(p => p.object === 'Account');
      assert.ok(accountPerm);
      assert.strictEqual(accountPerm.allowCreate, true);
      assert.strictEqual(accountPerm.allowRead, true);
      assert.strictEqual(accountPerm.allowEdit, true);
      assert.strictEqual(accountPerm.allowDelete, true);
    });

    it('converts FieldPermission Edit to editable=true readable=true', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', []);
      const parsed = xmlParser.parse(result.xml);

      const fieldPerms = Array.isArray(parsed.PermissionSet.fieldPermissions)
        ? parsed.PermissionSet.fieldPermissions
        : [parsed.PermissionSet.fieldPermissions];

      const industryPerm = fieldPerms.find(p => p.field === 'Account.Industry');
      assert.ok(industryPerm);
      assert.strictEqual(industryPerm.editable, true);
      assert.strictEqual(industryPerm.readable, true);
    });

    it('converts UserPermission to name + enabled', async () => {
      const db = seedMigrationDatabase();
      db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)').run(
        'PermissionSet',
        'SalesOps',
        'UserPermission',
        'ManageUsers',
        'true'
      );
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', []);
      const parsed = xmlParser.parse(result.xml);

      const userPerms = Array.isArray(parsed.PermissionSet.userPermissions)
        ? parsed.PermissionSet.userPermissions
        : [parsed.PermissionSet.userPermissions];

      const managePerm = userPerms.find(p => p.name === 'ManageUsers');
      assert.ok(managePerm);
      assert.strictEqual(managePerm.enabled, true);
    });

    it('adds permissions via ADD_PERMISSION operation', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const operations = [
        {
          operation: 'ADD_PERMISSION',
          parameters: JSON.stringify({
            permission_type: 'UserPermission',
            permission_name: 'ViewSetup',
            permission_value: 'true',
          }),
        },
      ];

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', operations);
      const parsed = xmlParser.parse(result.xml);

      const userPerms = Array.isArray(parsed.PermissionSet.userPermissions)
        ? parsed.PermissionSet.userPermissions
        : [parsed.PermissionSet.userPermissions];

      const viewSetupPerm = userPerms.find(p => p.name === 'ViewSetup');
      assert.ok(viewSetupPerm);
      assert.strictEqual(viewSetupPerm.enabled, true);
    });

    it('removes permissions via REMOVE_PERMISSION operation', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const operations = [
        {
          operation: 'REMOVE_PERMISSION',
          parameters: JSON.stringify({
            permission_type: 'CustomPermission',
            permission_name: 'ViewDashboard',
            permission_value: 'true',
          }),
        },
      ];

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', operations);
      const parsed = xmlParser.parse(result.xml);

      const customPerms = parsed.PermissionSet.customPermissions;
      assert.strictEqual(customPerms, undefined);
    });

    it('REMOVE_PERMISSION for nonexistent permission is a no-op', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const operations = [
        {
          operation: 'REMOVE_PERMISSION',
          parameters: JSON.stringify({
            permission_type: 'UserPermission',
            permission_name: 'NonExistent',
            permission_value: 'true',
          }),
        },
      ];

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', operations);
      assert.ok(result.xml);
    });
  });

  describe('buildPermissionSetGroupXml', () => {
    it('generates XML with label and permissionSets members', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const result = await buildPermissionSetGroupXml(tempPath, 'SalesBundle', []);
      const parsed = xmlParser.parse(result.xml);

      assert.ok(result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.strictEqual(parsed.PermissionSetGroup.label, 'Sales Bundle');

      const members = Array.isArray(parsed.PermissionSetGroup.permissionSets)
        ? parsed.PermissionSetGroup.permissionSets
        : [parsed.PermissionSetGroup.permissionSets];

      assert.ok(members.includes('SalesOps'));
      assert.strictEqual(result.filename, 'SalesBundle.permissionsetgroup-meta.xml');
    });
  });

  describe('exportPlanToDirectory', () => {
    it('creates correct directory structure and writes files', async () => {
      const db = seedMigrationDatabase();

      db.prepare('INSERT INTO migration_plans (id, name, description, target_org, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        'plan-001',
        'Test Plan',
        'Test',
        'target@test.com',
        'draft',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );

      db.prepare('INSERT INTO plan_operations (id, plan_id, operation, entity_type, entity_id, parameters, status, execution_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        'op-001',
        'plan-001',
        'ADD_PERMISSION',
        'PermissionSet',
        'SalesOps',
        JSON.stringify({ permission_type: 'UserPermission', permission_name: 'ViewSetup', permission_value: 'true' }),
        'pending',
        100
      );

      db.prepare('INSERT INTO plan_operations (id, plan_id, operation, entity_type, entity_id, parameters, status, execution_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        'op-002',
        'plan-001',
        'ADD_PSG_MEMBER',
        'PermissionSetGroup',
        'SalesBundle',
        JSON.stringify({ member_id: 'MarketingUser' }),
        'pending',
        200
      );

      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const outputDir = path.join(os.tmpdir(), `export-${Date.now()}`);
      tempFiles.push(outputDir);

      await exportPlanToDirectory(tempPath, 'plan-001', outputDir);

      assert.ok(fs.existsSync(path.join(outputDir, 'permissionsets', 'SalesOps.permissionset-meta.xml')));
      assert.ok(fs.existsSync(path.join(outputDir, 'permissionsetgroups', 'SalesBundle.permissionsetgroup-meta.xml')));
    });
  });

  describe('round-trip', () => {
    it('parses generated XML and matches original permissions', async () => {
      const db = seedMigrationDatabase();
      const tempPath = createTempDbPath();
      await db.backup(tempPath);
      db.close();

      const result = await buildPermissionSetXml(tempPath, 'SalesOps', []);
      const parsed = xmlParser.parse(result.xml);
      const extractedPerms = extractPermissions(parsed.PermissionSet);

      const expectedTypes = ['ObjectPermission', 'FieldPermission', 'CustomPermission'];
      for (const type of expectedTypes) {
        const permsOfType = extractedPerms.filter(p => p.type === type);
        assert.ok(permsOfType.length > 0, `Expected ${type} permissions`);
      }

      const accountCreatePerm = extractedPerms.find(
        p => p.type === 'ObjectPermission' && p.name === 'Account.Create' && p.value === 'true'
      );
      assert.ok(accountCreatePerm, 'Expected Account.Create permission');

      const fieldPerm = extractedPerms.find(
        p => p.type === 'FieldPermission' && p.name === 'Account.Industry' && p.value === 'Edit'
      );
      assert.ok(fieldPerm, 'Expected Account.Industry Edit permission');

      const customPerm = extractedPerms.find(
        p => p.type === 'CustomPermission' && p.name === 'ViewDashboard' && p.value === 'true'
      );
      assert.ok(customPerm, 'Expected ViewDashboard custom permission');
    });
  });
});
