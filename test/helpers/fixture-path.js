import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

export function fixturePath(...segments) {
  return path.join(FIXTURES_DIR, ...segments);
}
