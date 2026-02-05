#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { parseCommand } from './commands/parse.js';
import { traceCommand } from './commands/trace.js';
import { exportCommand } from './commands/export.js';

const program = new Command();

program
  .name('sf-perm')
  .description('Salesforce Permission Analyzer - Understand and modernize your permission model')
  .version('0.1.0');

// Parse command - retrieve and parse permissions into database
program
  .command('parse')
  .description('Parse permissions from a Salesforce org into local database')
  .option('-o, --org <alias>', 'Salesforce org alias or username')
  .option('-d, --db <path>', 'Database path', './permissions.db')
  .option('-m, --metadata-dir <path>', 'Metadata output directory', './metadata')
  .option('--full', 'Retrieve metadata from org (default: parse only)')
  .option('--force', 'Force re-parse even if metadata exists')
  .action(parseCommand);

// Trace command - find permission sources for a user
program
  .command('trace')
  .description('Trace permission sources for a user')
  .requiredOption('-u, --user <email>', 'User email, username, or Salesforce ID')
  .requiredOption('-p, --permission <name>', 'Permission name (e.g., Account.Edit, ManageUsers)')
  .option('-d, --db <path>', 'Database path', './permissions.db')
  .option('-o, --org <alias>', 'Salesforce org (for live queries if DB not available)')
  .option('--format <type>', 'Output format: table, json', 'table')
  .option('--verbose', 'Show full permission chain (PSG → PS → Permission)')
  .action(traceCommand);

// Export command - export database to JSON/CSV
program
  .command('export')
  .description('Export permission database to JSON or CSV')
  .option('-d, --db <path>', 'Database path', './permissions.db')
  .option('-o, --output <path>', 'Output file path')
  .option('--format <type>', 'Output format: json, csv', 'json')
  .option('--include <entities>', 'Comma-separated list: profiles,permissionsets,users,permissions,all', 'all')
  .action(exportCommand);

// Global error handler
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error.code !== 'commander.help' && error.code !== 'commander.version') {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}
