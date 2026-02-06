import chalk from 'chalk';
import ora from 'ora';
import { fetchMetadata, queryUserAssignments, queryUsers } from '../lib/retriever.js';
import { parseProfiles, parsePermissionSets, parsePermissionSetGroups } from '../lib/parser.js';
import { initDatabase, insertProfiles, insertPermissionSets, insertPermissions, insertUserAssignments, insertPermissionSetGroups, insertPSGMembers } from '../lib/database.js';

/**
 * Parse command handler
 * Retrieves and parses Salesforce permissions into local database
 */
export async function parseCommand(options) {
  const spinner = ora('Initializing permission parser...').start();
  
  try {
    // Initialize database
    spinner.text = 'Initializing database...';
    await initDatabase(options.db);
    spinner.succeed('Database initialized');

    let profiles, permissionSets, permissionSetGroups;

    if (options.full && options.org) {
      // Live org: fetch directly via Metadata API
      spinner.start('Fetching metadata from Salesforce org...');
      const metadata = await fetchMetadata(options.org);
      profiles = metadata.profiles;
      permissionSets = metadata.permissionSets;
      permissionSetGroups = metadata.permissionSetGroups;
      spinner.succeed(`Fetched ${profiles.length} profiles, ${permissionSets.length} permission sets, ${permissionSetGroups.length} PSGs`);
    } else {
      // Offline: parse XML files from disk
      spinner.start('Parsing profiles...');
      profiles = await parseProfiles(options.metadataDir);
      spinner.succeed(`Parsed ${profiles.length} profiles`);

      spinner.start('Parsing permission sets...');
      permissionSets = await parsePermissionSets(options.metadataDir);
      spinner.succeed(`Parsed ${permissionSets.length} permission sets`);

      spinner.start('Parsing permission set groups...');
      permissionSetGroups = await parsePermissionSetGroups(options.metadataDir);
      spinner.succeed(`Parsed ${permissionSetGroups.length} permission set groups`);
    }

    // Store metadata in database
    spinner.start('Storing metadata...');
    await insertProfiles(options.db, profiles);
    await insertPermissionSets(options.db, permissionSets);
    await insertPermissionSetGroups(options.db, permissionSetGroups);

    // Build and insert PSG member mappings
    const psgMembers = [];
    for (const psg of permissionSetGroups) {
      for (const psName of psg.members) {
        psgMembers.push({ psgId: psg.fullName, psId: psName });
      }
    }
    await insertPSGMembers(options.db, psgMembers);
    spinner.succeed(`Stored ${permissionSetGroups.length} PSGs (${psgMembers.length} members)`);

    // Extract permissions from all sources
    spinner.start('Extracting permissions...');
    const permissions = [];

    for (const profile of profiles) {
      for (const perm of profile.permissions) {
        permissions.push({
          sourceType: 'Profile',
          sourceId: profile.fullName,
          permissionType: perm.type,
          permissionName: perm.name,
          permissionValue: perm.value
        });
      }
    }

    for (const ps of permissionSets) {
      for (const perm of ps.permissions) {
        permissions.push({
          sourceType: 'PermissionSet',
          sourceId: ps.fullName,
          permissionType: perm.type,
          permissionName: perm.name,
          permissionValue: perm.value
        });
      }
    }

    await insertPermissions(options.db, permissions);
    spinner.succeed(`Extracted ${permissions.length} permissions`);

    // Query and store user assignments
    if (options.org) {
      spinner.start('Querying user assignments...');
      const assignments = await queryUserAssignments(options.org);
      const users = await queryUsers(options.org);
      const allAssignments = [...assignments, ...users];
      await insertUserAssignments(options.db, allAssignments);
      spinner.succeed(`Stored ${assignments.length} PS/PSG assignments + ${users.length} profile assignments`);
    }

    console.log(chalk.green('\n✓ Permission parsing complete!'));
    console.log(chalk.dim(`Database: ${options.db}`));

  } catch (error) {
    spinner.fail('Parse failed');
    throw error;
  }
}
