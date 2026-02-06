import os from 'node:os';
import path from 'node:path';
import { ConfigAggregator, StateAggregator, SfProject } from '@salesforce/core';

/**
 * Resolve an org-aware default database path.
 *
 * Resolution order:
 *   1. If orgFlag is provided, resolve it to a username and return ~/.permafrost/<username>/permissions.db
 *   2. Else, if inside an SFDX project with target-org configured, use that
 *   3. Otherwise return null (caller falls back to ./permissions.db)
 *
 * @param {string|undefined} orgFlag - Value of --org flag, if provided
 * @returns {Promise<{dbPath: string, username: string}|null>}
 */
export async function resolveDbPath(orgFlag) {
  const stateAggregator = await StateAggregator.getInstance();

  if (orgFlag) {
    const username = stateAggregator.aliases.resolveUsername(orgFlag);
    return { dbPath: path.join(os.homedir(), '.permafrost', username, 'permissions.db'), username };
  }

  try {
    SfProject.resolveProjectPathSync();
    const config = await ConfigAggregator.create();
    const targetOrg = config.getPropertyValue('target-org');
    if (targetOrg) {
      const username = stateAggregator.aliases.resolveUsername(targetOrg);
      return { dbPath: path.join(os.homedir(), '.permafrost', username, 'permissions.db'), username };
    }
  } catch {
    // Not inside an SFDX project — fall through
  }

  return null;
}
