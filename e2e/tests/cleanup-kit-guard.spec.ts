/**
 * Guard for e2e/cleanup-residue.mjs: deleteDeviceRequest cascades to the request's kits, so a
 * sample request with a NON-sample kit attached must be skipped (and so must the referee contact
 * and organisation it points at). Runs the real script as a child process with fetch stubbed by
 * cleanup-fetch-stub.mjs, so nothing touches UAT. No browser.
 *
 * @mocked
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';

const script = resolve(__dirname, '../cleanup-residue.mjs');
const stub = resolve(__dirname, 'cleanup-fetch-stub.mjs');

function run(fixture: object, ...args: string[]): { out: string; muts: string[] } {
  const cwd = mkdtempSync(join(tmpdir(), 'cleanup-guard-'));
  mkdirSync(join(cwd, 'e2e/.auth'), { recursive: true });
  const value = JSON.stringify({ body: { access_token: 'fake' } });
  writeFileSync(
    join(cwd, 'e2e/.auth/user.json'),
    JSON.stringify({ origins: [{ localStorage: [{ name: '@@auth0spajs@@::x', value }] }] }),
  );
  const out = execFileSync(process.execPath, ['--import', pathToFileURL(stub).href, script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLEANUP_FIXTURE: JSON.stringify(fixture) },
  });
  return { out, muts: out.split('\n').filter(l => l.startsWith('MUT ')).map(l => l.slice(4)) };
}

const contact = { id: '10', fullName: 'Contact E2E Sample', referringOrganisation: { id: '20' } };
const baseline = {
  contacts: [{ id: '10', fullName: 'Contact E2E Sample' }],
  organisations: [{ id: '20', name: 'Org E2E Sample' }],
};
const sampleKit = { id: '1', model: 'Kit E2E Sample 1' };
const realKit = { id: '2', model: 'Dell Latitude' };

test.describe('e2e cleanup kit guard @mocked', () => {
  test('a sample request with a non-sample kit is skipped, reported, and nothing it needs is deleted', () => {
    const fx = { ...baseline, kits: [sampleKit], requests: [{ id: '5', clientRef: 'E2E Sample ref', kits: [sampleKit, realKit], referringOrganisationContact: contact }] };
    const { out, muts } = run(fx, '--delete');
    expect(muts).not.toContain('deleteDeviceRequest 5');
    expect(out).toMatch(/SKIPPED.*#5/);
    expect(out).toContain('#2');
    expect(out).toMatch(/skipped: 1 device request\(s\)/);
    // the referee contact and organisation it still points at are left alone, and nothing errors
    expect(muts).not.toContain('deleteReferringOrganisationContact 10');
    expect(muts).not.toContain('deleteReferringOrganisation 20');
    expect(out).not.toContain('FAILED');
  });

  test('dry run reports the skip too and deletes nothing', () => {
    const fx = { ...baseline, requests: [{ id: '5', clientRef: 'E2E Sample ref', kits: [realKit], referringOrganisationContact: contact }] };
    const { out, muts } = run(fx);
    expect(muts).toEqual([]);
    expect(out).toMatch(/SKIPPED.*#5/);
    expect(out).not.toMatch(/would delete #5/);
    expect(out).toMatch(/skipped: 1 device request\(s\)/);
  });

  test('a sample request with only sample kits, or none, is still deleted along with its referees', () => {
    const fx = {
      ...baseline,
      requests: [
        { id: '5', clientRef: 'E2E Sample a', kits: [sampleKit], referringOrganisationContact: contact },
        { id: '6', clientRef: 'E2E Sample b', kits: null, referringOrganisationContact: contact },
      ],
    };
    const { out, muts } = run(fx, '--delete');
    expect(muts).toEqual([
      'deleteDeviceRequest 5',
      'deleteDeviceRequest 6',
      'deleteReferringOrganisationContact 10',
      'deleteReferringOrganisation 20',
    ]);
    expect(out).toMatch(/skipped: 0 device request\(s\)/);
  });
});
