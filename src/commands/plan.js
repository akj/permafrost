import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { createPlan, addOperation, removeOperation, getPlan, listPlans } from '../lib/planner.js';
import { transformDiffToOperations, transformRecommendationsToOperations, transformRedundancyToOperations } from '../lib/import-transformer.js';
import { resolveDbPath } from '../lib/paths.js';
import { initMigrationSchema } from '../lib/migration-db.js';

export async function planCreateAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Creating migration plan...');
    const planId = await createPlan(dbPath, {
      name: options.name,
      targetOrg: options.targetOrg,
      sourceOrg: options.sourceOrg,
      description: options.description,
    });

    spinner.succeed(`Plan created: ${planId}`);
    console.log(chalk.green(`Plan ID: ${planId}`));
  } catch (error) {
    spinner.fail('Plan creation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planImportAction(file, options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    let fileContent;
    try {
      fileContent = fs.readFileSync(file, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${file}`);
      } else if (error.code === 'EACCES') {
        throw new Error(`Permission denied: ${file}`);
      }
      throw error;
    }

    let data;
    try {
      data = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    }

    spinner.start('Detecting import format...');
    let operations;
    if (data.source_org && data.changes) {
      spinner.text = 'Transforming diff to operations...';
      operations = transformDiffToOperations(data);
    } else if (data.hierarchical || data.coAssignment) {
      spinner.text = 'Transforming recommendations to operations...';
      operations = transformRecommendationsToOperations(data);
    } else if (data.profile_ps_redundancy) {
      spinner.text = 'Transforming redundancy to operations...';
      operations = transformRedundancyToOperations(data);
    } else {
      throw new Error('Unrecognized import format');
    }

    if (options.preview) {
      spinner.succeed(`Preview: ${operations.length} operations`);
      console.log(JSON.stringify(operations, null, 2));
      return;
    }

    spinner.text = `Importing ${operations.length} operations...`;
    for (const op of operations) {
      await addOperation(dbPath, options.plan, op);
    }

    spinner.succeed(`Imported ${operations.length} operations to plan ${options.plan}`);
  } catch (error) {
    spinner.fail('Import failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planAddAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Adding operation...');
    const params = options.params ? JSON.parse(options.params) : {};
    await addOperation(dbPath, options.plan, {
      operation: options.operation,
      entity: options.entity,
      params,
    });

    spinner.succeed('Operation added');
  } catch (error) {
    spinner.fail('Add operation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planRemoveAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Removing operation...');
    await removeOperation(dbPath, options.plan, options.operation);

    spinner.succeed('Operation removed');
  } catch (error) {
    spinner.fail('Remove operation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planShowAction(planId, options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Fetching plan...');
    const plan = await getPlan(dbPath, planId);

    spinner.succeed('Plan retrieved');
    console.log(JSON.stringify(plan, null, 2));
  } catch (error) {
    spinner.fail('Show plan failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planListAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Fetching plans...');
    const plans = await listPlans(dbPath);

    spinner.succeed(`Found ${plans.length} plans`);
    console.log(JSON.stringify(plans, null, 2));
  } catch (error) {
    spinner.fail('List plans failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}
