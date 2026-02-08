import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateJsonReport } from '../../../../src/lib/reporters/json.js';

describe('generateJsonReport', () => {
  it('returns valid JSON with metadata wrapper', () => {
    const analysisResults = {
      redundancy: { profile_ps_redundancy: { summary: { total: 10 } } },
    };

    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.ok(parsed.metadata, 'Should have metadata key');
    assert.ok(parsed.analysis, 'Should have analysis key');
  });

  it('includes generatedAt timestamp in metadata', () => {
    const analysisResults = { test: 'data' };
    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.ok(parsed.metadata.generatedAt, 'Should have generatedAt');
    assert.ok(parsed.metadata.generatedAt.match(/^\d{4}-\d{2}-\d{2}T/), 'Should be ISO timestamp');
  });

  it('includes version in metadata', () => {
    const analysisResults = { test: 'data' };
    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.equal(parsed.metadata.version, '1.0.0');
  });

  it('defaults dbPath to null when not provided', () => {
    const analysisResults = { test: 'data' };
    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.equal(parsed.metadata.dbPath, null);
  });

  it('sets dbPath when provided in options', () => {
    const analysisResults = { test: 'data' };
    const options = { dbPath: '/home/user/.permafrost/myorg/permissions.db' };
    const result = generateJsonReport(analysisResults, options);
    const parsed = JSON.parse(result);

    assert.equal(parsed.metadata.dbPath, '/home/user/.permafrost/myorg/permissions.db');
  });

  it('includes analysis key with passed analysisResults', () => {
    const analysisResults = {
      redundancy: { total: 42 },
      overlap: { pairs: [] },
    };
    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.deepEqual(parsed.analysis, analysisResults);
  });

  it('formats output with 2-space indentation', () => {
    const analysisResults = { test: 'data' };
    const result = generateJsonReport(analysisResults);

    assert.ok(result.includes('  "metadata"'), 'Should have 2-space indent');
  });

  it('handles empty analysisResults object', () => {
    const analysisResults = {};
    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.deepEqual(parsed.analysis, {});
  });

  it('handles complex nested analysisResults', () => {
    const analysisResults = {
      redundancy: {
        profile_ps_redundancy: {
          summary: { total: 10 },
          details: [{ user: 'test@example.com', permission: 'Account.Create::true' }],
        },
      },
      overlap: {
        summary: { pairs: 5 },
      },
    };
    const result = generateJsonReport(analysisResults);
    const parsed = JSON.parse(result);

    assert.deepEqual(parsed.analysis, analysisResults);
  });
});
