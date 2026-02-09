import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../../src/index.js');

describe('CLI smoke tests', () => {
  it('--version prints version', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, '--version']);
    assert.match(stdout, /0\.1\.0/);
  });

  it('--help lists all top-level commands', async () => {
    try {
      await execFileAsync('node', [CLI_PATH, '--help']);
    } catch (error) {
      const { stdout } = error;
      assert.match(stdout, /parse/);
      assert.match(stdout, /trace/);
      assert.match(stdout, /export/);
      assert.match(stdout, /analyze/);
      assert.match(stdout, /recommend/);
      assert.match(stdout, /report/);
    }
  });

  it('parse --help shows key options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'parse', '--help']);
    assert.match(stdout, /-o, --org/);
    assert.match(stdout, /-d, --db/);
    assert.match(stdout, /-m, --metadata-dir/);
    assert.match(stdout, /--full/);
    assert.match(stdout, /--force/);
  });

  it('trace --help shows required options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'trace', '--help']);
    assert.match(stdout, /-u, --user/);
    assert.match(stdout, /-p, --permission/);
    assert.match(stdout, /--format/);
    assert.match(stdout, /--verbose/);
  });

  it('analyze redundancy --help succeeds', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'analyze', 'redundancy', '--help']);
    assert.match(stdout, /-d, --db/);
    assert.match(stdout, /-O, --org/);
    assert.match(stdout, /-o, --output/);
  });

  it('analyze overlap --help shows threshold option', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'analyze', 'overlap', '--help']);
    assert.match(stdout, /--threshold/);
    assert.match(stdout, /-d, --db/);
    assert.match(stdout, /-o, --output/);
  });

  it('analyze object --help shows object/list options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'analyze', 'object', '--help']);
    assert.match(stdout, /--object/);
    assert.match(stdout, /--list/);
    assert.match(stdout, /-d, --db/);
  });

  it('recommend psg --help shows threshold options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'recommend', 'psg', '--help']);
    assert.match(stdout, /--min-users/);
    assert.match(stdout, /--co-assignment-threshold/);
    assert.match(stdout, /-d, --db/);
    assert.match(stdout, /-o, --output/);
  });

  it('report --help shows format options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'report', '--help']);
    assert.match(stdout, /-f, --format/);
    assert.match(stdout, /html, json, markdown/);
    assert.match(stdout, /--include/);
    assert.match(stdout, /-d, --db/);
  });

  it('export --help shows format options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'export', '--help']);
    assert.match(stdout, /--format/);
    assert.match(stdout, /json, csv/);
    assert.match(stdout, /--include/);
    assert.match(stdout, /-d, --db/);
  });

  it('diff --help shows required options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'diff', '--help']);
    assert.match(stdout, /--source-org/);
    assert.match(stdout, /--target-org/);
    assert.match(stdout, /--output/);
    assert.match(stdout, /--include/);
    assert.match(stdout, /--filter/);
  });

  it('plan --help lists subcommands', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', '--help']);
    assert.match(stdout, /create/);
    assert.match(stdout, /import/);
    assert.match(stdout, /add/);
    assert.match(stdout, /remove/);
    assert.match(stdout, /show/);
    assert.match(stdout, /list/);
  });

  it('plan create --help shows options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', 'create', '--help']);
    assert.match(stdout, /--name/);
    assert.match(stdout, /--target-org/);
  });

  it('plan import --help shows options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', 'import', '--help']);
    assert.match(stdout, /--plan/);
    assert.match(stdout, /--preview/);
  });

  it('plan add --help shows options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', 'add', '--help']);
    assert.match(stdout, /--plan/);
    assert.match(stdout, /--operation/);
    assert.match(stdout, /--entity/);
  });

  it('plan remove --help shows options', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', 'remove', '--help']);
    assert.match(stdout, /--plan/);
    assert.match(stdout, /--operation/);
  });

  it('plan show --help exists', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', 'show', '--help']);
    assert.match(stdout, /Show plan details/);
  });

  it('plan list --help exists', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, 'plan', 'list', '--help']);
    assert.match(stdout, /List all migration plans/);
  });
});
