import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

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
  `);

  db.close();
  return dbPath;
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
      profile.custom ? 1 : 0
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
      ps.license
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
      perm.permissionValue
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
    const assigneeType = assignment.PermissionSetGroupId 
      ? 'PermissionSetGroup' 
      : 'PermissionSet';
    
    const assigneeId = assignment.PermissionSetGroupId || assignment.PermissionSetId;

    insert.run(
      assignment.AssigneeId,
      assignment.Assignee?.Username,
      assignment.Assignee?.Email,
      assigneeType,
      assigneeId,
      assignment.Id
    );
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
