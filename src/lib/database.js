import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Opens a readonly database, passes it to fn, and ensures it closes.
 * @param {string} dbPath - Path to database file
 * @param {function(Database): *} fn - Receives the open db, returns the result
 * @returns {*} Whatever fn returns
 */
export function withReadonlyDatabase(dbPath, fn) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Initialize SQLite database with schema
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Database>} Database instance
 */
export async function initDatabase(dbPath) {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      user_license TEXT,
      is_custom BOOLEAN
    );

    CREATE TABLE IF NOT EXISTS permission_sets (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      label TEXT,
      is_owned_by_profile BOOLEAN,
      license TEXT
    );

    CREATE TABLE IF NOT EXISTS permission_set_groups (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      label TEXT,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS psg_members (
      psg_id TEXT NOT NULL,
      ps_id TEXT NOT NULL,
      PRIMARY KEY (psg_id, ps_id),
      FOREIGN KEY (psg_id) REFERENCES permission_set_groups(id),
      FOREIGN KEY (ps_id) REFERENCES permission_sets(id)
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      permission_type TEXT NOT NULL,
      permission_name TEXT NOT NULL,
      permission_value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_permission_lookup 
      ON permissions(permission_name, source_id);

    CREATE TABLE IF NOT EXISTS user_assignments (
      user_id TEXT NOT NULL,
      user_username TEXT,
      user_email TEXT,
      assignee_type TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      assignment_id TEXT,
      PRIMARY KEY (user_id, assignee_type, assignee_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_lookup 
      ON user_assignments(user_id);
    
    CREATE INDEX IF NOT EXISTS idx_user_email_lookup
      ON user_assignments(user_email);

    CREATE TABLE IF NOT EXISTS permission_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dependency_type TEXT NOT NULL CHECK(
        dependency_type IN (
          'CRUD_HIERARCHY',
          'FLS_HIERARCHY',
          'FIELD_OBJECT',
          'MASTER_DETAIL',
          'REQUIRED_LOOKUP',
          'RECORDTYPE_OBJECT',
          'TAB_OBJECT',
          'LICENSE_RESTRICTION',
          'CUSTOM_PERM_HIERARCHY',
          'USER_PERM_OVERRIDE'
        )
      ),
      from_permission TEXT NOT NULL,
      to_permission TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'WARNING' CHECK(severity IN ('ERROR', 'WARNING', 'INFO')),
      is_universal BOOLEAN NOT NULL DEFAULT 1,
      metadata TEXT,
      UNIQUE(dependency_type, from_permission COLLATE NOCASE, to_permission COLLATE NOCASE)
    );

    CREATE INDEX IF NOT EXISTS idx_dep_from ON permission_dependencies(from_permission);
    CREATE INDEX IF NOT EXISTS idx_dep_to ON permission_dependencies(to_permission, dependency_type);
  `);

  db.close();
  return dbPath;
}

/**
 * Execute function within a database transaction
 * @param {string} dbPath - Path to database file
 * @param {Function} fn - Function to execute (receives db instance)
 * @returns {Promise<any>} Result from function
 */
export async function withTransaction(dbPath, fn) {
  const db = new Database(dbPath);

  try {
    db.exec('BEGIN TRANSACTION');
    const result = await fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Insert profiles into database
 * @param {string} dbPath - Path to database file
 * @param {Array} profiles - Array of profile objects
 */
export async function insertProfiles(dbPath, profiles) {
  const db = new Database(dbPath);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO profiles (id, full_name, user_license, is_custom)
    VALUES (?, ?, ?, ?)
  `);

  for (const profile of profiles) {
    insert.run(
      profile.fullName,
      profile.fullName,
      profile.userLicense,
      profile.custom ? 1 : 0,
    );
  }

  db.close();
}

/**
 * Insert permission sets into database
 * @param {string} dbPath - Path to database file
 * @param {Array} permissionSets - Array of permission set objects
 */
export async function insertPermissionSets(dbPath, permissionSets) {
  const db = new Database(dbPath);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO permission_sets (id, full_name, label, license)
    VALUES (?, ?, ?, ?)
  `);

  for (const ps of permissionSets) {
    insert.run(
      ps.fullName,
      ps.fullName,
      ps.label,
      ps.license,
    );
  }

  db.close();
}

/**
 * Insert permission set groups into database
 * @param {string} dbPath - Path to database file
 * @param {Array} permissionSetGroups - Array of permission set group objects
 */
export async function insertPermissionSetGroups(dbPath, permissionSetGroups) {
  const db = new Database(dbPath);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO permission_set_groups (id, full_name, label, status)
    VALUES (?, ?, ?, ?)
  `);

  for (const psg of permissionSetGroups) {
    insert.run(
      psg.fullName,
      psg.fullName,
      psg.label,
      psg.status,
    );
  }

  db.close();
}

/**
 * Insert PSG member mappings into database
 * @param {string} dbPath - Path to database file
 * @param {Array} members - Array of {psgId, psId} objects
 */
export async function insertPSGMembers(dbPath, members) {
  const db = new Database(dbPath);

  const checkPs = db.prepare('SELECT id FROM permission_sets WHERE id = ?');
  const checkPsg = db.prepare('SELECT id FROM permission_set_groups WHERE id = ?');
  const insert = db.prepare(`
    INSERT OR REPLACE INTO psg_members (psg_id, ps_id)
    VALUES (?, ?)
  `);

  for (const member of members) {
    // Skip if referenced PS or PSG doesn't exist in DB
    if (!checkPsg.get(member.psgId) || !checkPs.get(member.psId)) continue;
    insert.run(
      member.psgId,
      member.psId,
    );
  }

  db.close();
}

/**
 * Insert permissions into database
 * @param {string} dbPath - Path to database file
 * @param {Array} permissions - Array of permission objects
 */
export async function insertPermissions(dbPath, permissions) {
  const db = new Database(dbPath);

  // Delete existing permissions per source for idempotency (DL-008)
  const deletePerm = db.prepare('DELETE FROM permissions WHERE source_id = ?');
  const seen = new Set();
  for (const perm of permissions) {
    if (!seen.has(perm.sourceId)) {
      deletePerm.run(perm.sourceId);
      seen.add(perm.sourceId);
    }
  }

  const insert = db.prepare(`
    INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const perm of permissions) {
    insert.run(
      perm.sourceType,
      perm.sourceId,
      perm.permissionType,
      perm.permissionName,
      perm.permissionValue,
    );
  }

  db.close();
}

/**
 * Insert user assignments into database
 * @param {string} dbPath - Path to database file
 * @param {Array} assignments - Array of assignment objects
 */
export async function insertUserAssignments(dbPath, assignments) {
  const db = new Database(dbPath);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO user_assignments 
    (user_id, user_username, user_email, assignee_type, assignee_id, assignment_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const assignment of assignments) {
    // Profile assignments from queryUsers() have ProfileId field
    if (assignment.ProfileId) {
      // Use Profile.Name to match source_id in permissions table
      const profileName = assignment.Profile?.Name || assignment.ProfileId;
      insert.run(
        assignment.Id,
        assignment.Username,
        assignment.Email,
        'Profile',
        profileName,
        null,
      );
      continue;
    }

    // PS/PSG assignments from queryUserAssignments()
    // Use Name/DeveloperName to match source_id in permissions table
    if (assignment.PermissionSetGroupId) {
      const psgName = assignment.PermissionSetGroup?.DeveloperName || assignment.PermissionSetGroupId;
      insert.run(
        assignment.AssigneeId,
        assignment.Assignee?.Username,
        assignment.Assignee?.Email,
        'PermissionSetGroup',
        psgName,
        assignment.Id,
      );
    } else {
      const psName = assignment.PermissionSet?.Name || assignment.PermissionSetId;
      insert.run(
        assignment.AssigneeId,
        assignment.Assignee?.Username,
        assignment.Assignee?.Email,
        'PermissionSet',
        psName,
        assignment.Id,
      );
    }
  }

  db.close();
}

/**
 * Export entire database to JSON
 * @param {string} dbPath - Path to database file
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Exported data
 */
export async function exportDatabase(dbPath, options = {}) {
  const db = new Database(dbPath, { readonly: true });

  const include = options.include || ['all'];
  const data = {};

  if (include.includes('all') || include.includes('profiles')) {
    data.profiles = db.prepare('SELECT * FROM profiles').all();
  }

  if (include.includes('all') || include.includes('permissionsets')) {
    data.permissionSets = db.prepare('SELECT * FROM permission_sets').all();
  }

  if (include.includes('all') || include.includes('permissionsetgroups')) {
    data.permissionSetGroups = db.prepare('SELECT * FROM permission_set_groups').all();
  }

  if (include.includes('all') || include.includes('permissions')) {
    data.permissions = db.prepare('SELECT * FROM permissions').all();
  }

  if (include.includes('all') || include.includes('users')) {
    data.userAssignments = db.prepare('SELECT * FROM user_assignments').all();
  }

  db.close();
  return data;
}

/**
 * Seed universal dependency rules.
 *
 * Seeds 8 CRUD hierarchy edges (ViewAll→Read, ModifyAll→{ViewAll,Edit,Read,Create,Delete}, Edit→Read, Delete→Read)
 * for all objects in the permissions table. These represent Salesforce's universal permission hierarchy.
 *
 * Uses INSERT OR IGNORE to avoid duplicates when re-seeding. This approach avoids upsert complexity while maintaining idempotency.
 *
 * @param {string} dbPath - Path to database file
 * @returns {Promise<number>} Number of objects seeded
 */
export async function seedUniversalDependencies(dbPath) {
  return withTransaction(dbPath, async (db) => {
    const objects = db.prepare(`
      SELECT DISTINCT SUBSTR(permission_name, 1, INSTR(permission_name, '.') - 1) AS object_name
      FROM permissions
      WHERE permission_type = 'ObjectPermission'
        AND INSTR(permission_name, '.')
    `).all();

    if (objects.length === 0) {
      return 0;
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO permission_dependencies
      (dependency_type, from_permission, to_permission, severity, is_universal)
      VALUES (?, ?, ?, ?, ?)
    `);

    const edges = [
      ['ViewAll', 'Read'],
      ['ModifyAll', 'ViewAll'],
      ['ModifyAll', 'Edit'],
      ['ModifyAll', 'Read'],
      ['ModifyAll', 'Create'],
      ['ModifyAll', 'Delete'],
      ['Edit', 'Read'],
      ['Delete', 'Read'],
    ];

    for (const obj of objects) {
      for (const [from, to] of edges) {
        insert.run('CRUD_HIERARCHY', `${obj.object_name}.${from}`, `${obj.object_name}.${to}`, 'WARNING', 1);
      }
    }

    return objects.length;
  });
}
