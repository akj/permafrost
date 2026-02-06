import chalk from 'chalk';
import { traceUserPermission } from '../lib/tracer.js';

/**
 * Trace command handler
 * Finds all sources of a permission for a given user
 */
export async function traceCommand(options) {
  try {
    console.log(chalk.blue('Tracing permission sources...\n'));

    const result = await traceUserPermission(
      options.db,
      options.user,
      options.permission,
      { verbose: options.verbose },
    );

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Table format output
    console.log(chalk.bold(`User: ${result.user}`));
    console.log(chalk.bold(`Permission: ${result.permission}\n`));

    if (result.sources.length === 0) {
      console.log(chalk.yellow('⚠ Permission not found for this user'));
      return;
    }

    console.log(chalk.green(`✓ Permission granted by ${result.sources.length} source(s):\n`));

    result.sources.forEach((source, idx) => {
      console.log(chalk.bold(`${idx + 1}. ${source.type}: ${source.name}`));

      if (options.verbose && source.chain) {
        source.chain.forEach((step) => {
          console.log(chalk.dim(`   → ${step}`));
        });
      }

      console.log(chalk.dim(`   Value: ${source.value}`));
      console.log();
    });

  } catch (error) {
    console.error(chalk.red('Trace failed:'), error.message);
    throw error;
  }
}
