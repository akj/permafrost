import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { recommendAllPSGs } from '../lib/analyzers/psg-recommender.js';

export async function recommendPsgAction(options) {
  const spinner = ora();
  try {
    spinner.start('Generating PSG recommendations...');
    const results = await recommendAllPSGs(options.db, {
      minUsers: parseInt(options.minUsers) || 5,
      coAssignmentThreshold: parseFloat(options.coAssignmentThreshold) || 0.7,
    });
    spinner.succeed('PSG recommendations complete');

    const json = JSON.stringify(results, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, json);
      console.log(chalk.green(`Recommendations saved to: ${options.output}`));
    } else {
      console.log(json);
    }
  } catch (error) {
    spinner.fail('PSG recommendation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}
