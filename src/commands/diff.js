import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { compareOrgs } from '../lib/comparators/org-diff.js';
import { resolveDbPath } from '../lib/paths.js';

export async function diffAction(options) {
  const spinner = ora();
  try {
    if (options.sourceOrg === options.targetOrg) {
      throw new Error('Cannot diff an org against itself — source and target must be different orgs');
    }

    spinner.start('Resolving org paths...');
    const sourceResolved = await resolveDbPath(options.sourceOrg);
    const targetResolved = await resolveDbPath(options.targetOrg);

    if (!sourceResolved) {
      throw new Error(`No database found for org ${options.sourceOrg}. Run sf-perm parse --org ${options.sourceOrg} first.`);
    }
    if (!targetResolved) {
      throw new Error(`No database found for org ${options.targetOrg}. Run sf-perm parse --org ${options.targetOrg} first.`);
    }

    if (!fs.existsSync(sourceResolved.dbPath)) {
      throw new Error(`No database found for org ${options.sourceOrg}. Run sf-perm parse --org ${options.sourceOrg} first.`);
    }
    if (!fs.existsSync(targetResolved.dbPath)) {
      throw new Error(`No database found for org ${options.targetOrg}. Run sf-perm parse --org ${options.targetOrg} first.`);
    }

    spinner.text = 'Comparing orgs...';
    const results = await compareOrgs(sourceResolved.dbPath, targetResolved.dbPath, {
      include: options.include.split(','),
      filter: options.filter,
    });

    spinner.succeed('Diff complete');

    const json = JSON.stringify(results, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, json);
      console.log(chalk.green(`Diff saved to: ${options.output}`));
    } else {
      console.log(json);
    }
  } catch (error) {
    spinner.fail('Diff failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}
