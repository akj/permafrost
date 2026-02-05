import chalk from 'chalk';
import ora from 'ora';
import { retrieveMetadata, queryUserAssignments, queryUsers } from '../lib/retriever.js';
import { parseProfiles, parsePermissionSets, parsePermissionSetGroups } from '../lib/parser.js';
import { initDatabase, insertProfiles, insertPermissionSets, insertPermissions, insertUserAssignments } from '../lib/database.js';

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

    if (options.full) {
      // Retrieve metadata from org
      spinner.start('Retrieving metadata from Salesforce org...');
      await retrieveMetadata(options.org, options.metadataDir);
      spinner.succeed('Metadata retrieved');
    }

    // Parse profiles
    spinner.start('Parsing profiles...');
    const profiles = await parseProfiles(options.metadataDir);
    await insertProfiles(options.db, profiles);
    spinner.succeed(`Parsed ${profiles.length} profiles`);

    // Parse permission sets
    spinner.start('Parsing permission sets...');
    const permissionSets = await parsePermissionSets(options.metadataDir);
    await insertPermissionSets(options.db, permissionSets);
    spinner.succeed(`Parsed ${permissionSets.length} permission sets`);

    // Parse permission set groups
    spinner.start('Parsing permission set groups...');
    const permissionSetGroups = await parsePermissionSetGroups(options.metadataDir);
    // TODO: Insert PSGs into database
    spinner.succeed(`Parsed ${permissionSetGroups.length} permission set groups`);

    // Parse permissions from all sources
    spinner.start('Extracting permissions...');
    const permissions = []; // TODO: Extract from parsed metadata
    await insertPermissions(options.db, permissions);
    spinner.succeed(`Extracted ${permissions.length} permissions`);

    // Query and store user assignments
    if (options.org) {
      spinner.start('Querying user assignments...');
      const assignments = await queryUserAssignments(options.org);
      await insertUserAssignments(options.db, assignments);
      spinner.succeed(`Stored ${assignments.length} user assignments`);
    }

    console.log(chalk.green('\n✓ Permission parsing complete!'));
    console.log(chalk.dim(`Database: ${options.db}`));

  } catch (error) {
    spinner.fail('Parse failed');
    throw error;
  }
}
