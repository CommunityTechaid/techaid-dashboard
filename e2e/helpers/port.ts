/**
 * E2E_PORT support: make the saved storageState follow the dev-server port.
 *
 * save-token.mjs and the CI fake-token step write `e2e/.auth/user.json` for
 * http://localhost:4200. A run on another port (E2E_PORT=4315, e.g. a parallel worktree)
 * would then present a cache whose origin never matches, and the Auth0 SDK reports
 * "Callback URL mismatch" / bounces to login. Rather than asking everyone to rewrite that file
 * (and remember to revert it), playwright.config.ts calls resolveLocalStorageState() at load:
 * it writes a *derived* copy with the origin rewritten and points the chromium project at that.
 * The original file is never modified, so one saved token serves every port.
 *
 * The derived copy lives under the OS temp dir (not test-results/, which Playwright wipes at
 * the start of a run, and not the repo, so nothing can be committed by accident).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const SOURCE = 'e2e/.auth/user.json';

export function resolveLocalStorageState(port: number): string {
  const source = resolve(process.cwd(), SOURCE);
  // No token saved: hand back the original path so Playwright reports the usual missing-file error.
  if (!existsSync(source)) return SOURCE;

  const state = JSON.parse(readFileSync(source, 'utf8'));
  const origin = `http://localhost:${port}`;
  for (const o of state.origins ?? []) {
    if (/^http:\/\/localhost:\d+$/.test(o.origin)) o.origin = origin;
  }

  // Keyed on the checkout so two worktrees on the same port do not share a file.
  const key = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8);
  const dir = join(tmpdir(), 'techaid-e2e-auth');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `user-${key}-${port}.json`);
  writeFileSync(out, JSON.stringify(state));
  return out;
}
