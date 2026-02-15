import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { seedDatabase } from '../../../helpers/db-setup.js';
import { analyzeDependencyHealth, analyzeFLSImplications } from '../../../../src/lib/analyzers/dependency.js';
import { seedUniversalDependencies } from '../../../../src/lib/database.js';

const tempFiles = [];

afterEach(() => {
  for (const file of tempFiles) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
  tempFiles.length = 0;
});

function getTempDbPath() {
  const p = path.join(os.tmpdir(), `permafrost-dep-test-${randomUUID()}.db`);
  tempFiles.push(p);
  return p;
}

async function createSeededDb() {
  const mem = seedDatabase();
  const dbPath = getTempDbPath();
  await mem.backup(dbPath);
  mem.close();
  return dbPath;
}

describe('analyzeDependencyHealth', () => {
  it('returns empty findings when all dependencies satisfied', async () => {
    const dbPath = await createSeededDb();
    await seedUniversalDependencies(dbPath);

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.type, 'dependency_health');
    assert.equal(result.no_dependency_rules, false);
    assert.equal(result.no_permissions, false);
    assert.equal(result.summary.total_violations, 0);
    assert.equal(result.summary.by_severity.error, 0);
    assert.equal(result.summary.by_severity.warning, 0);
    assert.equal(result.summary.by_severity.info, 0);
    assert.equal(result.summary.sources_with_issues, 0);
    assert.ok(result.summary.sources_analyzed > 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.score, 100);
  });

  it('detects missing CRUD prerequisite', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();
    db.prepare('DELETE FROM permission_dependencies').run();

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);

    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'ObjectPermission', 'Account.Edit', 'true');

    db.prepare('INSERT INTO permission_dependencies (dependency_type, from_permission, to_permission, severity, is_universal) VALUES (?, ?, ?, ?, ?)')
      .run('CRUD_HIERARCHY', 'Account.Edit', 'Account.Read', 'WARNING', 1);
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.summary.total_violations, 1);
    assert.equal(result.summary.by_severity.warning, 1);
    assert.equal(result.findings.length, 1);

    const finding = result.findings[0];
    assert.equal(finding.source_type, 'PermissionSet');
    assert.equal(finding.source_id, 'TestPS');
    assert.equal(finding.from_permission, 'Account.Edit');
    assert.equal(finding.to_permission, 'Account.Read');
    assert.equal(finding.dependency_type, 'CRUD_HIERARCHY');
    assert.equal(finding.severity, 'WARNING');
    assert.equal(finding.message, 'Account.Edit requires Account.Read');
  });

  it('detects field-object violation', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();
    db.prepare('DELETE FROM permission_dependencies').run();

    db.prepare('INSERT INTO permission_dependencies (dependency_type, from_permission, to_permission, severity, is_universal) VALUES (?, ?, ?, ?, ?)')
      .run('CRUD_HIERARCHY', 'Account.Edit', 'Account.Read', 'WARNING', 1);

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);

    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'FieldPermission', 'Lead.Status', 'Edit');
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.summary.total_violations, 1);
    assert.equal(result.summary.by_severity.warning, 1);
    assert.equal(result.findings.length, 1);

    const finding = result.findings[0];
    assert.equal(finding.source_type, 'PermissionSet');
    assert.equal(finding.source_id, 'TestPS');
    assert.equal(finding.from_permission, 'Lead.Status');
    assert.equal(finding.to_permission, 'Lead.Read');
    assert.equal(finding.dependency_type, 'FIELD_OBJECT');
    assert.equal(finding.severity, 'WARNING');
    assert.equal(finding.message, 'Lead.Status requires Lead.Read');
  });

  it('filters profile-owned PS', async () => {
    const dbPath = await createSeededDb();
    await seedUniversalDependencies(dbPath);

    const db = new Database(dbPath);
    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'ProfileMirrorPS', 'FieldPermission', 'Contact.Email', 'Edit');
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    const hasProfileMirror = result.findings.some(f => f.source_id === 'ProfileMirrorPS');
    assert.equal(hasProfileMirror, false, 'ProfileMirrorPS should not appear in findings');

    const sourcesAnalyzed = result.summary.sources_analyzed;
    const db2 = new Database(dbPath);
    const totalSources = db2.prepare(`
      SELECT COUNT(DISTINCT p.source_id) as count FROM permissions p
      LEFT JOIN permission_sets ps ON p.source_id = ps.id AND p.source_type = 'PermissionSet'
      WHERE p.source_type = 'Profile' OR (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
    `).get().count;
    db2.close();

    assert.equal(sourcesAnalyzed, totalSources);
  });

  it('calculates health score', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();
    db.prepare('DELETE FROM permission_dependencies').run();

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);

    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)').run('PermissionSet', 'TestPS', 'ObjectPermission', 'Account.Edit', 'true');
    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)').run('PermissionSet', 'TestPS', 'ObjectPermission', 'Lead.Edit', 'true');

    db.prepare('INSERT INTO permission_dependencies (dependency_type, from_permission, to_permission, severity, is_universal) VALUES (?, ?, ?, ?, ?)')
      .run('CRUD_HIERARCHY', 'Account.Edit', 'Account.Read', 'WARNING', 1);
    db.prepare('INSERT INTO permission_dependencies (dependency_type, from_permission, to_permission, severity, is_universal) VALUES (?, ?, ?, ?, ?)')
      .run('CRUD_HIERARCHY', 'Lead.Edit', 'Lead.Read', 'ERROR', 1);
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.summary.by_severity.error, 1);
    assert.equal(result.summary.by_severity.warning, 1);

    const totalPermissions = 2;
    const weightedViolations = 1 * 3 + 1 * 1;
    const expectedScore = Math.max(0, Math.min(100, Math.round(100 * (1 - (weightedViolations / totalPermissions)))));

    assert.equal(result.score, expectedScore);
  });

  it('handles missing permission_dependencies table', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DROP TABLE IF EXISTS permission_dependencies').run();
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);
    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'ObjectPermission', 'Account.Read', 'true');
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.type, 'dependency_health');
    assert.equal(result.no_dependency_rules, true);
    assert.equal(result.summary.total_violations, 0);
    assert.equal(result.summary.sources_analyzed, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.score, 100);
  });

  it('handles empty permission_dependencies table', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permission_dependencies').run();
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);
    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'ObjectPermission', 'Account.Read', 'true');
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.type, 'dependency_health');
    assert.equal(result.no_dependency_rules, true);
    assert.equal(result.summary.total_violations, 0);
    assert.equal(result.summary.sources_analyzed, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.score, 100);
  });

  it('handles empty permissions table', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_dependencies').run();

    db.prepare('INSERT INTO permission_dependencies (dependency_type, from_permission, to_permission, severity, is_universal) VALUES (?, ?, ?, ?, ?)')
      .run('CRUD_HIERARCHY', 'Account.Edit', 'Account.Read', 'WARNING', 1);
    db.close();

    const result = await analyzeDependencyHealth(dbPath);

    assert.equal(result.type, 'dependency_health');
    assert.equal(result.no_dependency_rules, false);
    assert.equal(result.no_permissions, true);
    assert.equal(result.summary.total_violations, 0);
    assert.equal(result.summary.sources_analyzed, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.score, 100);
  });
});

describe('analyzeFLSImplications', () => {
  it('detects Edit+Read redundancy', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);

    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'FieldPermission', 'Account.Industry', 'Edit');
    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'FieldPermission', 'Account.Industry', 'Read');
    db.close();

    const result = await analyzeFLSImplications(dbPath);

    assert.equal(result.findings.length, 1);

    const finding = result.findings[0];
    assert.equal(finding.source_type, 'PermissionSet');
    assert.equal(finding.source_id, 'TestPS');
    assert.equal(finding.field, 'Account.Industry');
    assert.equal(finding.severity, 'INFO');
    assert.equal(finding.message, 'Read permission redundant - Edit implies Read for Account.Industry');
  });

  it('no findings when only Edit exists', async () => {
    const dbPath = await createSeededDb();

    const db = new Database(dbPath);
    db.prepare('DELETE FROM permissions').run();
    db.prepare('DELETE FROM permission_sets').run();

    db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile) VALUES (?, ?, ?, ?)')
      .run('TestPS', 'TestPS', 'Test PS', 0);

    db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)')
      .run('PermissionSet', 'TestPS', 'FieldPermission', 'Account.Industry', 'Edit');
    db.close();

    const result = await analyzeFLSImplications(dbPath);

    assert.equal(result.findings.length, 0);
  });
});
