import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { analyzeAllRedundancy } from '../lib/analyzers/redundancy.js';
import { analyzePermissionSetOverlap } from '../lib/analyzers/overlap.js';
import { recommendAllPSGs } from '../lib/analyzers/psg-recommender.js';
import { analyzeObjectAccess, listAllObjects } from '../lib/analyzers/object-view.js';
import { aggregateForReport } from '../lib/analyzers/report-aggregator.js';
import { generateJsonReport } from '../lib/reporters/json.js';
import { generateMarkdownReport } from '../lib/reporters/markdown.js';
import { generateHtmlReport } from '../lib/reporters/html.js';

export async function reportAction(options) {
  const limit = options.limit ? parseInt(options.limit, 10) : 10;
  if (isNaN(limit) || limit < 1) {
    throw new Error('--limit must be a positive integer');
  }

  const spinner = ora();
  const includedTypes = options.include ? options.include.split(',') : ['all'];

  try {
    const analysisResults = {};

    if (includedTypes.includes('all') || includedTypes.includes('redundancy')) {
      spinner.start('Analyzing redundancy...');
      analysisResults.redundancy = await analyzeAllRedundancy(options.db);
      spinner.succeed('Redundancy analysis complete');
    }

    if (includedTypes.includes('all') || includedTypes.includes('overlap')) {
      spinner.start('Analyzing overlap...');
      analysisResults.overlap = await analyzePermissionSetOverlap(options.db);
      spinner.succeed('Overlap analysis complete');
    }

    if (includedTypes.includes('all') || includedTypes.includes('psg')) {
      spinner.start('Generating PSG recommendations...');
      analysisResults.psg_recommendations = await recommendAllPSGs(options.db);
      spinner.succeed('PSG recommendations complete');
    }

    if (includedTypes.includes('all') || includedTypes.includes('object')) {
      spinner.start('Analyzing object access...');
      const objects = await listAllObjects(options.db);
      analysisResults.object_views = {};
      for (const obj of objects.slice(0, limit)) {
        analysisResults.object_views[obj] = await analyzeObjectAccess(options.db, obj);
      }
      spinner.succeed('Object analysis complete');
    }

    // Aggregate raw results for markdown/HTML reports
    spinner.start('Aggregating report data...');
    const aggregated = aggregateForReport(options.db, analysisResults);
    spinner.succeed('Aggregation complete');

    spinner.start(`Generating ${options.format} report...`);
    let report;
    if (options.format === 'json') {
      report = generateJsonReport(analysisResults, aggregated, { dbPath: options.db, limit });
    } else if (options.format === 'markdown' || options.format === 'md') {
      report = generateMarkdownReport(analysisResults, aggregated, { limit });
    } else {
      report = generateHtmlReport(analysisResults, aggregated, { limit });
    }
    spinner.succeed('Report generated');

    fs.writeFileSync(options.output, report);
    console.log(chalk.green(`Report saved to: ${options.output}`));
  } catch (error) {
    spinner.fail('Report generation failed');
    console.error(chalk.red('Error:'), error.message);
    throw error;
  }
}
