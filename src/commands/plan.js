import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { createPlan, addOperation, removeOperation, getPlan, listPlans, exportPlanToJson, importPlanFromJson, markOperationDeployed, skipOperation, updatePlanStatus } from '../lib/planner.js';
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

export async function planExportJsonAction(planId, options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Exporting plan...');
    const planJson = await exportPlanToJson(dbPath, planId);

    const output = options.output || `plan-${planId}.json`;
    fs.writeFileSync(output, JSON.stringify(planJson, null, 2));

    spinner.succeed(`Plan exported to ${output}`);
  } catch (error) {
    spinner.fail('Export failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planImportJsonAction(file, options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Reading plan file...');
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

    let planJson;
    try {
      planJson = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    }

    spinner.text = 'Importing plan...';
    const plan = await importPlanFromJson(dbPath, planJson);

    spinner.succeed(`Plan imported: ${plan.id}`);
    console.log(chalk.green(`Plan ID: ${plan.id}`));
    console.log(chalk.gray(`Imported ${plan.operation_count} operations`));
  } catch (error) {
    spinner.fail('Import failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planMarkDeployedAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Marking operation as deployed...');
    const markOptions = options.error ? { error: options.error } : {};
    await markOperationDeployed(dbPath, options.plan, options.operation, markOptions);

    spinner.succeed('Operation marked deployed');
  } catch (error) {
    spinner.fail('Mark deployed failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planSkipOperationAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Skipping operation...');
    await skipOperation(dbPath, options.plan, options.operation);

    spinner.succeed('Operation skipped');
  } catch (error) {
    spinner.fail('Skip operation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planStatusAction(options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start(`Updating plan status to ${options.status}...`);
    await updatePlanStatus(dbPath, options.plan, options.status);

    spinner.succeed(`Plan status updated to ${options.status}`);
  } catch (error) {
    spinner.fail('Status update failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function planValidateAction(planId, options) {
  const spinner = ora();
  try {
    const resolved = await resolveDbPath(options.org);
    const dbPath = resolved?.dbPath || './permissions.db';

    await initMigrationSchema(dbPath);

    spinner.start('Validating plan...');
    const { validatePlan } = await import('../lib/plan-validator.js');
    const result = await validatePlan(dbPath, planId);

    spinner.succeed('Validation complete');

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.errors.length > 0) {
        console.log(chalk.red('\nErrors:'));
        for (const error of result.errors) {
          console.log(chalk.red(`  - ${error.message}`));
        }
      }
      if (result.warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        for (const warning of result.warnings) {
          console.log(chalk.yellow(`  - ${warning.message}`));
        }
      }
      if (result.valid && result.warnings.length === 0) {
        console.log(chalk.green('\nPlan is valid with no warnings'));
      }
    }

    if (!result.valid) {
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Validation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}
