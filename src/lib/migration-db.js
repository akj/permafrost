// Migration schema initialization.
// Adds 3 tables (migration_plans, plan_operations, migration_snapshots) via separate init function (ref: DL-004).
// Exports MIGRATION_SCHEMA_DDL constant for use by test helpers.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const MIGRATION_SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS migration_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_org TEXT,
    target_org TEXT NOT NULL,
    source_db_path TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS plan_operations (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    parameters TEXT,
    status TEXT DEFAULT 'pending',
    execution_order INTEGER,
    source_type TEXT,
    source_json TEXT,
    error_message TEXT,
    executed_at TEXT,
    FOREIGN KEY (plan_id) REFERENCES migration_plans(id)
  );

  CREATE TABLE IF NOT EXISTS migration_snapshots (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    org_username TEXT NOT NULL,
    snapshot_data BLOB,
    captured_at TEXT,
    FOREIGN KEY (plan_id) REFERENCES migration_plans(id)
  );

  CREATE INDEX IF NOT EXISTS idx_plan_operations_plan_id
    ON plan_operations(plan_id);
`;

/**
 * Initializes migration schema tables (migration_plans, plan_operations, migration_snapshots).
 * Follows initDatabase pattern from database.js with CREATE IF NOT EXISTS for idempotency (ref: DL-004).
 * @param {string} dbPath - Path to database file
 * @returns {Promise<string>} Database path
 */
export async function initMigrationSchema(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  db.exec(MIGRATION_SCHEMA_DDL);

  db.close();
  return dbPath;
}
