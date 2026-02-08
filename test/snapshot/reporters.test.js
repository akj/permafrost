import { describe, it } from 'node:test';
import { generateJsonReport } from '../../src/lib/reporters/json.js';
import { generateMarkdownReport } from '../../src/lib/reporters/markdown.js';

function stripTimestamps(text) {
  return text
    .replace(/"generatedAt":\s*"[^"]+"/g, '"generatedAt": "TIMESTAMP"')
    .replace(/\*\*Generated:\*\*\s+.+/g, '**Generated:** TIMESTAMP');
}

describe('Reporter snapshots', () => {
  it('JSON report snapshot', (t) => {
    const analysisResults = {
      redundancy: {
        profile_ps_redundancy: {
          summary: {
            total_redundant_permissions: 15,
            affected_users: 3,
            affected_permission_sets: 2
          },
          details: [
            {
              permission: 'ObjectPermissions::Account.Read',
              user: 'alice@example.com',
              profile: 'Standard User',
              permission_sets: ['Sales Access', 'Account Manager'],
              value: 'true'
            }
          ]
        },
        multiple_ps_redundancy: {
          summary: {
            total_redundant_permissions: 8,
            affected_users: 2
          },
          details: []
        },
        psg_redundancy: {
          summary: {
            total_redundant_assignments: 4,
            affected_users: 2
          },
          details: [
            {
              user: 'bob@example.com',
              psg: 'Sales Team',
              redundant_ps: ['Sales Access']
            }
          ]
        },
        profile_only_permissions: {
          summary: {
            total_profile_only: 42,
            profiles_affected: 3,
            percentage_profile_only: '25.5'
          },
          details: []
        }
      },
      overlap: {
        summary: {
          total_comparisons: 10,
          high_overlap_pairs: 2
        },
        pairs: [
          {
            permission_set_a: { name: 'Sales Basic', permission_count: 10 },
            permission_set_b: { name: 'Sales Advanced', permission_count: 15 },
            metrics: {
              overlap_percentage: 0.95,
              jaccard_index: 0.75
            }
          }
        ]
      },
      psg_recommendations: {
        hierarchical: {
          recommendations: [
            {
              basePermissionSet: 'Admin Full',
              basePermissionCount: 100,
              totalSubsets: 2,
              recommendedPSG: {
                members: ['Admin Read', 'Admin Edit']
              }
            }
          ]
        },
        coAssignment: {
          recommendations: [
            {
              members: ['Sales Basic', 'Marketing Basic'],
              member_count: 2,
              estimated_reduction: 2
            }
          ]
        }
      }
    };

    const options = {
      dbPath: '/path/to/test.db'
    };

    const result = generateJsonReport(analysisResults, options);
    const stripped = stripTimestamps(result);
    t.assert.snapshot(stripped);
  });

  it('Markdown report snapshot', (t) => {
    const analysisResults = {
      redundancy: {
        profile_ps_redundancy: {
          summary: {
            total_redundant_permissions: 15,
            affected_users: 3,
            affected_permission_sets: 2
          },
          details: [
            {
              permission: 'ObjectPermissions::Account.Read',
              user: 'alice@example.com',
              profile: 'Standard User',
              permission_sets: ['Sales Access', 'Account Manager'],
              value: 'true'
            }
          ]
        },
        multiple_ps_redundancy: {
          summary: {
            total_redundant_permissions: 8,
            affected_users: 2
          },
          details: []
        },
        psg_redundancy: {
          summary: {
            total_redundant_assignments: 4,
            affected_users: 2
          },
          details: [
            {
              user: 'bob@example.com',
              psg: 'Sales Team',
              redundant_ps: ['Sales Access']
            }
          ]
        },
        profile_only_permissions: {
          summary: {
            total_profile_only: 42,
            profiles_affected: 3,
            percentage_profile_only: '25.5'
          },
          details: []
        }
      },
      overlap: {
        summary: {
          total_comparisons: 10,
          high_overlap_pairs: 2
        },
        pairs: [
          {
            permission_set_a: { name: 'Sales Basic', permission_count: 10 },
            permission_set_b: { name: 'Sales Advanced', permission_count: 15 },
            metrics: {
              overlap_percentage: 0.95,
              jaccard_index: 0.75
            }
          }
        ]
      },
      psg_recommendations: {
        hierarchical: {
          recommendations: [
            {
              basePermissionSet: 'Admin Full',
              basePermissionCount: 100,
              totalSubsets: 2,
              recommendedPSG: {
                members: ['Admin Read', 'Admin Edit']
              }
            }
          ]
        },
        coAssignment: {
          recommendations: [
            {
              members: ['Sales Basic', 'Marketing Basic'],
              member_count: 2,
              estimated_reduction: 2
            }
          ]
        }
      }
    };

    const aggregated = {
      executiveSummary: {
        metrics: [
          {
            label: 'Total Redundant Permissions',
            value: 15,
            context: 'Across 3 users'
          },
          {
            label: 'Permission Sets Analyzed',
            value: 5,
            context: 'With 2 high-overlap pairs'
          }
        ],
        findings: [
          {
            title: 'Profile-PS Overlap',
            detail: '15 redundant permissions found between profiles and permission sets'
          },
          {
            title: 'PSG Redundancy',
            detail: '4 redundant direct PS assignments detected'
          }
        ]
      },
      profilePSRedundancy: {
        byProfile: [
          {
            profile: 'Standard User',
            totalPerms: 50,
            redundantPerms: 10,
            overlapPct: 20,
            topOverlappingPS: [
              { ps: 'Sales Access', count: 8 },
              { ps: 'Account Manager', count: 2 }
            ],
            usersAffected: 3
          }
        ],
        byPS: [
          {
            ps: 'Sales Access',
            overlappingProfiles: [
              { profile: 'Standard User', count: 8 }
            ],
            totalRedundant: 8,
            usersAffected: 3
          }
        ]
      },
      multiplePSRedundancy: {
        byUser: [
          {
            user: 'alice@example.com',
            redundantPerms: 5,
            totalPS: 3,
            worstPairs: [
              { psA: 'Sales Basic', psB: 'Sales Advanced', shared: 4 }
            ],
            score: 15
          }
        ],
        byPSPair: [
          {
            psA: 'Sales Basic',
            psB: 'Sales Advanced',
            sharedPerms: 8,
            usersWithBoth: 2
          }
        ],
        byPermission: [
          {
            permission: 'ObjectPermissions::Account.Read::true',
            psCount: 3,
            userCount: 5
          }
        ]
      },
      psgRedundancy: {
        byPSG: [
          {
            psg: 'Sales Team',
            redundantPS: [
              { ps: 'Sales Access', userCount: 2 }
            ],
            totalUsers: 2,
            exampleUsers: ['bob@example.com', 'charlie@example.com']
          }
        ]
      },
      profileOnly: [
        {
          rank: 1,
          profile: 'System Administrator',
          uniquePerms: 150,
          pctOfProfile: 85,
          userCount: 2,
          complexity: 'High'
        },
        {
          rank: 2,
          profile: 'Standard User',
          uniquePerms: 25,
          pctOfProfile: 45,
          userCount: 10,
          complexity: 'Low'
        }
      ],
      overlapClassified: [
        {
          permission_set_a: { name: 'Sales Basic', permission_count: 10 },
          permission_set_b: { name: 'Sales Advanced', permission_count: 15 },
          metrics: { overlap_percentage: 0.95 },
          relationship: 'Near-perfect subset'
        }
      ]
    };

    const result = generateMarkdownReport(analysisResults, aggregated);
    const stripped = stripTimestamps(result);
    t.assert.snapshot(stripped);
  });
});
