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
      if (type === 'ObjectPermission') {
        const objectName = item.object;
        if (!objectName) continue;

        const crudOps = [
          { field: 'allowCreate', name: 'Create' },
          { field: 'allowRead', name: 'Read' },
          { field: 'allowEdit', name: 'Edit' },
          { field: 'allowDelete', name: 'Delete' },
          { field: 'modifyAllRecords', name: 'ModifyAll' },
          { field: 'viewAllRecords', name: 'ViewAll' }
        ];

        for (const { field, name } of crudOps) {
          if (item[field] === true || item[field] === 'true') {
            permissions.push({
              type,
              name: `${objectName}.${name}`,
              value: 'true',
              raw: item
            });
          }
        }
      } else {
        const permName = extractPermissionName(item, type);
        const permValue = extractPermissionValue(item, type);

        if (permName === 'unknown' || permValue === null) {
          console.warn(`Malformed ${type} permission - skipping:`, JSON.stringify(item));
          continue;
        }

        permissions.push({
          type,
          name: permName,
          value: permValue,
          raw: item
        });
      }
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
  switch (type) {
    case 'ObjectPermission':
      return item.object || 'unknown';
    case 'FieldPermission':
      return item.field || 'unknown';
    case 'UserPermission':
      return item.name || 'unknown';
    case 'ApexClassAccess':
      return item.apexClass ? `ApexClass:${item.apexClass}` : 'unknown';
    case 'PageAccess':
      return item.apexPage ? `ApexPage:${item.apexPage}` : 'unknown';
    case 'CustomPermission':
      return item.name || 'unknown';
    case 'ApplicationVisibility':
      return item.application || 'unknown';
    case 'TabSetting':
      return item.tab || 'unknown';
    case 'RecordTypeVisibility':
      return item.recordType || 'unknown';
    case 'CustomMetadataTypeAccess':
      return item.name || 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * Extract permission value from permission object
 * @param {Object} item - Permission item
 * @param {string} type - Permission type
 * @returns {string} Permission value (e.g., 'true', 'Edit', 'Read')
 */
function extractPermissionValue(item, type) {
  switch (type) {
    case 'ObjectPermission':
      // CRUD operations expanded into separate rows by caller
      return null;
    case 'FieldPermission':
      if (item.editable === true || item.editable === 'true') return 'Edit';
      if (item.readable === true || item.readable === 'true') return 'Read';
      return null;
    case 'UserPermission':
      return item.enabled !== undefined ? item.enabled.toString() : null;
    case 'ApexClassAccess':
      return item.enabled !== undefined ? item.enabled.toString() : null;
    case 'PageAccess':
      return item.enabled !== undefined ? item.enabled.toString() : null;
    case 'CustomPermission':
      return item.enabled !== undefined ? item.enabled.toString() : null;
    case 'ApplicationVisibility':
      if (item.visible === true || item.visible === 'true') return 'visible';
      if (item.visible === false || item.visible === 'false') return 'hidden';
      return item.visibility || null;
    case 'TabSetting':
      return item.visibility || null;
    case 'RecordTypeVisibility': {
      const flags = [];
      if (item.visible === true || item.visible === 'true') flags.push('visible');
      if (item.default === true || item.default === 'true') flags.push('default');
      return flags.length > 0 ? flags.join(',') : null;
    }
    case 'CustomMetadataTypeAccess':
      return item.enabled !== undefined ? item.enabled.toString() : null;
    default:
      return null;
  }
}
