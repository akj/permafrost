import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('recommendPsgAction', () => {
  it('calls recommendAllPSGs with db path and options', async () => {
    let calledWith = null;

    mock.module('../../../src/lib/analyzers/psg-recommender.js', {
      namedExports: {
        recommendAllPSGs: async (dbPath, options) => {
          calledWith = { dbPath, options };
          return { recommendations: [] };
        }
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
      green: (str) => str
    };

    mock.module('chalk', {
      defaultExport: chalkMock
    });

    mock.module('node:fs', {
      namedExports: {
        writeFileSync: () => {}
      }
    });

    const { recommendPsgAction } = await import('../../../src/commands/recommend.js');

    await recommendPsgAction({
      db: '/path/to/test.db',
      minUsers: '10',
      coAssignmentThreshold: '0.85'
    });

    assert.deepStrictEqual(calledWith, {
      dbPath: '/path/to/test.db',
      options: {
        minUsers: 10,
        coAssignmentThreshold: 0.85
      }
    });
  });
});
