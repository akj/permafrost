#!/usr/bin/env node

/**
 * sf-perm CLI entry point.
 *
 * @module index
 *
 * Commands:
 *   parse               Retrieve and parse permissions from a Salesforce org
 *   trace               Trace permission sources for a user
 *   export              Export permission database to JSON or CSV
 *   analyze redundancy  Analyze redundant permission grants
 *   analyze overlap     Analyze permission set overlap
 *   analyze object      Analyze object-level access
 *   recommend psg       Recommend Permission Set Group consolidation
 *   report              Generate comprehensive analysis report
 *   validate            Validate permission dependencies
 *   diff                Compare permission configurations across orgs
 *   plan create         Create a new migration plan
 *   plan import         Import operations from diff or recommendation JSON
 *   plan add            Add operation to plan
 *   plan remove         Remove operation from plan
 *   plan show           Show plan details
 *   plan list           List all migration plans
 *   plan export-json    Export plan to portable JSON file
 *   plan import-json    Import plan from JSON file
 *   plan mark-deployed  Mark an operation as deployed or failed
 *   plan skip-operation Mark an operation as skipped
 *   plan status         Update plan status
 *   plan validate       Validate plan for conflicts and issues
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { parseCommand } from './commands/parse.js';
import { traceCommand } from './commands/trace.js';
import { exportCommand } from './commands/export.js';
import { analyzeRedundancyAction, analyzeOverlapAction, analyzeObjectAction } from './commands/analyze.js';
import { recommendPsgAction } from './commands/recommend.js';
import { reportAction } from './commands/report.js';
import { validateAction } from './commands/validate.js';
import { diffAction } from './commands/diff.js';
import { planCreateAction, planImportAction, planAddAction, planRemoveAction, planShowAction, planListAction, planExportJsonAction, planImportJsonAction, planMarkDeployedAction, planSkipOperationAction, planStatusAction, planValidateAction } from './commands/plan.js';
import { resolveDbPath } from './lib/paths.js';

const program = new Command();

program
  .name('sf-perm')
  .description('Permafrost - Salesforce permission analysis and modernization tool')
  .version('0.1.0');

// Parse command - retrieve and parse permissions into database
program
  .command('parse')
  .description('Retrieve and parse permissions from a Salesforce org into local database')
  .option('-o, --org <alias>', 'Salesforce org alias or username')
  .option('-d, --db <path>', 'Database path')
  .option('--force', 'Force re-parse even if database exists')
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
  .option('--include <types>', 'Analysis types: redundancy,overlap,psg,object,dependency,all', 'all')
  .option('--limit <number>', 'Maximum items to display per section', '10')
  .action(reportAction);

// Validate command
program
  .command('validate')
  .description('Validate permission dependencies and architectural completeness')
  .option('-d, --db <path>', 'Database path')
  .option('-O, --org <alias>', 'Salesforce org alias or username')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <type>', 'Output format: table, json', 'table')
  .action(validateAction);

// Diff command
program
  .command('diff')
  .description('Compare permission configurations across orgs')
  .requiredOption('--source-org <org>', 'Source org username or alias')
  .requiredOption('--target-org <org>', 'Target org username or alias')
  .option('--output <file>', 'Write output to file instead of stdout')
  .option('--include <types>', 'Entity types to compare (comma-separated)', 'ps,psg')
  .option('--filter <pattern>', 'Filter entities by glob pattern')
  .action(diffAction);

// Plan command group
const planCmd = program
  .command('plan')
  .description('Manage migration plans');

planCmd
  .command('create')
  .description('Create a new migration plan')
  .requiredOption('--name <name>', 'Plan name')
  .requiredOption('--target-org <org>', 'Target org username or alias')
  .option('--source-org <org>', 'Source org username or alias')
  .option('--description <desc>', 'Plan description')
  .option('--org <org>', 'Org for database resolution')
  .action(planCreateAction);

planCmd
  .command('import <file>')
  .description('Import operations from diff or recommendation JSON')
  .requiredOption('--plan <id>', 'Plan ID to import into')
  .option('--preview', 'Preview operations without persisting')
  .option('--org <org>', 'Org for database resolution')
  .action(planImportAction);

planCmd
  .command('add')
  .description('Add operation to plan')
  .requiredOption('--plan <id>', 'Plan ID')
  .requiredOption('--operation <type>', 'Operation type')
  .requiredOption('--entity <id>', 'Entity ID (format: Type:Name, e.g. PermissionSet:SalesOps)')
  .option('--params <json>', 'Operation parameters as JSON')
  .option('--org <org>', 'Org for database resolution')
  .action(planAddAction);

planCmd
  .command('remove')
  .description('Remove operation from plan')
  .requiredOption('--plan <id>', 'Plan ID')
  .requiredOption('--operation <id>', 'Operation ID to remove')
  .option('--org <org>', 'Org for database resolution')
  .action(planRemoveAction);

planCmd
  .command('show <planId>')
  .description('Show plan details')
  .option('--org <org>', 'Org for database resolution')
  .action(planShowAction);

planCmd
  .command('list')
  .description('List all migration plans')
  .option('--org <org>', 'Org for database resolution')
  .action(planListAction);

planCmd
  .command('export-json <planId>')
  .description('Export plan to portable JSON file')
  .option('--output <file>', 'Output file path (defaults to plan-<id>.json)')
  .option('--org <org>', 'Org for database resolution')
  .action(planExportJsonAction);

planCmd
  .command('import-json <file>')
  .description('Import plan from JSON file (creates independent copy)')
  .option('--org <org>', 'Org for database resolution')
  .action(planImportJsonAction);

planCmd
  .command('mark-deployed')
  .description('Mark an operation as deployed or failed')
  .requiredOption('--plan <id>', 'Plan ID')
  .requiredOption('--operation <id>', 'Operation ID')
  .option('--error <message>', 'Error message (marks as failed instead of deployed)')
  .option('--org <org>', 'Org for database resolution')
  .action(planMarkDeployedAction);

planCmd
  .command('skip-operation')
  .description('Mark an operation as skipped (not needed)')
  .requiredOption('--plan <id>', 'Plan ID')
  .requiredOption('--operation <id>', 'Operation ID')
  .option('--org <org>', 'Org for database resolution')
  .action(planSkipOperationAction);

planCmd
  .command('status')
  .description('Update plan status (draft/ready/executed)')
  .requiredOption('--plan <id>', 'Plan ID')
  .requiredOption('--status <status>', 'New status (draft, ready, executed)')
  .option('--org <org>', 'Org for database resolution')
  .action(planStatusAction);

planCmd
  .command('validate <planId>')
  .description('Validate plan for conflicts and issues')
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('--org <org>', 'Org for database resolution')
  .action(planValidateAction);

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
