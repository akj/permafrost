/**
 * JSON reporter for analysis results
 * Wraps analysis output with metadata and returns formatted JSON string
 */

/**
 * Generate JSON report from analysis results
 * @param {Object} analysisResults - Combined analysis output from analyzers
 * @param {Object} options - Report options
 * @param {string} [options.dbPath] - Path to database file
 * @returns {string} Formatted JSON string with metadata wrapper
 */
export function generateJsonReport(analysisResults, options = {}) {
  const metadata = {
    generatedAt: new Date().toISOString(),
    version: '1.0.0',
    dbPath: options.dbPath || null
  };
  return JSON.stringify({ metadata, analysis: analysisResults }, null, 2);
}
