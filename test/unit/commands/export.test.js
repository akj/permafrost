import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('exportCommand', () => {
  it('exports to JSON format with single file', async () => {
    const mockData = {
      profiles: [{ id: 'prof1', full_name: 'Standard User' }],
      permissionSets: [{ id: 'ps1', full_name: 'CustomPS' }]
    };

    let exportCalledWith = null;
    let writtenFiles = [];

    mock.module('../../../src/lib/database.js', {
      namedExports: {
        exportDatabase: async (dbPath, options) => {
          exportCalledWith = { dbPath, options };
          return mockData;
        }
      }
    });

    const chalkMock = {
      blue: (str) => str,
      green: (str) => str,
      dim: (str) => str,
      red: (str) => str
    };

    mock.module('chalk', {
      defaultExport: chalkMock
    });

    mock.module('node:fs', {
      namedExports: {
        writeFileSync: (path, content) => {
          writtenFiles.push({ path, content });
        }
      }
    });

    mock.module('node:path', {
      namedExports: {
        dirname: (p) => '/output',
        basename: (p) => 'export.json',
        join: (...args) => args.join('/')
      }
    });

    const { exportCommand } = await import('../../../src/commands/export.js');

    await exportCommand({
      db: '/path/to/test.db',
      include: 'all',
      format: 'json',
      output: '/output/export.json'
    });

    assert.strictEqual(exportCalledWith.dbPath, '/path/to/test.db');
    assert.strictEqual(exportCalledWith.options.format, 'json');
    assert.deepStrictEqual(exportCalledWith.options.include, ['all']);

    assert.strictEqual(writtenFiles.length, 1);
    assert.strictEqual(writtenFiles[0].path, '/output/export.json');

    const parsedContent = JSON.parse(writtenFiles[0].content);
    assert.deepStrictEqual(parsedContent, mockData);
  });
});
