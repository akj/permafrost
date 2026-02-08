import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('resolveOrg', () => {
  it('passes alias to StateAggregator.aliases.resolveUsername', async () => {
    const mockAlias = 'myorg';
    const mockUsername = 'user@example.com';

    mock.module('@salesforce/core', {
      namedExports: {
        StateAggregator: {
          getInstance: async () => ({
            aliases: {
              resolveUsername: (alias) => {
                assert.strictEqual(alias, mockAlias);
                return mockUsername;
              }
            }
          })
        },
        AuthInfo: {},
        Connection: {}
      }
    });

    mock.module('@salesforce/source-deploy-retrieve', {
      namedExports: {
        ComponentSet: class {}
      }
    });

    mock.module('../../../src/lib/parser.js', {
      namedExports: {
        parseProfiles: async () => [],
        parsePermissionSets: async () => [],
        parsePermissionSetGroups: async () => []
      }
    });

    const { resolveOrg } = await import('../../../src/lib/retriever.js');
    const result = await resolveOrg(mockAlias);

    assert.strictEqual(result, mockUsername);

    mock.restoreAll();
  });
});

describe('retriever exports', () => {
  it('exports fetchMetadata function', async () => {
    mock.module('@salesforce/core', {
      namedExports: {
        StateAggregator: {
          getInstance: async () => ({ aliases: { resolveUsername: () => '' } })
        },
        AuthInfo: {},
        Connection: {}
      }
    });

    mock.module('@salesforce/source-deploy-retrieve', {
      namedExports: {
        ComponentSet: class {}
      }
    });

    mock.module('../../../src/lib/parser.js', {
      namedExports: {
        parseProfiles: async () => [],
        parsePermissionSets: async () => [],
        parsePermissionSetGroups: async () => []
      }
    });

    const retriever = await import('../../../src/lib/retriever.js');
    assert.strictEqual(typeof retriever.fetchMetadata, 'function');

    mock.restoreAll();
  });

  it('exports queryUserAssignments function', async () => {
    mock.module('@salesforce/core', {
      namedExports: {
        StateAggregator: {
          getInstance: async () => ({ aliases: { resolveUsername: () => '' } })
        },
        AuthInfo: {},
        Connection: {}
      }
    });

    mock.module('@salesforce/source-deploy-retrieve', {
      namedExports: {
        ComponentSet: class {}
      }
    });

    mock.module('../../../src/lib/parser.js', {
      namedExports: {
        parseProfiles: async () => [],
        parsePermissionSets: async () => [],
        parsePermissionSetGroups: async () => []
      }
    });

    const retriever = await import('../../../src/lib/retriever.js');
    assert.strictEqual(typeof retriever.queryUserAssignments, 'function');

    mock.restoreAll();
  });

  it('exports queryUsers function', async () => {
    mock.module('@salesforce/core', {
      namedExports: {
        StateAggregator: {
          getInstance: async () => ({ aliases: { resolveUsername: () => '' } })
        },
        AuthInfo: {},
        Connection: {}
      }
    });

    mock.module('@salesforce/source-deploy-retrieve', {
      namedExports: {
        ComponentSet: class {}
      }
    });

    mock.module('../../../src/lib/parser.js', {
      namedExports: {
        parseProfiles: async () => [],
        parsePermissionSets: async () => [],
        parsePermissionSetGroups: async () => []
      }
    });

    const retriever = await import('../../../src/lib/retriever.js');
    assert.strictEqual(typeof retriever.queryUsers, 'function');

    mock.restoreAll();
  });
});
