/**
 * Guard for the delete order in e2e/cleanup-residue.mjs.
 *
 * A referee contact that still has a device request cannot be deleted (foreign key from
 * device_requests), and neither can its organisation, so the request must go first or
 * `npm run e2e:cleanup -- --delete` needs two passes. No browser.
 *
 * @mocked
 */
import { test, expect } from '@playwright/test';
// @ts-ignore - plain ESM script module with no type declarations
import { DELETE_ORDER, inDeleteOrder } from '../cleanup-order.mjs';

const idx = (kind: string) => (DELETE_ORDER as string[]).indexOf(kind);

test.describe('e2e cleanup delete order @mocked', () => {
  test('device requests go before the referee contacts and organisations they point at', () => {
    expect(idx('deviceRequest')).toBeGreaterThanOrEqual(0);
    expect(idx('deviceRequest')).toBeLessThan(idx('referringOrganisationContact'));
    expect(idx('referringOrganisationContact')).toBeLessThan(idx('referringOrganisation'));
  });

  test('device requests go after kits, which are deleted explicitly before their request cascades', () => {
    expect(idx('kit')).toBeLessThan(idx('deviceRequest'));
  });

  test('inDeleteOrder sorts descriptors and rejects a missing one', () => {
    const shuffled = [...DELETE_ORDER].reverse().map(kind => ({ kind }));
    expect(inDeleteOrder(shuffled).map((e: { kind: string }) => e.kind)).toEqual(DELETE_ORDER);
    expect(() => inDeleteOrder([{ kind: 'donor' }])).toThrow(/no entity descriptor/);
  });
});
