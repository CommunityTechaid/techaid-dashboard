/**
 * Guard for the default fake login's STAFF permission set (e2e/helpers/staff-permissions.json).
 *
 * The default @mocked session is meant to behave like a fully privileged staff user so that a
 * new permission gate on a button does not break unrelated older specs. That only holds if the
 * set keeps up with the app: when someone gates UI on a brand-new authority, this spec fails
 * until it is added to staff-permissions.json (or deliberately excluded below). No browser.
 *
 * @mocked
 */
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { STAFF_PERMISSIONS } from '../helpers/auth0-cache';

// Authorities the app checks that staff do not (yet) hold. Keep empty unless there is a reason.
const NOT_STAFF: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name) ? [p] : [];
  });
}

test.describe('staff permission set covers the app @mocked', () => {
  test('every authority literal gated on in src/app is in STAFF_PERMISSIONS', () => {
    const found = new Set<string>();
    const re = /['"]((?:read|write|delete):[a-z_]+|app:[a-z]+)['"]/g;
    for (const file of sourceFiles(resolve(process.cwd(), 'src/app'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(re)) found.add(m[1]);
    }
    expect(found.size).toBeGreaterThan(10); // the scan itself works
    const missing = [...found].filter(p => !STAFF_PERMISSIONS.includes(p) && !NOT_STAFF.includes(p));
    expect(missing, 'add to e2e/helpers/staff-permissions.json').toEqual([]);
  });
});
