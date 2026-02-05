import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true
});

/**
 * Parse all profile XML files from metadata directory
 * @param {string} metadataDir - Path to metadata directory
 * @returns {Promise<Array>} Array of parsed profile objects
 */
export async function parseProfiles(metadataDir) {
  const profilesDir = path.join(metadataDir, 'profiles');
  
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.profile-meta.xml'));
  const profiles = [];

  for (const file of files) {
    const filePath = path.join(profilesDir, file);
    const profile = await parseProfileFile(filePath);
    profiles.push(profile);
  }

  return profiles;
}

/**
 * Parse a single profile XML file
 * @param {string} filePath - Path to profile XML file
 * @returns {Promise<Object>} Parsed profile object
 */
export async function parseProfileFile(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const parsed = xmlParser.parse(xml);
  const profile = parsed.Profile;

  return {
    fullName: path.basename(filePath, '.profile-meta.xml'),
    userLicense: profile.userLicense,
    custom: profile.custom === 'true',
    permissions: extractPermissions(profile)
  };
}

/**
 * Parse all permission set XML files from metadata directory
 * @param {string} metadataDir - Path to metadata directory
 * @returns {Promise<Array>} Array of parsed permission set objects
 */
export async function parsePermissionSets(metadataDir) {
  const permSetsDir = path.join(metadataDir, 'permissionsets');
  
  if (!fs.existsSync(permSetsDir)) {
    return [];
  }

  const files = fs.readdirSync(permSetsDir).filter(f => f.endsWith('.permissionset-meta.xml'));
  const permissionSets = [];

  for (const file of files) {
    const filePath = path.join(permSetsDir, file);
    const permSet = await parsePermissionSetFile(filePath);
    permissionSets.push(permSet);
  }

  return permissionSets;
}

/**
 * Parse a single permission set XML file
 * @param {string} filePath - Path to permission set XML file
 * @returns {Promise<Object>} Parsed permission set object
 */
export async function parsePermissionSetFile(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const parsed = xmlParser.parse(xml);
  const permSet = parsed.PermissionSet;

  return {
    fullName: path.basename(filePath, '.permissionset-meta.xml'),
    label: permSet.label,
    hasActivationRequired: permSet.hasActivationRequired === 'true',
    license: permSet.license,
    permissions: extractPermissions(permSet)
  };
}

/**
 * Parse all permission set group XML files from metadata directory
 * @param {string} metadataDir - Path to metadata directory
 * @returns {Promise<Array>} Array of parsed permission set group objects
 */
export async function parsePermissionSetGroups(metadataDir) {
  const psgDir = path.join(metadataDir, 'permissionsetgroups');
  
  if (!fs.existsSync(psgDir)) {
    return [];
  }

  const files = fs.readdirSync(psgDir).filter(f => f.endsWith('.permissionsetgroup-meta.xml'));
  const permissionSetGroups = [];

  for (const file of files) {
    const filePath = path.join(psgDir, file);
    const psg = await parsePermissionSetGroupFile(filePath);
    permissionSetGroups.push(psg);
  }

  return permissionSetGroups;
}

/**
 * Parse a single permission set group XML file
 * @param {string} filePath - Path to permission set group XML file
 * @returns {Promise<Object>} Parsed permission set group object
 */
export async function parsePermissionSetGroupFile(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const parsed = xmlParser.parse(xml);
  const psg = parsed.PermissionSetGroup;

  const members = Array.isArray(psg.permissionSets) 
    ? psg.permissionSets 
    : psg.permissionSets 
      ? [psg.permissionSets] 
      : [];

  return {
    fullName: path.basename(filePath, '.permissionsetgroup-meta.xml'),
    label: psg.label,
    status: psg.status,
    members
  };
}

/**
 * Extract all permissions from a profile or permission set object
 * @param {Object} obj - Parsed profile or permission set object
 * @returns {Array} Array of permission objects
 */
function extractPermissions(obj) {
  const permissions = [];

  // Permission types to extract
  const permissionTypes = [
    { key: 'applicationVisibilities', type: 'ApplicationVisibility' },
    { key: 'classAccesses', type: 'ApexClassAccess' },
    { key: 'customMetadataTypeAccesses', type: 'CustomMetadataTypeAccess' },
    { key: 'customPermissions', type: 'CustomPermission' },
    { key: 'fieldPermissions', type: 'FieldPermission' },
    { key: 'objectPermissions', type: 'ObjectPermission' },
    { key: 'pageAccesses', type: 'PageAccess' },
    { key: 'recordTypeVisibilities', type: 'RecordTypeVisibility' },
    { key: 'tabSettings', type: 'TabSetting' },
    { key: 'userPermissions', type: 'UserPermission' }
  ];

  for (const { key, type } of permissionTypes) {
    if (!obj[key]) continue;

    const items = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
    
    for (const item of items) {
      permissions.push({
        type,
        name: extractPermissionName(item, type),
        value: extractPermissionValue(item, type),
        raw: item
      });
    }
  }

  return permissions;
}

/**
 * Extract permission name from permission object
 * @param {Object} item - Permission item
 * @param {string} type - Permission type
 * @returns {string} Permission name
 */
function extractPermissionName(item, type) {
  // TODO: Implement specific logic for each permission type
  // For now, return first property that looks like a name
  return item.object || item.field || item.apexClass || item.name || item.application || 'unknown';
}

/**
 * Extract permission value from permission object
 * @param {Object} item - Permission item
 * @param {string} type - Permission type
 * @returns {string} Permission value (e.g., 'true', 'Edit', 'Read')
 */
function extractPermissionValue(item, type) {
  // TODO: Implement specific logic for each permission type
  if (item.enabled !== undefined) return item.enabled.toString();
  if (item.allowCreate || item.allowEdit || item.allowRead || item.allowDelete) {
    const perms = [];
    if (item.allowCreate) perms.push('Create');
    if (item.allowRead) perms.push('Read');
    if (item.allowEdit) perms.push('Edit');
    if (item.allowDelete) perms.push('Delete');
    return perms.join(',');
  }
  return 'true';
}
