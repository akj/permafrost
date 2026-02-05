import chalk from 'chalk';
import { exportDatabase } from '../lib/database.js';
import fs from 'node:fs';

/**
 * Export command handler
 * Exports database to JSON or CSV
 */
export async function exportCommand(options) {
  try {
    console.log(chalk.blue('Exporting permission database...\n'));

    const data = await exportDatabase(options.db, {
      include: options.include.split(','),
      format: options.format
    });

    const outputPath = options.output || `permissions-export.${options.format}`;

    if (options.format === 'json') {
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    } else {
      // CSV export - TODO: implement CSV conversion
      console.log(chalk.yellow('CSV export not yet implemented'));
      return;
    }

    console.log(chalk.green(`✓ Export complete: ${outputPath}`));
    console.log(chalk.dim(`Exported ${Object.keys(data).length} entity types`));

  } catch (error) {
    console.error(chalk.red('Export failed:'), error.message);
    throw error;
  }
}
