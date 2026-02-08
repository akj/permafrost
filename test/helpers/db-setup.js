import Database from 'better-sqlite3';

export function seedDatabase() {
  const db = new Database(':memory:');

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

  const data = buildTestData();

  const insertProfile = db.prepare('INSERT INTO profiles (id, full_name, user_license, is_custom) VALUES (?, ?, ?, ?)');
  data.profiles.forEach(p => insertProfile.run(p.id, p.full_name, p.user_license, p.is_custom));

  const insertPS = db.prepare('INSERT INTO permission_sets (id, full_name, label, is_owned_by_profile, license) VALUES (?, ?, ?, ?, ?)');
  data.permissionSets.forEach(ps => insertPS.run(ps.id, ps.full_name, ps.label, ps.is_owned_by_profile, ps.license));

  const insertPSG = db.prepare('INSERT INTO permission_set_groups (id, full_name, label, status) VALUES (?, ?, ?, ?)');
  data.permissionSetGroups.forEach(psg => insertPSG.run(psg.id, psg.full_name, psg.label, psg.status));

  const insertPSGMember = db.prepare('INSERT INTO psg_members (psg_id, ps_id) VALUES (?, ?)');
  data.psgMembers.forEach(m => insertPSGMember.run(m.psg_id, m.ps_id));

  const insertPermission = db.prepare('INSERT INTO permissions (source_type, source_id, permission_type, permission_name, permission_value) VALUES (?, ?, ?, ?, ?)');
  data.permissions.forEach(p => insertPermission.run(p.source_type, p.source_id, p.permission_type, p.permission_name, p.permission_value));

  const insertUser = db.prepare('INSERT INTO user_assignments (user_id, user_username, user_email, assignee_type, assignee_id, assignment_id) VALUES (?, ?, ?, ?, ?, ?)');
  data.userAssignments.forEach(u => insertUser.run(u.user_id, u.user_username, u.user_email, u.assignee_type, u.assignee_id, u.assignment_id));

  return db;
}

export function buildTestData() {
  return {
    profiles: [
      { id: 'Admin', full_name: 'Admin', user_license: 'Salesforce', is_custom: 0 },
      { id: 'Standard', full_name: 'Standard', user_license: 'Salesforce', is_custom: 0 },
    ],
    permissionSets: [
      { id: 'SalesOps', full_name: 'SalesOps', label: 'Sales Operations', is_owned_by_profile: 0, license: null },
      { id: 'MarketingUser', full_name: 'MarketingUser', label: 'Marketing User', is_owned_by_profile: 0, license: null },
      { id: 'ProfileMirrorPS', full_name: 'ProfileMirrorPS', label: 'Profile Mirror PS', is_owned_by_profile: 1, license: null },
    ],
    permissionSetGroups: [
      { id: 'SalesBundle', full_name: 'SalesBundle', label: 'Sales Bundle', status: 'Updated' },
      { id: 'InactiveBundle', full_name: 'InactiveBundle', label: 'Inactive Bundle', status: 'Outdated' },
    ],
    psgMembers: [
      { psg_id: 'SalesBundle', ps_id: 'SalesOps' },
    ],
    permissions: [
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowCreate' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowDelete' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowEdit' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowRead' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'modifyAllRecords' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'viewAllRecords' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'FieldPermission', permission_name: 'Account.Industry', permission_value: 'editable' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'FieldPermission', permission_name: 'Account.Industry', permission_value: 'readable' },
      { source_type: 'Profile', source_id: 'Admin', permission_type: 'UserPermission', permission_name: 'ManageUsers', permission_value: 'enabled' },

      { source_type: 'Profile', source_id: 'Standard', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowRead' },

      { source_type: 'PermissionSet', source_id: 'SalesOps', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowEdit' },
      { source_type: 'PermissionSet', source_id: 'SalesOps', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowDelete' },
      { source_type: 'PermissionSet', source_id: 'SalesOps', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowRead' },
      { source_type: 'PermissionSet', source_id: 'SalesOps', permission_type: 'FieldPermission', permission_name: 'Account.Industry', permission_value: 'editable' },
      { source_type: 'PermissionSet', source_id: 'SalesOps', permission_type: 'CustomPermission', permission_name: 'ViewDashboard', permission_value: 'enabled' },

      { source_type: 'PermissionSet', source_id: 'MarketingUser', permission_type: 'ObjectPermission', permission_name: 'Account', permission_value: 'allowRead' },
      { source_type: 'PermissionSet', source_id: 'MarketingUser', permission_type: 'FieldPermission', permission_name: 'Account.Industry', permission_value: 'readable' },
      { source_type: 'PermissionSet', source_id: 'MarketingUser', permission_type: 'CustomPermission', permission_name: 'SendEmails', permission_value: 'enabled' },
    ],
    userAssignments: [
      { user_id: 'user1', user_username: 'admin@test.com', user_email: 'admin@test.com', assignee_type: 'Profile', assignee_id: 'Admin', assignment_id: null },
      { user_id: 'user1', user_username: 'admin@test.com', user_email: 'admin@test.com', assignee_type: 'PermissionSet', assignee_id: 'SalesOps', assignment_id: 'psa1' },

      { user_id: 'user2', user_username: 'standard@test.com', user_email: 'standard@test.com', assignee_type: 'Profile', assignee_id: 'Standard', assignment_id: null },
      { user_id: 'user2', user_username: 'standard@test.com', user_email: 'standard@test.com', assignee_type: 'PermissionSet', assignee_id: 'MarketingUser', assignment_id: 'psa2' },
      { user_id: 'user2', user_username: 'standard@test.com', user_email: 'standard@test.com', assignee_type: 'PermissionSetGroup', assignee_id: 'SalesBundle', assignment_id: 'psga1' },

      { user_id: 'user3', user_username: 'readonly@test.com', user_email: 'readonly@test.com', assignee_type: 'Profile', assignee_id: 'Standard', assignment_id: null },
    ],
  };
}
