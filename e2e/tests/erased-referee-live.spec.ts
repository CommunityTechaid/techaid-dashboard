/**
 * Live-UAT check that GDPR-erased referee contacts can only be archived / un-archived, and that a
 * live referee's Email is required (dashboard #383 + techaid-server #372).
 *
 * Uses the erased contacts that already exist in UAT (fullName is exactly the server's erasure
 * marker, email blank); it never creates one. Per erased contact:
 *   1. the detail page loads and shows no required-field error (#383 exemption);
 *   2. archive / un-archive from the UI succeeds and survives a reload;
 *   3. any other edit (phone number) is refused by the server (REFEREE_ERASED, #372), the refusal
 *      shows as an error toast with an "Ref: XXXXXXXX" reference, and the record is unchanged after
 *      a reload.
 * Plus: a live (non-erased) referee with its Email emptied cannot be saved: Save sends no mutation
 * and flags the field. That is client-side and writes nothing.
 *
 * Write policy: the only UAT writes are archive toggles on erased contacts and refused edits. The
 * original archived state of every contact is restored in afterAll (through the API, whatever the
 * test did). Nothing is created or deleted.
 *
 * Self-skips when the saved token is missing / fake / expired, or UAT holds no erased contact.
 * Not tagged @mocked.
 *
 * Run: npx playwright test --config playwright.config.uat.ts erased-referee-live
 */
import { test, expect, request as playwrightRequest, Page } from '@playwright/test';
import { resolve } from 'path';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';

const ERASED_NAME = 'Contact - Erased due to GDPR policy';
// The same storage state the UAT config logs the browser in with.
const STATE = resolve(process.cwd(), 'e2e/.auth/uat-deployed.json');

function tokenProblem(): string | null {
  let token: string;
  try {
    token = getBearerToken(STATE);
  } catch {
    return 'No token saved in e2e/.auth/uat-deployed.json';
  }
  const [, payload, signature] = token.split('.');
  if (signature === 'ci_fake_signature') return 'CI fake token: real UAT access not possible';
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp * 1000 < Date.now()) return 'UAT bearer token expired: run e2e/save-token.mjs with a fresh one';
  } catch {
    return 'Token is not a decodable JWT';
  }
  return null;
}

interface Contact {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  address: string | null;
  archived: boolean;
  referringOrganisation: { id: string } | null;
}

const FIELDS = 'id fullName email phoneNumber address archived referringOrganisation { id }';
const FIND = `query($w: ReferringOrganisationContactWhereInput){
  referringOrganisationContactsConnection(where: $w, page: { size: 50 }) { content { ${FIELDS} } }
}`;
const GET = `query($id: Long){ referringOrganisationContact(where: { id: { _eq: $id } }) { ${FIELDS} } }`;
const UPDATE = `mutation($data: UpdateReferringOrganisationContactInput!){
  updateReferringOrganisationContact(data: $data) { id archived }
}`;

const problem = tokenProblem();
test.skip(!!problem, problem ?? '');

let uat: UatGraphQLClient;
let erased: Contact[] = [];
let live: Contact | null = null;
/** archived state at the start of the run, by id, restored in afterAll */
const original = new Map<string, boolean>();

async function fetchContact(id: string): Promise<Contact> {
  const d = await uat.request<{ referringOrganisationContact: Contact }>(GET, { id });
  return d.referringOrganisationContact;
}

async function setArchivedViaApi(c: Contact, archived: boolean): Promise<void> {
  // The same shape the dashboard form sends: stored values echoed back, only `archived` differs.
  await uat.request(UPDATE, {
    data: {
      id: c.id,
      fullName: c.fullName,
      email: c.email ?? '',
      phoneNumber: c.phoneNumber ?? '',
      address: c.address ?? '',
      referringOrganisationId: c.referringOrganisation?.id,
      archived,
      note: { content: '' },
    },
  });
}

test.beforeAll(async () => {
  if (problem) return;
  uat = await UatGraphQLClient.create(getBearerToken(STATE));
  const e = await uat.request<{ referringOrganisationContactsConnection: { content: Contact[] } }>(FIND, {
    w: { fullName: { _eq: ERASED_NAME } },
  });
  erased = e.referringOrganisationContactsConnection.content
    .filter(c => c.fullName === ERASED_NAME && !c.email)
    .slice(0, 3);
  for (const c of erased) original.set(c.id, c.archived);
  // A live referee, used only for the read-only "blank email cannot be saved" check.
  const l = await uat.request<{ referringOrganisationContactsConnection: { content: Contact[] } }>(FIND, {
    w: { archived: { _eq: false }, email: { _neq: '' } },
  });
  live = l.referringOrganisationContactsConnection.content.find(c => c.fullName !== ERASED_NAME && !!c.email) ?? null;
});

test.afterAll(async () => {
  if (!uat) return;
  try {
    for (const [id, archived] of original) {
      const now = await fetchContact(id);
      if (now.archived !== archived) await setArchivedViaApi(now, archived);
      expect((await fetchContact(id)).archived, `contact ${id} restored`).toBe(archived);
    }
  } finally {
    await uat.dispose();
  }
});

async function openContact(page: Page, id: string): Promise<void> {
  await page.goto(`/dashboard/referring-organisation-contacts/${id}`);
  await expect(page.locator('[data-testid="contact-save"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('input[type="email"]')).toBeVisible();
}

const archivedRadio = (page: Page, archived: boolean) =>
  page.getByLabel(archived ? 'Archive and hide this referee' : 'Referee active and visible');

test.describe.configure({ mode: 'serial' });

test.describe('erased referee contacts (live UAT)', () => {
  test('UAT holds at least one erased contact', () => {
    expect(erased.length, 'no GDPR-erased referee in UAT to test against').toBeGreaterThan(0);
    test.info().annotations.push({
      type: 'erased ids (archived at start)',
      description: erased.map(c => `${c.id}:${c.archived}`).join(', '),
    });
  });

  for (const index of [0, 1, 2]) {
    test(`erased contact #${index + 1}: archive toggles from the UI and persists; other edits are refused`, async ({ page }) => {
      test.setTimeout(150_000);
      test.skip(!erased[index], `UAT has only ${erased.length} erased contact(s)`);
      const c = erased[index];
      const startArchived = original.get(c.id)!;

      // 1. Loads; the #383 exemption means no required-field message on the blank email / address.
      await openContact(page, c.id);
      await expect(page.getByLabel('Full Name').first()).toHaveValue(ERASED_NAME);
      await expect(page.locator('input[type="email"]')).toHaveValue('');
      await expect(archivedRadio(page, startArchived)).toBeChecked();

      // 2. Toggle archived from the UI, save, expect success and a persisted change.
      const mutations: string[] = [];
      page.on('request', r => {
        if (r.url().endsWith('/graphql') && (r.postData() ?? '').includes('mutation updateReferringOrganisation')) {
          mutations.push(r.postData()!);
        }
      });
      await archivedRadio(page, !startArchived).check();
      await page.locator('[data-testid="contact-save"]').click();
      await expect(page.locator('.toast-info', { hasText: 'Successfully updated referee' })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.invalid-feedback')).toHaveCount(0);
      expect(mutations, 'exactly one mutation, with blank email').toHaveLength(1);
      expect(JSON.parse(mutations[0]).variables.data.email).toBe('');
      expect((await fetchContact(c.id)).archived, 'server state after UI toggle').toBe(!startArchived);

      await page.reload();
      await expect(page.locator('[data-testid="contact-save"]')).toBeVisible({ timeout: 45_000 });
      await expect(archivedRadio(page, !startArchived)).toBeChecked();

      // Back again from the UI (un-archive or re-archive), also persisted.
      await archivedRadio(page, startArchived).check();
      await page.locator('[data-testid="contact-save"]').click();
      await expect(page.locator('.toast-info', { hasText: 'Successfully updated referee' }).last()).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await fetchContact(c.id)).archived, { timeout: 15_000 }).toBe(startArchived);

      // 3. Any other edit is refused by the server and shown as a toast with a ref.
      await page.reload();
      await expect(page.locator('[data-testid="contact-save"]')).toBeVisible({ timeout: 45_000 });
      await page.getByLabel('Phone Number').fill('07700900123');
      const before = mutations.length;
      await page.locator('[data-testid="contact-save"]').click();
      const toast = page.locator('.toast-error');
      await expect(toast.first()).toBeVisible({ timeout: 30_000 });
      const text = (await toast.first().innerText()).replace(/\s+/g, ' ');
      test.info().annotations.push({ type: `refusal toast #${c.id}`, description: text });
      expect(text).toMatch(/Ref: [A-Z0-9]{8}/);
      expect(text).toMatch(/erased|GDPR|archived/i);
      expect(mutations.length, 'the refused edit was actually sent to the server').toBe(before + 1);
      await expect(page.locator('.toast-info', { hasText: 'Successfully updated referee' })).toHaveCount(0);

      // Record unchanged after a reload (UI and server).
      await page.reload();
      await expect(page.locator('[data-testid="contact-save"]')).toBeVisible({ timeout: 45_000 });
      await expect(page.getByLabel('Phone Number')).toHaveValue('');
      await expect(archivedRadio(page, startArchived)).toBeChecked();
      const after = await fetchContact(c.id);
      expect(after.phoneNumber ?? '').toBe('');
      expect(after.fullName).toBe(ERASED_NAME);
      expect(after.email ?? '').toBe('');
      expect(after.archived).toBe(startArchived);
    });
  }

  test('a live referee with an emptied Email cannot be saved (writes nothing)', async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(!live, 'UAT has no non-erased, non-archived referee with an email to open');
    await openContact(page, live!.id);
    const mutations: string[] = [];
    page.on('request', r => {
      if (r.url().endsWith('/graphql') && (r.postData() ?? '').includes('mutation updateReferringOrganisation')) {
        mutations.push(r.postData()!);
      }
    });
    const email = page.locator('input[type="email"]');
    await expect(email).toHaveValue(live!.email);
    await email.fill('');
    await page.locator('[data-testid="contact-save"]').click();
    await page.waitForTimeout(2000);
    expect(mutations, 'no mutation may be sent with a blank email').toHaveLength(0);
    await expect(email).toHaveClass(/is-invalid/);
    await expect(page.locator('.invalid-feedback', { hasText: 'This field is required' }).first()).toBeVisible();
    // Nothing was written: the stored email is untouched.
    expect((await fetchContact(live!.id)).email).toBe(live!.email);
  });
});

// Keep the unused import honest if the helper changes.
void playwrightRequest;
