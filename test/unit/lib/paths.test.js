import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

describe('resolveDbPath', () => {
  it('with orgFlag resolves alias to username', async () => {
    const mockUsername = 'test@example.com';
    const mockOrgFlag = 'myalias';

    mock.module('@salesforce/core', {
      namedExports: {
        StateAggregator: {
          getInstance: async () => ({
            aliases: {
              resolveUsername: (alias) => {
                assert.strictEqual(alias, mockOrgFlag);
                return mockUsername;
              }
            }
          })
        },
        ConfigAggregator: {},
        SfProject: {}
      }
    });

    const { resolveDbPath } = await import('../../../src/lib/paths.js');
    const result = await resolveDbPath(mockOrgFlag);

    assert.notStrictEqual(result, null);
    assert.strictEqual(result.username, mockUsername);
    assert.strictEqual(
      result.dbPath,
      path.join(os.homedir(), '.permafrost', mockUsername, 'permissions.db')
    );

    mock.restoreAll();
  });

  it('without orgFlag outside SFDX project returns null', async () => {
    mock.module('@salesforce/core', {
      namedExports: {
        StateAggregator: {
          getInstance: async () => ({
            aliases: {
              resolveUsername: () => null
            }
          })
        },
        ConfigAggregator: {
          create: async () => ({
            getPropertyValue: () => null
          })
        },
        SfProject: {
          resolveProjectPathSync: () => {
            throw new Error('Not in SFDX project');
          }
        }
      }
    });

    const { resolveDbPath } = await import('../../../src/lib/paths.js');
    const result = await resolveDbPath(undefined);

    assert.strictEqual(result, null);

    mock.restoreAll();
  });
});
