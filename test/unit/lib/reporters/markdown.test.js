import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMarkdownReport } from '../../../../src/lib/reporters/markdown.js';

describe('generateMarkdownReport', () => {
  it('contains expected section headers', () => {
    const analysisResults = {
      redundancy: {},
      overlap: {},
      psg_recommendations: {},
    };
    const aggregated = {
      executiveSummary: { metrics: [], findings: [] },
      profilePSRedundancy: { byProfile: [], byPS: [] },
      multiplePSRedundancy: { byUser: [], byPSPair: [], byPermission: [] },
      psgRedundancy: { byPSG: [] },
      profileOnly: [],
      overlapClassified: [],
    };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('# Salesforce Permission Analysis Report'), 'Should have report title');
    assert.ok(result.includes('## Analysis Summary'), 'Should have executive summary section');
    assert.ok(result.includes('## Profile + Permission Set Redundancy'), 'Should have profile PS section');
    assert.ok(result.includes('## Multiple Permission Set Redundancy'), 'Should have multiple PS section');
    assert.ok(result.includes('## Permission Set Group Redundancy'), 'Should have PSG section');
    assert.ok(result.includes('## Profile Dependency Analysis'), 'Should have profile dependency section');
    assert.ok(result.includes('## Permission Set Overlap Analysis'), 'Should have overlap section');
    assert.ok(result.includes('## Permission Set Group Patterns'), 'Should have PSG patterns section');
  });

  it('includes generated timestamp in header', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('**Generated:**'), 'Should have generated label');
    assert.ok(result.match(/\*\*Generated:\*\* \d{4}-\d{2}-\d{2}T/), 'Should include ISO timestamp');
  });

  it('produces no-data messages for empty executive summary', () => {
    const analysisResults = {};
    const aggregated = { executiveSummary: null };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('No summary data available'), 'Should show no-data message');
  });

  it('produces no-data messages for empty profile PS redundancy', () => {
    const analysisResults = { redundancy: {} };
    const aggregated = { profilePSRedundancy: { byProfile: [], byPS: [] } };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('No redundant permissions found between profiles and permission sets'), 'Should show no-data message');
  });

  it('produces no-data messages for empty multiple PS redundancy', () => {
    const analysisResults = { redundancy: {} };
    const aggregated = { multiplePSRedundancy: { byUser: [] } };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('No redundant permissions found across multiple permission sets'), 'Should show no-data message');
  });

  it('produces no-data messages for empty PSG redundancy', () => {
    const analysisResults = { redundancy: {} };
    const aggregated = { psgRedundancy: { byPSG: [] } };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('No redundant permission set group assignments found'), 'Should show no-data message');
  });

  it('produces no-data messages for empty profile dependency', () => {
    const analysisResults = { redundancy: {} };
    const aggregated = { profileOnly: [] };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('No profile-only permissions found'), 'Should show no-data message');
  });

  it('produces content for populated executive summary metrics', () => {
    const analysisResults = {};
    const aggregated = {
      executiveSummary: {
        metrics: [
          { label: 'Total Users', value: 100, context: 'Active users' },
          { label: 'Total Profiles', value: 10, context: 'Custom profiles' },
        ],
        findings: [],
      },
    };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('### Key Findings'), 'Should have metrics table');
    assert.ok(result.includes('Total Users'), 'Should include metric label');
    assert.ok(result.includes('100'), 'Should include metric value');
  });

  it('produces content for populated profile PS redundancy', () => {
    const analysisResults = {
      redundancy: {
        profile_ps_redundancy: {
          summary: { total_redundant_permissions: 50, affected_users: 10, affected_permission_sets: 5 },
        },
      },
    };
    const aggregated = {
      profilePSRedundancy: {
        byProfile: [
          {
            profile: 'Standard User',
            totalPerms: 100,
            redundantPerms: 20,
            overlapPct: 20,
            topOverlappingPS: [{ ps: 'Sales PS', count: 15 }],
            usersAffected: 10,
          },
        ],
        byPS: [],
      },
    };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('Standard User'), 'Should include profile name');
    assert.ok(result.includes('Sales PS'), 'Should include PS name');
    assert.ok(result.includes('50 redundant permissions'), 'Should include summary');
  });

  it('produces content for populated multiple PS redundancy', () => {
    const analysisResults = {
      redundancy: {
        multiple_ps_redundancy: {
          summary: { total_redundant_permissions: 30, affected_users: 5 },
        },
      },
    };
    const aggregated = {
      multiplePSRedundancy: {
        byUser: [
          {
            user: 'user@example.com',
            redundantPerms: 10,
            totalPS: 3,
            worstPairs: [{ psA: 'PS1', psB: 'PS2', shared: 5 }],
            score: 100,
          },
        ],
        byPSPair: [],
        byPermission: [],
      },
    };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('user@example.com'), 'Should include username');
    assert.ok(result.includes('PS1'), 'Should include PS pair');
  });

  it('escapes pipe characters in markdown table cells', () => {
    const analysisResults = {};
    const aggregated = {
      profilePSRedundancy: {
        byProfile: [
          {
            profile: 'Test|Profile',
            totalPerms: 10,
            redundantPerms: 5,
            overlapPct: 50,
            topOverlappingPS: [],
            usersAffected: 1,
          },
        ],
        byPS: [],
      },
    };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('Test\\|Profile'), 'Should escape pipe in profile name');
  });

  it('includes footer with JSON export reference', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('For complete analysis data, export to JSON format'), 'Should have footer');
  });

  it('throws when aggregated is null', () => {
    const analysisResults = {};
    const aggregated = null;

    assert.throws(() => {
      generateMarkdownReport(analysisResults, aggregated);
    }, /Cannot read properties of null/);
  });

  it('handles missing nested properties in aggregated', () => {
    const analysisResults = { redundancy: {} };
    const aggregated = { profilePSRedundancy: {} };

    const result = generateMarkdownReport(analysisResults, aggregated);

    assert.ok(result.includes('## Profile + Permission Set Redundancy'), 'Should still render section');
  });
});
