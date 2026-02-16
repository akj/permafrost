import fs from 'node:fs';
import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { fetchMetadata, queryUserAssignments, queryUsers, resolveOrg } from '../lib/retriever.js';
import { initDatabase, insertProfiles, insertPermissionSets, insertPermissions, insertUserAssignments, insertPermissionSetGroups, insertPSGMembers, seedUniversalDependencies } from '../lib/database.js';

/**
 * Parse command handler
 * Retrieves and parses Salesforce permissions into local database
 */
export async function parseCommand(options) {
  if (!options.org) {
    console.error(chalk.red('Error:'), 'No org specified. Use --org <alias> or set a target-org in your SFDX project.');
    process.exit(1);
  }

  // Confirm overwrite if db already exists (unless --force)
  if (!options.force && fs.existsSync(options.db)) {
    const answer = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`Database already exists: ${options.db}\nOverwrite? [y/N] `, (ans) => {
        rl.close();
        resolve(ans);
      });
    });
    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.yellow('Aborted.'));
      return;
    }
  }

  const spinner = ora('Initializing permission parser...').start();

  try {
    // Initialize database
    spinner.text = 'Initializing database...';
    await initDatabase(options.db);
    spinner.succeed('Database initialized');

    // Resolve org alias to username
    const orgUsername = await resolveOrg(options.org);

    // Fetch metadata from org via SDR
    spinner.start('Fetching metadata from Salesforce org...');
    const metadata = await fetchMetadata(orgUsername);
    const { profiles, permissionSets, permissionSetGroups } = metadata;
    spinner.succeed(`Fetched ${profiles.length} profiles, ${permissionSets.length} permission sets, ${permissionSetGroups.length} PSGs`);

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
          permissionValue: perm.value,
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
          permissionValue: perm.value,
        });
      }
    }

    await insertPermissions(options.db, permissions);
    spinner.succeed(`Extracted ${permissions.length} permissions`);

    spinner.start('Seeding universal dependencies...');
    const objectCount = await seedUniversalDependencies(options.db);
    spinner.succeed(`Seeded ${objectCount * 8} CRUD dependencies for ${objectCount} objects`);

    // Query and store user assignments
    spinner.start('Querying user assignments...');
    const assignments = await queryUserAssignments(orgUsername);
    const users = await queryUsers(orgUsername);
    const allAssignments = [...assignments, ...users];
    await insertUserAssignments(options.db, allAssignments);
    spinner.succeed(`Stored ${assignments.length} PS/PSG assignments + ${users.length} profile assignments`);

    console.log(chalk.green('\n✓ Permission parsing complete!'));
    console.log(chalk.dim(`Database: ${options.db}`));

  } catch (error) {
    spinner.fail('Parse failed');
    throw error;
  }
}
