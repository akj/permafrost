import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { analyzeAllRedundancy } from '../lib/analyzers/redundancy.js';
import { analyzePermissionSetOverlap } from '../lib/analyzers/overlap.js';
import { analyzeObjectAccess, listAllObjects } from '../lib/analyzers/object-view.js';

export async function analyzeRedundancyAction(options) {
  const spinner = ora();
  try {
    spinner.start('Analyzing redundancy...');
    const results = await analyzeAllRedundancy(options.db);
    spinner.succeed('Redundancy analysis complete');
    outputResults(results, options.output);
  } catch (error) {
    spinner.fail('Redundancy analysis failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function analyzeOverlapAction(options) {
  const spinner = ora();
  try {
    spinner.start('Analyzing permission set overlap...');
    const results = await analyzePermissionSetOverlap(options.db, {
      threshold: parseFloat(options.threshold) || 0.5,
    });
    spinner.succeed('Overlap analysis complete');
    outputResults(results, options.output);
  } catch (error) {
    spinner.fail('Overlap analysis failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

export async function analyzeObjectAction(options) {
  const spinner = ora();
  try {
    if (options.list || !options.object) {
      spinner.start('Listing objects...');
      const objects = await listAllObjects(options.db);
      spinner.succeed(`Found ${objects.length} objects`);
      objects.forEach(obj => console.log(`  ${obj}`));
      return;
    }
    spinner.start(`Analyzing object: ${options.object}...`);
    const results = await analyzeObjectAccess(options.db, options.object);
    spinner.succeed(`Object analysis complete: ${options.object}`);
    outputResults(results, options.output);
  } catch (error) {
    spinner.fail('Object analysis failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}

function outputResults(results, outputPath) {
  const json = JSON.stringify(results, null, 2);
  if (outputPath) {
    fs.writeFileSync(outputPath, json);
    console.log(chalk.green(`Results saved to: ${outputPath}`));
  } else {
    console.log(json);
  }
}
