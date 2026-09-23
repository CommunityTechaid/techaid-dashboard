/**
 * Self-hosted fonts and the FontAwesome subset actually RENDER — not just "the file exists".
 *
 * WHY THIS EXISTS
 *   2.0.0 self-hosted Poppins (#119, Google Fonts dropped from the CSP) and shipped a
 *   FontAwesome 7 subset holding only the glyphs the app uses (#116). Both fail silently:
 *   a blocked or missing font falls back to a system face, and an icon missing from the
 *   subset renders as a blank box. `npm run fa:check` proves the subset covers every class
 *   token in src/; this spec proves the icons the browser is ACTUALLY asked to draw, on real
 *   pages, exist in the font files the server ACTUALLY served.
 *
 *   Run it against the DEPLOYED origin (`--config playwright.config.uat.ts`) after a deploy —
 *   that is the only place the real CSP headers apply, so the violation check is only
 *   meaningful there. Under local `ng serve` it still checks font loading and glyph coverage.
 *
 * HOW THE GLYPH CHECK WORKS
 *   1. In the page: walk every element's ::before/::after, keep those whose font-family is
 *      FontAwesome, and record the content character plus font-weight (900 = solid,
 *      400 = regular).
 *   2. In Node: the FontAwesome woff2 files are captured off the wire as the page loads them
 *      and parsed with fontkit; each recorded character must have a non-empty glyph in the
 *      face matching its weight.
 *   A canvas pixel comparison was tried first and proved useless on Windows: Segoe's icon
 *   fonts cover the same Private Use Area, so a glyph missing from FA still draws something.
 *   The rocket sentinel below is what caught that — keep it.
 */
import { test, expect, Page } from '@playwright/test';
import * as fontkit from 'fontkit';
import { getBearerToken } from '../helpers/graphql';

const FA_FAMILY = 'Font Awesome 7 Free';
/** fa-rocket: a real FA glyph the app never uses, so it must be ABSENT from the subset. */
const SENTINEL_ABSENT = 0xf135;

/** Collects CSP violations from the moment the document starts. */
async function recordCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
      (window as any).__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as any).__csp as string[]);
}

type Face = 'solid' | 'regular';

/** Captures every FontAwesome woff2 the page downloads, keyed by face. */
function captureFaFonts(page: Page): Map<Face, Buffer> {
  const fonts = new Map<Face, Buffer>();
  page.on('response', async res => {
    const m = res.url().match(/fa-(solid|regular)-\d+[^/]*\.woff2/);
    if (!m || !res.ok()) return;
    try { fonts.set(m[1] as Face, await res.body()); } catch { /* navigation raced the body */ }
  });
  return fonts;
}

interface UsedGlyph { codePoint: number; face: Face; where: string; }

/** Every FontAwesome pseudo-element glyph the page is currently asking the browser to draw. */
async function usedGlyphs(page: Page): Promise<UsedGlyph[]> {
  const raw = await page.evaluate(async (family) => {
    await document.fonts.ready;
    const out: { cp: number; weight: string; where: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const pseudo of ['::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (!cs.fontFamily.includes(family)) continue;
        const ch = cs.content.replace(/^["']|["']$/g, '');
        if (!ch || cs.content === 'none' || cs.content === 'normal') continue;
        const cls = (el.getAttribute('class') ?? '').trim().replace(/\s+/g, '.');
        out.push({ cp: ch.codePointAt(0)!, weight: cs.fontWeight, where: `${el.tagName.toLowerCase()}.${cls}${pseudo}` });
      }
    }
    return out;
  }, FA_FAMILY);
  const seen = new Map<string, UsedGlyph>();
  for (const g of raw) {
    const face: Face = Number(g.weight) >= 600 ? 'solid' : 'regular';
    seen.set(`${face}:${g.cp}`, { codePoint: g.cp, face, where: g.where });
  }
  return [...seen.values()];
}

function hasInkedGlyph(font: fontkit.Font, cp: number): boolean {
  if (!font.hasGlyphForCodePoint(cp)) return false;
  const glyph = font.glyphForCodePoint(cp);
  return glyph.id !== 0 && glyph.path.commands.length > 0;
}

function parse(buf: Buffer): fontkit.Font {
  return fontkit.create(buf) as fontkit.Font;
}

/** Asserts every used glyph is in the served subset, and that the check can fail at all. */
async function expectGlyphsCovered(page: Page, fonts: Map<Face, Buffer>, minGlyphs: number): Promise<void> {
  const used = await usedGlyphs(page);
  expect(used.length, 'expected FontAwesome icons on this page').toBeGreaterThanOrEqual(minGlyphs);

  const parsed = new Map<Face, fontkit.Font>();
  for (const face of new Set(used.map(g => g.face))) {
    await expect.poll(() => fonts.has(face), { message: `FontAwesome ${face} woff2 was never downloaded`, timeout: 10_000 }).toBe(true);
    parsed.set(face, parse(fonts.get(face)!));
  }

  const solid = parsed.get('solid');
  expect(solid, 'the solid face carries almost every icon; it must be on the page').toBeTruthy();
  expect(hasInkedGlyph(solid!, SENTINEL_ABSENT), 'sentinel: fa-rocket must NOT be in the subset — if it is, this check proves nothing').toBe(false);

  const missing = used
    .filter(g => !hasInkedGlyph(parsed.get(g.face)!, g.codePoint))
    .map(g => `${g.where} U+${g.codePoint.toString(16)} (${g.face})`);
  expect(missing, 'icons missing from the FontAwesome subset').toEqual([]);
}

async function loadedFamilies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family.replace(/"/g, '')} ${f.weight}`))];
  });
}

test.describe('rendered assets — public pages (anonymous)', () => {
  // Anonymous: no stored Auth0 session, so these see exactly what a member of the public sees.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ['/organisation-device-request', '/delivery-booking']) {
    test(`${path}: Poppins renders, no CSP violations`, async ({ page }) => {
      const violations = await recordCspViolations(page);
      await page.goto(path);
      // Real content, not the "Server is starting up" spinner.
      // (The booking page has no headings — its first step is an input and a Continue button.)
      await expect(
        page.locator('h1, h2, h3, h4, h5').or(page.getByRole('button', { name: /continue/i })).first(),
      ).toBeVisible({ timeout: 30_000 });

      const families = await loadedFamilies(page);
      expect(families.some(f => f.startsWith('Poppins')), `loaded fonts: ${families.join(', ')}`).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/Poppins/);
      expect(await violations(), 'CSP violations').toEqual([]);
    });
  }
});

test.describe('rendered assets — authenticated dashboard', () => {
  test.beforeEach(async ({ page }) => {
    const token = getBearerToken();
    await page.route('**/graphql', async route => {
      if ((route.request().postData() ?? '').includes('buildInfo')) return route.continue().catch(() => {});
      await route.continue({ headers: { ...route.request().headers(), Authorization: `Bearer ${token}` } }).catch(() => {});
    });
  });

  // Chosen for icon coverage: the sidebar and topbar on every page (nav icons, plus the
  // \f104/\f105/\f107 arrows that exist only as CSS escapes in sb-admin.css), DataTables
  // index toolbars (filter / create / scanner / sort), and the dashboard cards.
  for (const path of ['/dashboard', '/dashboard/devices', '/dashboard/device-requests', '/dashboard/distributions-and-deliveries']) {
    test(`${path}: Poppins + every FontAwesome glyph in use renders, no CSP violations`, async ({ page }) => {
      const fonts = captureFaFonts(page);
      const violations = await recordCspViolations(page);
      await page.goto(path);
      await expect(page.locator('#accordionSidebar, .sidebar').first()).toBeVisible({ timeout: 30_000 });
      await page.locator('table.dataTable, .card').first().waitFor({ state: 'visible', timeout: 30_000 });

      const families = await loadedFamilies(page);
      expect(families, 'Poppins must be loaded').toEqual(expect.arrayContaining([expect.stringMatching(/^Poppins/)]));
      expect(families, 'FontAwesome must be loaded').toEqual(expect.arrayContaining([expect.stringContaining(FA_FAMILY)]));

      await expectGlyphsCovered(page, fonts, 5);
      expect(await violations(), 'CSP violations').toEqual([]);
    });
  }
});
