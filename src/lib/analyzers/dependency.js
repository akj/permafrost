import { withReadonlyDatabase } from '../database.js';

/**
 * Analyze permission dependency health
 * @param {string} dbPath - Path to SQLite database
 * @returns {Object} Dependency health analysis
 */
export function analyzeDependencyHealth(dbPath) {
  return withReadonlyDatabase(dbPath, (db) => {
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='permission_dependencies'
    `).get();

    if (!tableExists) {
      return {
        type: 'dependency_health',
        no_dependency_rules: true,
        summary: {
          total_violations: 0,
          by_severity: { error: 0, warning: 0, info: 0 },
          sources_analyzed: 0,
          sources_with_issues: 0,
        },
        findings: [],
        score: 100,
      };
    }

    const depCount = db.prepare('SELECT COUNT(*) as count FROM permission_dependencies').get();
    if (depCount.count === 0) {
      return {
        type: 'dependency_health',
        no_dependency_rules: true,
        summary: {
          total_violations: 0,
          by_severity: { error: 0, warning: 0, info: 0 },
          sources_analyzed: 0,
          sources_with_issues: 0,
        },
        findings: [],
        score: 100,
      };
    }

    const permCount = db.prepare(`
      SELECT COUNT(*) as count FROM permissions p
      LEFT JOIN permission_sets ps ON p.source_id = ps.id AND p.source_type = 'PermissionSet'
      WHERE p.source_type = 'Profile' OR (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
    `).get();

    if (permCount.count === 0) {
      return {
        type: 'dependency_health',
        no_dependency_rules: false,
        no_permissions: true,
        summary: {
          total_violations: 0,
          by_severity: { error: 0, warning: 0, info: 0 },
          sources_analyzed: 0,
          sources_with_issues: 0,
        },
        findings: [],
        score: 100,
      };
    }

    const findings = [];
    const sources = new Set();

    const crudQuery = db.prepare(`
      SELECT DISTINCT
        p.source_type,
        p.source_id,
        p.permission_name AS from_permission,
        pd.to_permission,
        pd.dependency_type,
        pd.severity
      FROM permissions p
      JOIN permission_dependencies pd ON p.permission_name = pd.from_permission
      LEFT JOIN permission_sets ps ON p.source_id = ps.id AND p.source_type = 'PermissionSet'
      LEFT JOIN permissions p2 ON p2.source_type = p.source_type AND p2.source_id = p.source_id AND p2.permission_name = pd.to_permission
      WHERE (p.source_type = 'Profile' OR (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL))
        AND p2.id IS NULL
        AND pd.dependency_type = 'CRUD_HIERARCHY'
    `);

    for (const row of crudQuery.all()) {
      findings.push({
        source_type: row.source_type,
        source_id: row.source_id,
        from_permission: row.from_permission,
        to_permission: row.to_permission,
        dependency_type: row.dependency_type,
        severity: row.severity,
        message: `${row.from_permission} requires ${row.to_permission}`,
      });
      sources.add(row.source_id);
    }

    const fieldObjectQuery = db.prepare(`
      SELECT DISTINCT
        p.source_type,
        p.source_id,
        p.permission_name AS field_permission,
        SUBSTR(p.permission_name, 1, INSTR(p.permission_name, '.') - 1) || '.Read' AS required_object_permission
      FROM permissions p
      LEFT JOIN permission_sets ps ON p.source_id = ps.id AND p.source_type = 'PermissionSet'
      LEFT JOIN permissions p2 ON p2.source_id = p.source_id
        AND p2.permission_name = SUBSTR(p.permission_name, 1, INSTR(p.permission_name, '.') - 1) || '.Read'
        AND p2.permission_type = 'ObjectPermission'
      WHERE p.permission_type = 'FieldPermission'
        AND (p.source_type = 'Profile' OR (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL))
        AND p2.id IS NULL
    `);

    for (const row of fieldObjectQuery.all()) {
      findings.push({
        source_type: row.source_type,
        source_id: row.source_id,
        from_permission: row.field_permission,
        to_permission: row.required_object_permission,
        dependency_type: 'FIELD_OBJECT',
        severity: 'WARNING',
        message: `${row.field_permission} requires ${row.required_object_permission}`,
      });
      sources.add(row.source_id);
    }

    const totalSources = db.prepare(`
      SELECT COUNT(DISTINCT p.source_id) as count FROM permissions p
      LEFT JOIN permission_sets ps ON p.source_id = ps.id AND p.source_type = 'PermissionSet'
      WHERE p.source_type = 'Profile' OR (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL)
    `).get().count;

    const totalPermissions = permCount.count;

    const severityCounts = { error: 0, warning: 0, info: 0 };
    findings.forEach(f => {
      severityCounts[f.severity.toLowerCase()]++;
    });

    // Weighted scoring: error*3, warning*1, info*0.25
    // Balances severity impact (errors are critical) vs noise (info findings should have minimal impact)
    const weightedViolations = severityCounts.error * 3 + severityCounts.warning * 1 + severityCounts.info * 0.25;
    const score = Math.max(0, Math.min(100, Math.round(100 * (1 - (weightedViolations / totalPermissions)))));

    return {
      type: 'dependency_health',
      no_dependency_rules: false,
      no_permissions: false,
      summary: {
        total_violations: findings.length,
        by_severity: severityCounts,
        sources_analyzed: totalSources,
        sources_with_issues: sources.size,
      },
      findings,
      score,
    };
  });
}

/**
 * Analyze FLS implications (Edit implies Read)
 * @param {string} dbPath - Path to SQLite database
 * @returns {Object} FLS implication findings
 */
export function analyzeFLSImplications(dbPath) {
  return withReadonlyDatabase(dbPath, (db) => {
    const query = db.prepare(`
      SELECT DISTINCT
        p1.source_type,
        p1.source_id,
        p1.permission_name
      FROM permissions p1
      JOIN permissions p2 ON p1.source_id = p2.source_id AND p1.permission_name = p2.permission_name AND p1.permission_value != p2.permission_value
      LEFT JOIN permission_sets ps ON p1.source_id = ps.id AND p1.source_type = 'PermissionSet'
      WHERE p1.permission_type = 'FieldPermission'
        AND p1.permission_value = 'Edit'
        AND p2.permission_value = 'Read'
        AND (p1.source_type = 'Profile' OR (ps.is_owned_by_profile = 0 OR ps.is_owned_by_profile IS NULL))
    `);

    const findings = query.all().map(row => ({
      source_type: row.source_type,
      source_id: row.source_id,
      field: row.permission_name,
      severity: 'INFO',
      message: `Read permission redundant - Edit implies Read for ${row.permission_name}`,
    }));

    return { findings };
  });
}
