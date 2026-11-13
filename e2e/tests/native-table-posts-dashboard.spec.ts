/**
 * Native tables (#113, milestone 4) — post-index and the dashboard's status table.
 *
 * post-index is a plain server-side table (simple_numbers pager, order on Updated). The dashboard
 * page is the one client-side table: the status counts are rows Angular already holds, five per
 * page, search box and header sort, no length menu, no saved state. It used to share its table id
 * with donor-index; it is `status-count` now, and the embedded post-index keeps its own id
 * (`post-index-dashboard`, 5 per page).
 *
 * The dashboard host is OnPush with signals, so every assertion here is also a check that the
 * page repaints without zone.js: rows only exist once the findAll promise resolves.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars { page?: { sort: { key: string; value: string }[]; size: number; page: number }; term?: string }

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const POSTS = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1, slug: `post-${String(i + 1).padStart(2, '0')}`, title: `Post title ${String(i + 1).padStart(2, '0')}`, published: i % 2 === 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: `2026-02-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
}));

const STATUS = [
  ['DONATION_NEW', 40], ['PROCESSING_START', 3], ['PROCESSING_WIPED', 17], ['PROCESSING_OS_INSTALLED', 9],
  ['ALLOCATION_READY', 120], ['ALLOCATION_QC_COMPLETED', 5], ['ALLOCATION_DELIVERY_ARRANGED', 8],
  ['DISTRIBUTION_DELIVERED', 300], ['DISTRIBUTION_RECYCLED', 2], ['DISTRIBUTION_REPAIR_RETURN', 11],
  ['PROCESSING_STORED', 25], ['LEGACY_STATUS', 1],
].map(([status, count]) => ({ status, count }));

interface State { posts: Vars[]; created: unknown[]; findAll: number }

async function installMocks(page: Page): Promise<State> {
  const st: State = { posts: [], created: [], findAll: 0 };
  let extra: typeof POSTS = [];
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    const v: Vars = body.variables ?? {};
    const op = /(?:query|mutation)\s+(\w+)/.exec(body.query ?? '')?.[1] ?? '';
    if (op === 'findAllPosts') {
      st.posts.push(v);
      const term = (v.term ?? '').toLowerCase();
      const rows = [...POSTS, ...extra].filter(p => p.slug.includes(term) || p.title.toLowerCase().includes(term));
      const key = (v.page!.sort[0]?.key ?? 'updatedAt') as 'slug' | 'updatedAt';
      const dir = v.page!.sort[0]?.value === 'desc' ? -1 : 1;
      rows.sort((a, b) => dir * String(a[key]).localeCompare(String(b[key])));
      return fulfill(route, { postsConnection: { totalElements: rows.length, content: rows.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size) } });
    }
    if (op === 'createPost') {
      st.created.push((v as any).data);
      extra = [...extra, { id: 99, slug: (v as any).data.slug, title: (v as any).data.title, published: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2027-01-01T00:00:00Z' }];
      return fulfill(route, { createPost: extra.at(-1) });
    }
    if (op === 'findAll') {
      st.findAll++;
      return fulfill(route, {
        kits: { totalElements: 1234 }, donors: { totalElements: 56 },
        typeCount: [{ type: 'LAPTOP', count: 10 }],
        statusCount: STATUS,
        requestCount: { LAPTOP: 4, TABLET: 0, OTHER: 0, SMARTPHONE: 0, ALLINONE: 0, DESKTOP: 0, COMMSDEVICE: 0, BROADBANDHUB: 0 },
      });
    }
    return fulfill(route, {});
  });
  return st;
}

test.describe('native tables: post-index and dashboard @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-cleared')) {
          sessionStorage.setItem('cta-test-cleared', '1');
          Object.keys(localStorage).filter(k => k.startsWith('cta-table_')).forEach(k => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
    });
  });

  test('post-index: order, simple pager, sort cycle, search, create reloads and keeps the page', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/posts');
    const W = '#post-index_wrapper';
    const rows = page.locator('#post-index tbody tr');
    await expect(rows).toHaveCount(10);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    // simple_numbers: no first/last buttons
    await expect(page.locator(`${W} .dt-paging button.page-link.first`)).toHaveCount(0);
    await expect(page.locator(`${W} .dt-paging button.page-link.next`)).toHaveCount(1);
    expect(st.posts[0].page).toEqual({ sort: [{ key: 'updatedAt', value: 'desc' }], size: 10, page: 0 });
    await expect(rows.first()).toContainText('Post title 23');
    await expect(rows.first().locator('.text-bg-success, .text-bg-warning')).toHaveCount(1);

    const postTh = page.locator('#post-index thead th').nth(1);
    await postTh.click();
    await expect(postTh).toHaveAttribute('aria-sort', 'ascending');
    expect(st.posts.at(-1)!.page!.sort).toEqual([{ key: 'slug', value: 'asc' }]);
    await postTh.click();
    await expect(postTh).toHaveAttribute('aria-sort', 'descending');
    // The info column header and the actions column are inert.
    await expect(page.locator('#post-index thead th').nth(0)).not.toHaveAttribute('aria-sort', /.+/);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');

    // Creating a post reloads the table on the page the user is on.
    await page.locator('a', { hasText: 'Create Post' }).click();
    const inputs = page.locator('.modal-body input[type=text], .modal-body input:not([type])');
    await inputs.nth(0).fill('Brand new');
    await inputs.nth(1).fill('brand-new');
    const before = st.posts.length;
    await page.locator('.modal-footer .btn-primary').click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 24 entries');
    expect(st.posts.length).toBeGreaterThan(before);
    expect(st.created).toHaveLength(1);

    const box = page.locator(`${W} .dt-search input`);
    await box.fill('brand');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entry (filtered from 24 total entries)');
    expect(st.posts.at(-1)!.term).toBe('brand');
  });

  test('dashboard: client-side status table (5 per page, search, sort, no length menu, no saved state)', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/');
    const W = '#status-count_wrapper';
    const rows = page.locator('#status-count tbody tr');
    // Rows exist only after findAll resolved: the OnPush host repainted from its signal.
    await expect(rows).toHaveCount(5);
    expect(st.findAll).toBe(1);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 5 of 12 entries');
    await expect(page.locator(`${W} .dt-length`)).toHaveCount(0);
    await expect(page.locator('#donor-index')).toHaveCount(0);

    // Default order: Status ascending by its label.
    const labels = async () => (await rows.locator('td:first-child').allTextContents()).map(t => t.trim());
    await expect(page.locator('#status-count thead th').first()).toHaveAttribute('aria-sort', 'ascending');
    expect(await labels()).toEqual(['Assessment check completed', 'Collection/drop off to beneficiary arranged', 'Device in for repair', 'Device received by beneficiary', 'Device received into CTA']);
    await expect(rows.first().locator('td').nth(1)).toHaveText('120');

    // Header click reverses (never clears); Count sorts numerically.
    await page.locator('#status-count thead th').first().click();
    await expect(page.locator('#status-count thead th').first()).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.first().locator('td').first()).toHaveText('Quality check completed');
    await page.locator('#status-count thead th').nth(1).click();
    await expect(rows.first().locator('td').nth(1)).toHaveText('1');
    await page.locator('#status-count thead th').nth(1).click();
    await expect(rows.first().locator('td').nth(1)).toHaveText('300');

    // Paging.
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 10 of 12 entries');
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(rows).toHaveCount(2);

    // Smart search: every word must match, case-insensitively; resets to the first page.
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('DEVICE wiped');
    await box.press('Enter');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Device wiped');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entry (filtered from 12 total entries)');
    // The unknown status falls back to its raw name.
    await box.fill('legacy');
    await box.press('Enter');
    await expect(rows.first()).toContainText('LEGACY_STATUS');
    await box.fill('nope');
    await box.press('Enter');
    await expect(page.locator('#status-count td.no-data-available')).toHaveText('No data!');

    // No saved state for this table (it had no stateSave).
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('cta-table_status-count')));
    expect(keys).toEqual([]);
  });

  test('dashboard: the embedded post-index keeps its own id and 5 per page', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/');
    const W = '#post-index-dashboard_wrapper';
    await expect(page.locator('#post-index-dashboard tbody tr')).toHaveCount(5);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 5 of 23 entries');
    expect(st.posts[0].page).toMatchObject({ size: 5, page: 0 });
    await expect(page.locator('#post-index')).toHaveCount(0);
  });
});
