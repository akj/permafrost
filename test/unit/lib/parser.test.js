import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProfileFile,
  parsePermissionSetFile,
  parsePermissionSetGroupFile,
  parseProfiles,
  parsePermissionSets,
  parsePermissionSetGroups,
  extractPermissions,
  normalizeProfile,
  normalizePermissionSet,
  normalizePermissionSetGroup,
} from '../../../src/lib/parser.js';
import { fixturePath } from '../../helpers/fixture-path.js';

describe('parseProfileFile', () => {
  it('parses Admin fixture correctly', async () => {
    const profile = await parseProfileFile(fixturePath('profiles', 'Admin.profile-meta.xml'));

    assert.equal(profile.fullName, 'Admin');
    assert.equal(profile.custom, false);
    assert.equal(profile.userLicense, 'Salesforce');
    assert.ok(Array.isArray(profile.permissions));
    assert.ok(profile.permissions.length > 0);
  });

  it('expands ObjectPermission to 6 rows', async () => {
    const profile = await parseProfileFile(fixturePath('profiles', 'Admin.profile-meta.xml'));
    const objPerms = profile.permissions.filter(p => p.type === 'ObjectPermission');

    assert.equal(objPerms.length, 6);
    const permNames = objPerms.map(p => p.name);
    assert.ok(permNames.includes('Account.Create'));
    assert.ok(permNames.includes('Account.Read'));
    assert.ok(permNames.includes('Account.Edit'));
    assert.ok(permNames.includes('Account.Delete'));
    assert.ok(permNames.includes('Account.ModifyAll'));
    assert.ok(permNames.includes('Account.ViewAll'));
    assert.ok(objPerms.every(p => p.value === 'true'));
  });

  it('maps FieldPermission editable to Edit', async () => {
    const profile = await parseProfileFile(fixturePath('profiles', 'Admin.profile-meta.xml'));
    const fieldPerms = profile.permissions.filter(p => p.type === 'FieldPermission');

    assert.equal(fieldPerms.length, 1);
    assert.equal(fieldPerms[0].name, 'Account.Industry');
    assert.equal(fieldPerms[0].value, 'Edit');
  });

  it('includes UserPermission', async () => {
    const profile = await parseProfileFile(fixturePath('profiles', 'Admin.profile-meta.xml'));
    const userPerms = profile.permissions.filter(p => p.type === 'UserPermission');

    assert.equal(userPerms.length, 1);
    assert.equal(userPerms[0].name, 'ManageUsers');
    assert.equal(userPerms[0].value, 'true');
  });

  it('includes ApplicationVisibility', async () => {
    const profile = await parseProfileFile(fixturePath('profiles', 'Admin.profile-meta.xml'));
    const appPerms = profile.permissions.filter(p => p.type === 'ApplicationVisibility');

    assert.equal(appPerms.length, 1);
    assert.equal(appPerms[0].name, 'standard__LightningSales');
    assert.equal(appPerms[0].value, 'visible');
  });

  it('includes TabSetting', async () => {
    const profile = await parseProfileFile(fixturePath('profiles', 'Admin.profile-meta.xml'));
    const tabPerms = profile.permissions.filter(p => p.type === 'TabSetting');

    assert.equal(tabPerms.length, 1);
    assert.equal(tabPerms[0].name, 'standard-Account');
    assert.equal(tabPerms[0].value, 'DefaultOn');
  });
});

describe('parsePermissionSetFile', () => {
  it('parses SalesOps fixture correctly', async () => {
    const permSet = await parsePermissionSetFile(fixturePath('permissionsets', 'SalesOps.permissionset-meta.xml'));

    assert.equal(permSet.fullName, 'SalesOps');
    assert.equal(permSet.label, 'Sales Operations');
    assert.ok(Array.isArray(permSet.permissions));
    assert.ok(permSet.permissions.length > 0);
  });

  it('includes ObjectPermissions', async () => {
    const permSet = await parsePermissionSetFile(fixturePath('permissionsets', 'SalesOps.permissionset-meta.xml'));
    const objPerms = permSet.permissions.filter(p => p.type === 'ObjectPermission');

    assert.equal(objPerms.length, 3);
    const permNames = objPerms.map(p => p.name);
    assert.ok(permNames.includes('Account.Delete'));
    assert.ok(permNames.includes('Account.Edit'));
    assert.ok(permNames.includes('Account.Read'));
  });

  it('includes CustomPermission', async () => {
    const permSet = await parsePermissionSetFile(fixturePath('permissionsets', 'SalesOps.permissionset-meta.xml'));
    const customPerms = permSet.permissions.filter(p => p.type === 'CustomPermission');

    assert.equal(customPerms.length, 1);
    assert.equal(customPerms[0].name, 'ViewDashboard');
    assert.equal(customPerms[0].value, 'true');
  });

  it('handles FieldPermission editable=true, readable=false', async () => {
    const permSet = await parsePermissionSetFile(fixturePath('permissionsets', 'SalesOps.permissionset-meta.xml'));
    const fieldPerms = permSet.permissions.filter(p => p.type === 'FieldPermission');

    assert.equal(fieldPerms.length, 1);
    assert.equal(fieldPerms[0].name, 'Account.Industry');
    assert.equal(fieldPerms[0].value, 'Edit');
  });
});

describe('parsePermissionSetGroupFile', () => {
  it('parses SalesBundle with members', async () => {
    const psg = await parsePermissionSetGroupFile(fixturePath('permissionsetgroups', 'SalesBundle.permissionsetgroup-meta.xml'));

    assert.equal(psg.fullName, 'SalesBundle');
    assert.equal(psg.label, 'Sales Bundle');
    assert.equal(psg.status, 'Updated');
    assert.ok(Array.isArray(psg.members));
    assert.equal(psg.members.length, 1);
    assert.equal(psg.members[0], 'SalesOps');
  });

  it('parses EmptyGroup with empty members array', async () => {
    const psg = await parsePermissionSetGroupFile(fixturePath('permissionsetgroups', 'EmptyGroup.permissionsetgroup-meta.xml'));

    assert.equal(psg.fullName, 'EmptyGroup');
    assert.equal(psg.label, 'Empty Group');
    assert.ok(Array.isArray(psg.members));
    assert.equal(psg.members.length, 0);
  });
});

describe('parseProfiles', () => {
  it('returns array of parsed profiles', async () => {
    const profiles = await parseProfiles(fixturePath());

    assert.ok(Array.isArray(profiles));
    assert.equal(profiles.length, 2);
    const names = profiles.map(p => p.fullName);
    assert.ok(names.includes('Admin'));
    assert.ok(names.includes('Standard'));
  });

  it('returns empty array for missing directory', async () => {
    const profiles = await parseProfiles(fixturePath('nonexistent'));

    assert.ok(Array.isArray(profiles));
    assert.equal(profiles.length, 0);
  });
});

describe('parsePermissionSets', () => {
  it('returns array of parsed permission sets', async () => {
    const permSets = await parsePermissionSets(fixturePath());

    assert.ok(Array.isArray(permSets));
    assert.equal(permSets.length, 2);
    const names = permSets.map(ps => ps.fullName);
    assert.ok(names.includes('SalesOps'));
    assert.ok(names.includes('MarketingUser'));
  });

  it('returns empty array for missing directory', async () => {
    const permSets = await parsePermissionSets(fixturePath('nonexistent'));

    assert.ok(Array.isArray(permSets));
    assert.equal(permSets.length, 0);
  });
});

describe('parsePermissionSetGroups', () => {
  it('returns array of parsed permission set groups', async () => {
    const groups = await parsePermissionSetGroups(fixturePath());

    assert.ok(Array.isArray(groups));
    assert.equal(groups.length, 2);
    const names = groups.map(g => g.fullName);
    assert.ok(names.includes('SalesBundle'));
    assert.ok(names.includes('EmptyGroup'));
  });

  it('returns empty array for missing directory', async () => {
    const groups = await parsePermissionSetGroups(fixturePath('nonexistent'));

    assert.ok(Array.isArray(groups));
    assert.equal(groups.length, 0);
  });
});

describe('extractPermissions', () => {
  it('expands ObjectPermission CRUD to 6 rows', () => {
    const obj = {
      objectPermissions: {
        object: 'Account',
        allowCreate: true,
        allowRead: true,
        allowEdit: true,
        allowDelete: true,
        modifyAllRecords: true,
        viewAllRecords: true,
      },
    };

    const perms = extractPermissions(obj);
    assert.equal(perms.length, 6);
    const names = perms.map(p => p.name);
    assert.ok(names.includes('Account.Create'));
    assert.ok(names.includes('Account.Read'));
    assert.ok(names.includes('Account.Edit'));
    assert.ok(names.includes('Account.Delete'));
    assert.ok(names.includes('Account.ModifyAll'));
    assert.ok(names.includes('Account.ViewAll'));
  });

  it('maps FieldPermission editable to Edit', () => {
    const obj = {
      fieldPermissions: {
        field: 'Account.Industry',
        editable: true,
        readable: true,
      },
    };

    const perms = extractPermissions(obj);
    assert.equal(perms.length, 1);
    assert.equal(perms[0].type, 'FieldPermission');
    assert.equal(perms[0].name, 'Account.Industry');
    assert.equal(perms[0].value, 'Edit');
  });

  it('maps FieldPermission readable to Read', () => {
    const obj = {
      fieldPermissions: {
        field: 'Account.Industry',
        editable: false,
        readable: true,
      },
    };

    const perms = extractPermissions(obj);
    assert.equal(perms.length, 1);
    assert.equal(perms[0].value, 'Read');
  });

  it('normalizes single-item objects to arrays', () => {
    const obj = {
      userPermissions: {
        name: 'ManageUsers',
        enabled: true,
      },
    };

    const perms = extractPermissions(obj);
    assert.equal(perms.length, 1);
    assert.equal(perms[0].type, 'UserPermission');
    assert.equal(perms[0].name, 'ManageUsers');
  });

  it('handles array of permissions', () => {
    const obj = {
      userPermissions: [
        { name: 'ManageUsers', enabled: true },
        { name: 'ViewSetup', enabled: true },
      ],
    };

    const perms = extractPermissions(obj);
    assert.equal(perms.length, 2);
  });
});

describe('normalizeProfile', () => {
  it('produces same shape as file-parsed object', () => {
    const metadataObj = {
      fullName: 'TestProfile',
      userLicense: 'Salesforce',
      custom: 'true',
      objectPermissions: {
        object: 'Account',
        allowRead: true,
      },
    };

    const normalized = normalizeProfile(metadataObj);

    assert.equal(normalized.fullName, 'TestProfile');
    assert.equal(normalized.userLicense, 'Salesforce');
    assert.equal(normalized.custom, true);
    assert.ok(Array.isArray(normalized.permissions));
  });

  it('handles boolean custom field', () => {
    const metadataObj = {
      fullName: 'TestProfile',
      userLicense: 'Salesforce',
      custom: true,
    };

    const normalized = normalizeProfile(metadataObj);
    assert.equal(normalized.custom, true);
  });
});

describe('normalizePermissionSet', () => {
  it('produces same shape as file-parsed object', () => {
    const metadataObj = {
      fullName: 'TestPS',
      label: 'Test Permission Set',
      hasActivationRequired: 'true',
      license: 'Salesforce',
      objectPermissions: {
        object: 'Account',
        allowRead: true,
      },
    };

    const normalized = normalizePermissionSet(metadataObj);

    assert.equal(normalized.fullName, 'TestPS');
    assert.equal(normalized.label, 'Test Permission Set');
    assert.equal(normalized.hasActivationRequired, true);
    assert.equal(normalized.license, 'Salesforce');
    assert.ok(Array.isArray(normalized.permissions));
  });

  it('handles boolean hasActivationRequired field', () => {
    const metadataObj = {
      fullName: 'TestPS',
      label: 'Test',
      hasActivationRequired: false,
    };

    const normalized = normalizePermissionSet(metadataObj);
    assert.equal(normalized.hasActivationRequired, false);
  });
});

describe('normalizePermissionSetGroup', () => {
  it('produces same shape as file-parsed object', () => {
    const metadataObj = {
      fullName: 'TestPSG',
      label: 'Test Group',
      status: 'Updated',
      permissionSets: ['PS1', 'PS2'],
    };

    const normalized = normalizePermissionSetGroup(metadataObj);

    assert.equal(normalized.fullName, 'TestPSG');
    assert.equal(normalized.label, 'Test Group');
    assert.equal(normalized.status, 'Updated');
    assert.ok(Array.isArray(normalized.members));
    assert.equal(normalized.members.length, 2);
  });

  it('normalizes single member to array', () => {
    const metadataObj = {
      fullName: 'TestPSG',
      label: 'Test',
      status: 'Updated',
      permissionSets: 'SinglePS',
    };

    const normalized = normalizePermissionSetGroup(metadataObj);
    assert.ok(Array.isArray(normalized.members));
    assert.equal(normalized.members.length, 1);
    assert.equal(normalized.members[0], 'SinglePS');
  });

  it('returns empty array for missing members', () => {
    const metadataObj = {
      fullName: 'TestPSG',
      label: 'Test',
      status: 'Updated',
    };

    const normalized = normalizePermissionSetGroup(metadataObj);
    assert.ok(Array.isArray(normalized.members));
    assert.equal(normalized.members.length, 0);
  });
});
