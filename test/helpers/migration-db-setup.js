// Test fixtures for migration schema tests.
// Provides in-memory database with both permissions and migration tables.

import { seedDatabase, buildTestData } from './db-setup.js';
import { MIGRATION_SCHEMA_DDL } from '../../src/lib/migration-db.js';

/**
 * Creates in-memory database with permissions and migration schemas.
 * Uses db.exec(MIGRATION_SCHEMA_DDL) instead of initMigrationSchema() to work with in-memory DB.
 * @returns {Database} In-memory database with both schemas
 */
export function seedMigrationDatabase() {
  const db = seedDatabase();
  db.exec(MIGRATION_SCHEMA_DDL);
  return db;
}

/**
 * Provides sample plan and operations objects for test reuse.
 * @returns {Object} {plan: {...}, operations: [...]}
 */
export function buildMigrationTestData() {
  return {
    plan: {
      id: 'plan-001',
      name: 'Test Migration Plan',
      description: 'Test plan for unit tests',
      source_org: 'source@example.com',
      target_org: 'target@example.com',
      source_db_path: '/tmp/source.db',
      status: 'draft',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    operations: [
      {
        id: 'op-001',
        plan_id: 'plan-001',
        operation: 'ADD_PERMISSION',
        entity_type: 'PermissionSet',
        entity_id: 'SalesOps',
        parameters: '{}',
        status: 'pending',
        execution_order: 300,
      },
    ],
  };
}
