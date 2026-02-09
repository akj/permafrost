import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateHtmlReport } from '../../../../src/lib/reporters/html.js';

describe('generateHtmlReport', () => {
  it('reads template and returns HTML document', () => {
    const analysisResults = { test: 'data' };
    const aggregated = { test: 'aggregated' };

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('<!DOCTYPE html>'), 'Should be valid HTML document');
    assert.ok(result.includes('<html'), 'Should have html tag');
    assert.ok(result.includes('</html>'), 'Should close html tag');
  });

  it('replaces GENERATED_AT placeholder with timestamp', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(!result.includes('{{GENERATED_AT}}'), 'Should replace placeholder');
    assert.ok(result.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/), 'Should contain ISO timestamp');
  });

  it('replaces ANALYSIS_DATA placeholder with JSON', () => {
    const analysisResults = { redundancy: { total: 10 } };
    const aggregated = { profileOnly: [] };

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(!result.includes('{{ANALYSIS_DATA}}'), 'Should replace placeholder');
    assert.ok(result.includes('"redundancy"'), 'Should include analysis data');
  });

  it('includes analysis data in embedded JSON', () => {
    const analysisResults = {
      redundancy: { profile_ps_redundancy: { summary: { total: 42 } } },
      overlap: { summary: { pairs: 5 } },
    };
    const aggregated = { profileOnly: [{ profile: 'Test' }] };

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('"redundancy"'), 'Should include redundancy data');
    assert.ok(result.includes('"overlap"'), 'Should include overlap data');
  });

  it('includes aggregated data in embedded JSON', () => {
    const analysisResults = {};
    const aggregated = {
      profilePSRedundancy: { byProfile: [] },
      multiplePSRedundancy: { byUser: [] },
    };

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('"profilePSRedundancy"'), 'Should include aggregated data');
    assert.ok(result.includes('"multiplePSRedundancy"'), 'Should include aggregated data');
  });

  it('includes version field in embedded data', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('"version"'), 'Should have version field');
    assert.ok(result.includes('"2.0"'), 'Should have version value');
  });

  it('includes generatedAt field in embedded data', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('"generatedAt"'), 'Should have generatedAt field');
  });

  it('escapes < character to prevent script injection', () => {
    const analysisResults = {
      malicious: '<script>alert("xss")</script>',
    };
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(!result.includes('<script>alert'), 'Should not contain unescaped script tag');
    assert.ok(result.includes('\\u003cscript'), 'Should escape < as unicode');
  });

  it('prevents XSS in nested data structures', () => {
    const analysisResults = {
      redundancy: {
        details: [
          { permission: '<img src=x onerror=alert(1)>' },
        ],
      },
    };
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(!result.includes('<img src=x'), 'Should not contain unescaped img tag');
    assert.ok(result.includes('\\u003cimg'), 'Should escape < in nested data');
  });

  it('preserves > character (only < needs escaping for JSON injection)', () => {
    const analysisResults = { test: 'value>' };
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('value>'), 'Should preserve > character');
  });

  it('handles empty analysisResults and aggregated', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('<!DOCTYPE html>'), 'Should still produce valid HTML');
    assert.ok(result.includes('"analysis"'), 'Should have analysis key');
    assert.ok(result.includes('"aggregated"'), 'Should have aggregated key');
  });

  it('handles null aggregated parameter', () => {
    const analysisResults = { test: 'data' };
    const aggregated = null;

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('"aggregated":null'), 'Should handle null aggregated');
  });

  it('handles undefined aggregated parameter', () => {
    const analysisResults = { test: 'data' };

    const result = generateHtmlReport(analysisResults);

    assert.ok(result.includes('<!DOCTYPE html>'), 'Should still produce valid HTML');
  });

  it('includes limit in embedded data', () => {
    const result = generateHtmlReport({}, {}, { limit: 5 });

    assert.ok(result.includes('"limit":5'), 'Should include limit value');
  });

  it('defaults limit to 10 in embedded data', () => {
    const result = generateHtmlReport({}, {});

    assert.ok(result.includes('"limit":10'), 'Should default limit to 10');
  });

  it('includes Salesforce Permission Analysis title', () => {
    const analysisResults = {};
    const aggregated = {};

    const result = generateHtmlReport(analysisResults, aggregated);

    assert.ok(result.includes('Salesforce Permission Analysis'), 'Should have report title');
  });
});
