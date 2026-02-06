/**
 * HTML reporter for analysis results
 * Generates interactive HTML report using template
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate HTML report from analysis results
 * @param {Object} analysisResults - Combined analysis output from analyzers
 * @param {Object} aggregated - Aggregated data structure (optional)
 * @returns {string} Complete HTML document
 */
export function generateHtmlReport(analysisResults, aggregated) {
  const templatePath = path.join(__dirname, '../../templates/analysis-report.html');
  let template = fs.readFileSync(templatePath, 'utf-8');

  const timestamp = new Date().toISOString();
  const dataJson = JSON.stringify({
    generatedAt: timestamp,
    version: '2.0',
    analysis: analysisResults,
    aggregated: aggregated
  });

  // Replace placeholders - escape < to prevent script injection
  template = template.replace(/\{\{(ANALYSIS_DATA|GENERATED_AT)\}\}/g, (match, key) => {
    if (key === 'ANALYSIS_DATA') return dataJson.replace(/</g, '\\u003c');
    if (key === 'GENERATED_AT') return timestamp;
    return match;
  });

  return template;
}
