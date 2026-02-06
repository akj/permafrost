import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AuthInfo, Connection } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import { parseProfiles, parsePermissionSets, parsePermissionSetGroups } from './parser.js';

/**
 * Create an authenticated connection to a Salesforce org
 * @param {string} orgAlias - Salesforce org alias or username
 * @returns {Promise<Connection>}
 */
async function getConnection(orgAlias) {
  const authInfo = await AuthInfo.create({ username: orgAlias });
  const connection = await Connection.create({ authInfo });
  return connection;
}

/**
 * Locate the nested main/default directory inside SDR's timestamped output.
 * SDR writes to {tmpDir}/metadataPackage_{ts}/main/default/{type}/
 * @param {string} tmpDir - Temp directory used as SDR output
 * @returns {string} Path to the metadata directory containing profiles/, permissionsets/, etc.
 */
function findMetadataDir(tmpDir) {
  const entries = fs.readdirSync(tmpDir);
  const pkgDir = entries.find(e => e.startsWith('metadataPackage_'));
  if (pkgDir) {
    const nested = path.join(tmpDir, pkgDir, 'main', 'default');
    if (fs.existsSync(nested)) return nested;
  }
  return tmpDir;
}

/**
 * Fetch all permission metadata from org using SDR (source-deploy-retrieve).
 * Retrieves to a temp directory, parses the source-format XML, then cleans up.
 * @param {string} orgAlias - Salesforce org alias or username
 * @returns {Promise<{profiles: Array, permissionSets: Array, permissionSetGroups: Array}>}
 */
export async function fetchMetadata(orgAlias) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-perm-'));

  try {
    const componentSet = new ComponentSet([
      { fullName: '*', type: 'Profile' },
      { fullName: '*', type: 'PermissionSet' },
      { fullName: '*', type: 'PermissionSetGroup' }
    ]);

    const retrieve = await componentSet.retrieve({
      usernameOrConnection: orgAlias,
      output: tmpDir,
      merge: false
    });

    await retrieve.pollStatus();

    const metadataDir = findMetadataDir(tmpDir);

    const [profiles, permissionSets, permissionSetGroups] = await Promise.all([
      parseProfiles(metadataDir),
      parsePermissionSets(metadataDir),
      parsePermissionSetGroups(metadataDir)
    ]);

    return { profiles, permissionSets, permissionSetGroups };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Query user permission set assignments from Salesforce org
 * @param {string} orgAlias - Salesforce org alias or username
 * @returns {Promise<Array>} Array of permission set assignments
 */
export async function queryUserAssignments(orgAlias) {
  const connection = await getConnection(orgAlias);
  const result = await connection.query(
    'SELECT Id, AssigneeId, Assignee.Username, Assignee.Email, ' +
    'PermissionSetId, PermissionSet.Name, ' +
    'PermissionSetGroupId, PermissionSetGroup.DeveloperName ' +
    'FROM PermissionSetAssignment WHERE Assignee.IsActive = true'
  );
  return result.records;
}

/**
 * Query users and their profile assignments
 * @param {string} orgAlias - Salesforce org alias or username
 * @returns {Promise<Array>} Array of user records
 */
export async function queryUsers(orgAlias) {
  const connection = await getConnection(orgAlias);
  const result = await connection.query(
    'SELECT Id, Username, Email, ProfileId, Profile.Name, IsActive ' +
    'FROM User WHERE IsActive = true'
  );
  return result.records;
}
