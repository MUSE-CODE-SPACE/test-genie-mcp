// Intentionally broken: TOCTOU race between existsSync + readFileSync.
import * as fs from 'fs';

export function readConfigOrDefault(p: string): string {
  if (fs.existsSync(p)) {
    // BAD: another process can swap the file between these two calls.
    return fs.readFileSync(p, 'utf-8');
  }
  return '{}';
}
