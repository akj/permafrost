/**
 * JSON reporter for analysis results
 * Wraps analysis output with metadata and returns formatted JSON string
 */

/**
 * Generate JSON report from analysis results
 * @param {Object} analysisResults - Combined analysis output from analyzers
 * @param {Object} aggregated - Aggregated data from aggregateForReport()
 * @param {Object} options - Report options
 * @param {string} [options.dbPath] - Path to database file
 * @param {number} [options.limit] - Maximum items per section
 * @returns {string} Formatted JSON string with metadata wrapper
 */
export function generateJsonReport(analysisResults, aggregated, options = {}) {
  const metadata = {
    generatedAt: new Date().toISOString(),
    version: '1.1.0',
    dbPath: options.dbPath || null,
    limit: options.limit ?? 10,
  };

  const serializedAggregated = aggregated ? {
    executiveSummary: aggregated.executiveSummary,
    profilePSRedundancy: aggregated.profilePSRedundancy,
    multiplePSRedundancy: aggregated.multiplePSRedundancy,
    psgRedundancy: aggregated.psgRedundancy,
    profileOnly: aggregated.profileOnly,
    overlapClassified: aggregated.overlapClassified,
    dependencyHealth: aggregated.dependencyHealth,
    thresholds: aggregated.thresholds,
  } : null;

  return JSON.stringify({ metadata, analysis: analysisResults, aggregated: serializedAggregated }, null, 2);
}
