import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Retrieve all permission-related metadata from Salesforce org
 * @param {string} orgAlias - Salesforce org alias or username
 * @param {string} outputDir - Directory to store retrieved metadata
 */
export async function retrieveMetadata(orgAlias, outputDir) {
  const metadataTypes = [
    'Profile',
    'PermissionSet',
    'PermissionSetGroup'
  ];

  for (const type of metadataTypes) {
    const orgFlag = orgAlias ? `--target-org ${orgAlias}` : '';
    const cmd = `sf project retrieve start --metadata ${type} ${orgFlag} --output-dir ${outputDir}`;
    
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  }
}

/**
 * Query user permission set assignments from Salesforce org
 * @param {string} orgAlias - Salesforce org alias or username
 * @returns {Promise<Array>} Array of permission set assignments
 */
export async function queryUserAssignments(orgAlias) {
  const query = `
    SELECT Id, AssigneeId, Assignee.Username, Assignee.Email,
           PermissionSetId, PermissionSet.Name,
           PermissionSetGroupId, PermissionSetGroup.DeveloperName
    FROM PermissionSetAssignment
    WHERE Assignee.IsActive = true
  `.trim().replace(/\s+/g, ' ');

  const orgFlag = orgAlias ? `--target-org ${orgAlias}` : '';
  const cmd = `sf data query --query "${query}" ${orgFlag} --json`;
  
  const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  
  return result.result?.records || [];
}

/**
 * Query users and their profile assignments
 * @param {string} orgAlias - Salesforce org alias or username
 * @returns {Promise<Array>} Array of user records
 */
export async function queryUsers(orgAlias) {
  const query = `
    SELECT Id, Username, Email, ProfileId, Profile.Name, IsActive
    FROM User
    WHERE IsActive = true
  `.trim().replace(/\s+/g, ' ');

  const orgFlag = orgAlias ? `--target-org ${orgAlias}` : '';
  const cmd = `sf data query --query "${query}" ${orgFlag} --json`;
  
  const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  
  return result.result?.records || [];
}
