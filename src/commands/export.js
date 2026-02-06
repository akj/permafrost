import chalk from 'chalk';
import { exportDatabase } from '../lib/database.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Escape a value for RFC 4180 CSV format
 * @param {*} value - Value to escape
 * @returns {string} Escaped CSV value
 */
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert array of objects to CSV string
 * @param {Array} rows - Array of row objects
 * @returns {string} CSV string
 */
function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Export command handler
 * Exports database to JSON or CSV
 */
export async function exportCommand(options) {
  try {
    console.log(chalk.blue('Exporting permission database...\n'));

    const data = await exportDatabase(options.db, {
      include: options.include.split(','),
      format: options.format,
    });

    const outputPath = options.output || `permissions-export.${options.format}`;

    if (options.format === 'json') {
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
      console.log(chalk.green(`✓ Export complete: ${outputPath}`));
    } else {
      // CSV export - each entity type as separate file
      const outputDir = path.dirname(outputPath);
      const baseName = path.basename(outputPath, '.csv');
      let fileCount = 0;

      for (const [key, rows] of Object.entries(data)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const csvPath = path.join(outputDir, `${baseName}-${key}.csv`);
        fs.writeFileSync(csvPath, toCsv(rows));
        console.log(chalk.dim(`  ${csvPath} (${rows.length} rows)`));
        fileCount++;
      }

      console.log(chalk.green(`\n✓ CSV export complete: ${fileCount} files`));
    }

    console.log(chalk.dim(`Exported ${Object.keys(data).length} entity types`));

  } catch (error) {
    console.error(chalk.red('Export failed:'), error.message);
    throw error;
  }
}
