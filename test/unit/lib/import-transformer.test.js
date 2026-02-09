import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformDiffToOperations, transformRecommendationsToOperations, transformRedundancyToOperations } from '../../../src/lib/import-transformer.js';

describe('import-transformer', () => {
  describe('transformDiffToOperations', () => {
    it('transforms diff change to operation', () => {
      const diffJson = {
        source_org: 'source@example.com',
        target_org: 'target@example.com',
        changes: [
          { operation: 'ADD_PERMISSION', entity_type: 'PermissionSet', entity_id: 'SalesOps', details: { permission_name: 'Account.Create', permission_value: 'true' } },
        ],
      };

      const ops = transformDiffToOperations(diffJson);

      assert.strictEqual(ops.length, 1);
      assert.strictEqual(ops[0].operation, 'ADD_PERMISSION');
      assert.strictEqual(ops[0].entity_type, 'PermissionSet');
      assert.strictEqual(ops[0].entity_id, 'SalesOps');
      assert.strictEqual(ops[0].source_type, 'diff');
      assert.strictEqual(ops[0].execution_order, 300);
      assert.ok(ops[0].source_json);
    });

    it('returns empty array for empty changes', () => {
      const diffJson = { changes: [] };
      const ops = transformDiffToOperations(diffJson);
      assert.deepStrictEqual(ops, []);
    });

    it('throws on null input', () => {
      assert.throws(() => transformDiffToOperations(null), { message: /null or undefined/ });
    });

    it('throws on missing changes array', () => {
      assert.throws(() => transformDiffToOperations({}), { message: /missing changes array/ });
    });
  });

  describe('transformRecommendationsToOperations', () => {
    it('transforms hierarchical recommendation to CREATE_PSG + ADD_PSG_MEMBER', () => {
      const recJson = {
        hierarchical: [
          {
            recommendedPSG: { name: 'SalesBundle', label: 'Sales Bundle', members: ['SalesOps', 'SalesRead', 'SalesEdit'] },
          },
        ],
      };

      const ops = transformRecommendationsToOperations(recJson);

      assert.strictEqual(ops.length, 4);
      const createPSG = ops.filter(o => o.operation === 'CREATE_PSG');
      const addMembers = ops.filter(o => o.operation === 'ADD_PSG_MEMBER');
      assert.strictEqual(createPSG.length, 1);
      assert.strictEqual(createPSG[0].entity_id, 'SalesBundle');
      assert.strictEqual(addMembers.length, 3);
      assert.strictEqual(createPSG[0].execution_order, 100);
      assert.strictEqual(addMembers[0].execution_order, 500);
    });

    it('transforms co-assignment recommendation with derived PSG name', () => {
      const recJson = {
        coAssignment: [
          { members: ['SalesOps', 'MarketingUser'] },
        ],
      };

      const ops = transformRecommendationsToOperations(recJson);

      const createPSG = ops.filter(o => o.operation === 'CREATE_PSG');
      assert.strictEqual(createPSG.length, 1);
      assert.strictEqual(createPSG[0].entity_id, 'CoAssignment_SalesOps_2');

      const addMembers = ops.filter(o => o.operation === 'ADD_PSG_MEMBER');
      assert.strictEqual(addMembers.length, 2);
    });

    it('throws on null input', () => {
      assert.throws(() => transformRecommendationsToOperations(null), { message: /null or undefined/ });
    });

    it('throws on missing both keys', () => {
      assert.throws(() => transformRecommendationsToOperations({}), { message: /missing hierarchical or coAssignment/ });
    });
  });

  describe('transformRedundancyToOperations', () => {
    it('transforms redundancy detail to REMOVE_PERMISSION', () => {
      const redundancyJson = {
        profile_ps_redundancy: {
          details: [
            {
              permission_name: 'Account.Create',
              permission_value: 'true',
              permission_sets: ['SalesOps', 'SalesRead'],
            },
          ],
        },
      };

      const ops = transformRedundancyToOperations(redundancyJson);

      assert.strictEqual(ops.length, 2);
      assert.strictEqual(ops[0].operation, 'REMOVE_PERMISSION');
      assert.strictEqual(ops[0].entity_type, 'PermissionSet');
      assert.strictEqual(ops[0].entity_id, 'SalesOps');
      assert.strictEqual(ops[0].source_type, 'recommendation');
      assert.strictEqual(ops[0].execution_order, 400);
      assert.ok(ops[0].source_json);
    });

    it('returns empty array for empty details', () => {
      const ops = transformRedundancyToOperations({ profile_ps_redundancy: { details: [] } });
      assert.deepStrictEqual(ops, []);
    });

    it('throws on null input', () => {
      assert.throws(() => transformRedundancyToOperations(null), { message: /null or undefined/ });
    });
  });
});
