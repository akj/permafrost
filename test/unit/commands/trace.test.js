import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('traceCommand', () => {
  it('passes db, user, permission, and verbose options correctly', async () => {
    let calledWith = null;

    mock.module('../../../src/lib/tracer.js', {
      namedExports: {
        traceUserPermission: async (dbPath, user, permission, opts) => {
          calledWith = { dbPath, user, permission, opts };
          return {
            user: 'test@example.com',
            userId: 'userId123',
            permission: 'Account.Read',
            sources: []
          };
        }
      }
    });

    const chalkMock = {
      blue: (str) => str,
      bold: (str) => str,
      yellow: (str) => str,
      green: (str) => str,
      dim: (str) => str,
      red: (str) => str
    };

    mock.module('chalk', {
      defaultExport: chalkMock
    });

    const { traceCommand } = await import('../../../src/commands/trace.js');

    await traceCommand({
      db: '/path/to/test.db',
      user: 'test@example.com',
      permission: 'Account.Read',
      verbose: true,
      format: 'table'
    });

    assert.deepStrictEqual(calledWith, {
      dbPath: '/path/to/test.db',
      user: 'test@example.com',
      permission: 'Account.Read',
      opts: { verbose: true }
    });
  });
});
