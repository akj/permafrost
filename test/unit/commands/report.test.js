import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realFs from 'node:fs';

describe('reportAction', () => {
  it('calls aggregateForReport and generates report with correct format', async () => {
    let analyzeCalledWith = null;
    let aggregateCalledWith = null;
    let reporterCalledWith = null;

    const mockRedundancyResults = { profile_ps_redundancy: { details: [] } };
    const mockOverlapResults = { pairs: [] };
    const mockPsgResults = { hierarchical: { recommendations: [] }, coAssignment: { recommendations: [] } };

    const mockAggregated = {
      context: {},
      executiveSummary: { findings: [] }
    };

    mock.module('../../../src/lib/analyzers/redundancy.js', {
      namedExports: {
        analyzeAllRedundancy: async (dbPath) => {
          analyzeCalledWith = { dbPath };
          return mockRedundancyResults;
        }
      }
    });

    mock.module('../../../src/lib/analyzers/overlap.js', {
      namedExports: {
        analyzePermissionSetOverlap: async () => mockOverlapResults
      }
    });

    mock.module('../../../src/lib/analyzers/psg-recommender.js', {
      namedExports: {
        recommendAllPSGs: async () => mockPsgResults
      }
    });

    mock.module('../../../src/lib/analyzers/object-view.js', {
      namedExports: {
        analyzeObjectAccess: async () => ({ sources: [] }),
        listAllObjects: async () => ['Account']
      }
    });

    mock.module('../../../src/lib/analyzers/dependency.js', {
      namedExports: {
        analyzeDependencyHealth: () => ({ score: 100, findings: [] })
      }
    });

    mock.module('../../../src/lib/analyzers/report-aggregator.js', {
      namedExports: {
        aggregateForReport: (dbPath, analysisResults, config) => {
          aggregateCalledWith = { dbPath, analysisResults, config };
          return mockAggregated;
        }
      }
    });

    mock.module('../../../src/lib/reporters/json.js', {
      namedExports: {
        generateJsonReport: (analysisResults, aggregated, options) => {
          reporterCalledWith = { analysisResults, aggregated, options };
          return JSON.stringify({ metadata: {}, analysis: analysisResults });
        }
      }
    });

    mock.module('../../../src/lib/reporters/markdown.js', {
      namedExports: {
        generateMarkdownReport: () => '# Report'
      }
    });

    mock.module('../../../src/lib/reporters/html.js', {
      namedExports: {
        generateHtmlReport: () => '<html></html>'
      }
    });

    const oraMock = () => ({
      start: () => ({ succeed: () => {}, fail: () => {} }),
      succeed: () => {},
      fail: () => {}
    });

    mock.module('ora', {
      defaultExport: oraMock
    });

    const chalkMock = {
      red: (str) => str,
      green: (str) => str,
      blue: (str) => str
    };

    mock.module('chalk', {
      defaultExport: chalkMock
    });

    mock.module('node:fs', {
      namedExports: {
        ...realFs,
        writeFileSync: () => {},
      },
      defaultExport: { ...realFs, writeFileSync: () => {} },
    });

    const { reportAction } = await import('../../../src/commands/report.js');

    await reportAction({
      db: '/path/to/test.db',
      format: 'json',
      output: '/output/report.json'
    });

    assert.strictEqual(analyzeCalledWith.dbPath, '/path/to/test.db');
    assert.strictEqual(aggregateCalledWith.dbPath, '/path/to/test.db');
    assert.ok(aggregateCalledWith.analysisResults);
    assert.ok(reporterCalledWith.aggregated);
    assert.strictEqual(reporterCalledWith.options.dbPath, '/path/to/test.db');
  });
});
