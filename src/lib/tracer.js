import Database from 'better-sqlite3';

/**
 * Trace permission sources for a user
 * @param {string} dbPath - Path to database file
 * @param {string} userIdentifier - User email, username, or Salesforce ID
 * @param {string} permissionName - Permission name to trace (e.g., 'Account.Edit')
 * @param {Object} options - Trace options
 * @returns {Promise<Object>} Trace result with sources
 */
export async function traceUserPermission(dbPath, userIdentifier, permissionName, options = {}) {
  const db = new Database(dbPath, { readonly: true });
  
  try {
    // Find user
    const user = findUser(db, userIdentifier);
    
    if (!user) {
      throw new Error(`User not found: ${userIdentifier}`);
    }

    // Get all permission sources for user (profile, direct PS, PSG → PS)
    const sources = resolveUserSources(db, user.user_id);
    
    // Check each source for the permission
    const grantingSources = [];
    
    for (const source of sources) {
      const hasPermission = checkPermissionInSource(db, source.assignee_id, permissionName);
      
      if (hasPermission) {
        grantingSources.push({
          type: source.assignee_type,
          name: source.name,
          id: source.assignee_id,
          value: hasPermission.permission_value,
          chain: options.verbose ? source.chain : undefined
        });
      }
    }

    return {
      user: user.user_email || user.user_username,
      userId: user.user_id,
      permission: permissionName,
      sources: grantingSources
    };
    
  } finally {
    db.close();
  }
}

/**
 * Find user by email, username, or ID
 * @param {Database} db - Database instance
 * @param {string} identifier - User identifier
 * @returns {Object|null} User record
 */
function findUser(db, identifier) {
  const query = db.prepare(`
    SELECT DISTINCT user_id, user_username, user_email
    FROM user_assignments
    WHERE user_id = ? OR user_email = ? OR user_username = ?
    LIMIT 1
  `);
  
  return query.get(identifier, identifier, identifier);
}

/**
 * Resolve all permission sources for a user
 * @param {Database} db - Database instance
 * @param {string} userId - User Salesforce ID
 * @returns {Array} Array of permission sources
 */
function resolveUserSources(db, userId) {
  const sources = [];
  
  // Get direct assignments (Profile, PermissionSet, PermissionSetGroup)
  const assignments = db.prepare(`
    SELECT assignee_type, assignee_id
    FROM user_assignments
    WHERE user_id = ?
  `).all(userId);

  for (const assignment of assignments) {
    if (assignment.assignee_type === 'Profile') {
      const profile = db.prepare('SELECT full_name FROM profiles WHERE id = ?').get(assignment.assignee_id);
      sources.push({
        assignee_type: 'Profile',
        assignee_id: assignment.assignee_id,
        name: profile?.full_name || 'Unknown Profile',
        chain: ['Profile']
      });
    } else if (assignment.assignee_type === 'PermissionSet') {
      const ps = db.prepare('SELECT full_name, label FROM permission_sets WHERE id = ?').get(assignment.assignee_id);
      sources.push({
        assignee_type: 'PermissionSet',
        assignee_id: assignment.assignee_id,
        name: ps?.label || ps?.full_name || 'Unknown Permission Set',
        chain: ['PermissionSet']
      });
    } else if (assignment.assignee_type === 'PermissionSetGroup') {
      // Expand PSG to member permission sets
      const members = expandPSGChain(db, assignment.assignee_id);
      
      for (const member of members) {
        sources.push({
          assignee_type: 'PermissionSet',
          assignee_id: member.ps_id,
          name: member.name,
          chain: [`PermissionSetGroup: ${member.psg_name}`, `PermissionSet: ${member.name}`]
        });
      }
    }
  }

  return sources;
}

/**
 * Expand Permission Set Group to member Permission Sets
 * @param {Database} db - Database instance
 * @param {string} psgId - Permission Set Group ID
 * @returns {Array} Array of member permission sets
 */
function expandPSGChain(db, psgId) {
  const psg = db.prepare('SELECT full_name, status FROM permission_set_groups WHERE id = ? AND status = \'Updated\'').get(psgId);

  if (!psg) return [];

  const members = db.prepare(`
    SELECT m.ps_id, ps.full_name, ps.label
    FROM psg_members m
    JOIN permission_sets ps ON m.ps_id = ps.id
    WHERE m.psg_id = ?
  `).all(psgId);

  return members.map(m => ({
    ps_id: m.ps_id,
    name: m.label || m.full_name,
    psg_name: psg.full_name
  }));
}

/**
 * Check if a permission exists in a source (profile or permission set)
 * @param {Database} db - Database instance
 * @param {string} sourceId - Source ID (profile or permission set)
 * @param {string} permissionName - Permission name
 * @returns {Object|null} Permission record if found
 */
function checkPermissionInSource(db, sourceId, permissionName) {
  // Case-insensitive exact match (DL-009)
  let permission = db.prepare(`
    SELECT * FROM permissions
    WHERE source_id = ? AND permission_name = ? COLLATE NOCASE
  `).get(sourceId, permissionName);

  if (permission) return permission;

  // Wildcard matching: Account.* matches Account.Edit, Account.Create, etc. (DL-003)
  if (permissionName.endsWith('.*')) {
    const prefix = permissionName.slice(0, -1); // "Account."
    const matches = db.prepare(`
      SELECT * FROM permissions
      WHERE source_id = ? AND permission_name LIKE ? COLLATE NOCASE
    `).all(sourceId, `${prefix}%`);

    if (matches.length > 0) {
      // Return first match but indicate it's a wildcard result
      return { ...matches[0], wildcard_matches: matches.length };
    }
  }

  // FLS Edit implies Read: if checking for field Read and field has Edit, return it (DL-004)
  // Field permissions have names like "Account.Industry" with value "Edit" or "Read"
  const fieldPerm = db.prepare(`
    SELECT * FROM permissions
    WHERE source_id = ? AND permission_name = ? COLLATE NOCASE
      AND permission_type = 'FieldPermission' AND permission_value = 'Edit'
  `).get(sourceId, permissionName);

  if (fieldPerm) return fieldPerm;

  // Object Read implies field Read: if checking for a field (e.g. Account.Industry)
  // and the object has Read access, the field is readable (DL-004)
  if (permissionName.includes('.')) {
    const objectName = permissionName.split('.')[0];
    const objectRead = db.prepare(`
      SELECT * FROM permissions
      WHERE source_id = ? AND permission_name = ? COLLATE NOCASE
        AND permission_type = 'ObjectPermission'
    `).get(sourceId, `${objectName}.Read`);

    if (objectRead) return objectRead;
  }

  return null;
}
