import fs from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import { analyzeDependencyHealth } from '../lib/analyzers/dependency.js';

export async function validateAction(options) {
  const spinner = ora();

  try {
    if (!fs.existsSync(options.db)) {
      throw new Error(`No database found at ${options.db}. Run sf-perm parse first.`);
    }

    spinner.start('Analyzing dependency health...');
    const result = await analyzeDependencyHealth(options.db);
    spinner.succeed('Analysis complete');

    if (result.no_dependency_rules) {
      console.log(chalk.yellow('\nNo dependency rules found. Run sf-perm parse first to seed dependency rules.'));
      return;
    }

    if (result.no_permissions) {
      console.log(chalk.yellow('\nNo permissions found in database. Run sf-perm parse first.'));
      return;
    }

    if (options.format === 'json') {
      const output = JSON.stringify(result, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, output);
        console.log(chalk.green(`\nValidation results saved to: ${options.output}`));
      } else {
        console.log(output);
      }
      return;
    }

    console.log(chalk.bold('\n=== Dependency Health Validation ==='));
    console.log(`\nOverall Score: ${result.score}/100`);
    console.log(`\nViolations: ${result.summary.total_violations} total`);
    console.log(`  Errors: ${result.summary.by_severity.error}`);
    console.log(`  Warnings: ${result.summary.by_severity.warning}`);
    console.log(`  Info: ${result.summary.by_severity.info}`);
    console.log(`\nSources Analyzed: ${result.summary.sources_analyzed}`);
    console.log(`Sources with Issues: ${result.summary.sources_with_issues}`);

    if (result.findings.length > 0) {
      const bySeverity = {
        ERROR: result.findings.filter(f => f.severity === 'ERROR'),
        WARNING: result.findings.filter(f => f.severity === 'WARNING'),
        INFO: result.findings.filter(f => f.severity === 'INFO'),
      };

      for (const [severity, findings] of Object.entries(bySeverity)) {
        if (findings.length === 0) continue;

        const color = severity === 'ERROR' ? 'red' : severity === 'WARNING' ? 'yellow' : 'blue';
        console.log(chalk[color](`\n${severity}S (${findings.length}):`));

        const bySource = {};
        for (const finding of findings) {
          const key = `${finding.source_type}:${finding.source_id}`;
          if (!bySource[key]) bySource[key] = [];
          bySource[key].push(finding);
        }

        for (const [source, sourceFindings] of Object.entries(bySource)) {
          console.log(chalk.dim(`\n  ${source}:`));
          for (const finding of sourceFindings) {
            console.log(`    - ${finding.message}`);
          }
        }
      }
    }

    if (options.output) {
      const textOutput = [
        '=== Dependency Health Validation ===',
        '',
        `Overall Score: ${result.score}/100`,
        `Violations: ${result.summary.total_violations} total`,
        `  Errors: ${result.summary.by_severity.error}`,
        `  Warnings: ${result.summary.by_severity.warning}`,
        `  Info: ${result.summary.by_severity.info}`,
        `Sources Analyzed: ${result.summary.sources_analyzed}`,
        `Sources with Issues: ${result.summary.sources_with_issues}`,
      ];
      for (const finding of result.findings) {
        textOutput.push(`  ${finding.severity}: ${finding.message}`);
      }
      fs.writeFileSync(options.output, textOutput.join('\n'));
      console.log(chalk.green(`\nValidation results saved to: ${options.output}`));
    }

  } catch (error) {
    spinner.fail('Validation failed');
    throw error;
  }
}
