#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { parseCommand } from './commands/parse.js';
import { traceCommand } from './commands/trace.js';
import { exportCommand } from './commands/export.js';
import { analyzeRedundancyAction, analyzeOverlapAction, analyzeObjectAction } from './commands/analyze.js';
import { recommendPsgAction } from './commands/recommend.js';
import { reportAction } from './commands/report.js';
import { resolveDbPath } from './lib/paths.js';

const program = new Command();

program
  .name('sf-perm')
  .description('Permafrost - Salesforce permission analysis and modernization tool')
  .version('0.1.0');

// Parse command - retrieve and parse permissions into database
program
  .command('parse')
  .description('Parse permissions from a Salesforce org into local database')
  .option('-o, --org <alias>', 'Salesforce org alias or username')
  .option('-d, --db <path>', 'Database path')
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
  .option('-d, --db <path>', 'Database path')
  .option('-o, --org <alias>', 'Salesforce org (for live queries if DB not available)')
  .option('--format <type>', 'Output format: table, json', 'table')
  .option('--verbose', 'Show full permission chain (PSG → PS → Permission)')
  .action(traceCommand);

// Export command - export database to JSON/CSV
program
  .command('export')
  .description('Export permission database to JSON or CSV')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('-o, --output <path>', 'Output file path')
  .option('--format <type>', 'Output format: json, csv', 'json')
  .option('--include <entities>', 'Comma-separated list: profiles,permissionsets,users,permissions,all', 'all')
  .action(exportCommand);

// Analyze command with subcommands
const analyzeCmd = program
  .command('analyze')
  .description('Analyze permissions for redundancy, overlap, and object access');

analyzeCmd
  .command('redundancy')
  .description('Analyze redundant permission grants')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('-o, --output <path>', 'Output file path (JSON)')
  .action(analyzeRedundancyAction);

analyzeCmd
  .command('overlap')
  .description('Analyze permission set overlap')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('--threshold <value>', 'Minimum Jaccard similarity threshold', '0.5')
  .option('-o, --output <path>', 'Output file path (JSON)')
  .action(analyzeOverlapAction);

analyzeCmd
  .command('object')
  .description('Analyze object-level access')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('--object <name>', 'Object name (e.g., Account)')
  .option('--list', 'List all objects')
  .option('-o, --output <path>', 'Output file path (JSON)')
  .action(analyzeObjectAction);

// Recommend command (top-level per DL-013)
const recommendCmd = program
  .command('recommend')
  .description('Generate recommendations');

recommendCmd
  .command('psg')
  .description('Recommend Permission Set Group consolidation')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('--min-users <count>', 'Minimum user count for co-assignment', '5')
  .option('--co-assignment-threshold <value>', 'Co-assignment threshold', '0.7')
  .option('-o, --output <path>', 'Output file path (JSON)')
  .action(recommendPsgAction);

// Report command
program
  .command('report')
  .description('Generate comprehensive analysis report')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <type>', 'Report format: html, json, markdown', 'html')
  .option('--include <types>', 'Analysis types: redundancy,overlap,psg,object,all', 'all')
  .action(reportAction);

// Pre-action hook: resolve --db and --org defaults from project config
program.hook('preAction', async (thisCommand, actionCommand) => {
  const opts = actionCommand.opts();
  if (opts.db) return; // user provided --db explicitly

  const resolved = await resolveDbPath(opts.org);
  if (resolved) {
    actionCommand.setOptionValue('db', resolved.dbPath);
    if (!opts.org) actionCommand.setOptionValue('org', resolved.username);
  } else {
    actionCommand.setOptionValue('db', './permissions.db');
  }
});

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
