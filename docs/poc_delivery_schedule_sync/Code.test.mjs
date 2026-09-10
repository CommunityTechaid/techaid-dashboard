/**
 * Regression tests for the date handling in Code.gs (the Delivery Schedule Apps Script).
 *
 * Why this file exists
 * --------------------
 * The driver's sheet showed request 6815 a day early — twice. The first fix corrected which
 * calendar day was *computed* (UTC vs Europe/London); the day was then thrown away again by
 * how it was *written* to the sheet. Neither half was covered by anything, and Code.gs is
 * outside the Angular app so Playwright cannot reach it. These tests pin both halves.
 *
 * Run with:  npm run test:delivery-script
 *
 * How the sheet pipeline is modelled
 * ----------------------------------
 * A JS Date is an instant, not a calendar day. Two different timezones decide what day the
 * driver ends up reading:
 *
 *   - the APPS SCRIPT project timezone, which is what a local `new Date(...)` resolves
 *     against. In process here that is the Node timezone, so these tests re-run themselves
 *     under several values of TZ (see the child-process block at the bottom). The fix
 *     anchors at midday UTC precisely so this one stops mattering — the re-runs prove it.
 *   - the SPREADSHEET timezone, which `setValues` uses to turn the instant into a serial
 *     number. Modelled by `renderInSheetTz`, formatting the instant in that zone, and swept
 *     over SHEET_TIMEZONES below.
 *
 * The two are configured in different dialogs and nothing keeps them in step, so the tests
 * assert the day survives the whole matrix rather than assuming the zones match.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE_GS = join(HERE, 'Code.gs');

/**
 * Loads Code.gs and returns its top-level functions.
 *
 * Code.gs is plain ES5 written for the Apps Script runtime, so it evaluates fine once the
 * handful of Google globals it touches at *load* time exist. Nothing here calls the network
 * or the sheet — only the pure date helpers are exercised.
 */
function loadCodeGs() {
  const source = readFileSync(CODE_GS, 'utf8');

  // Faithful stand-in for the one Utilities method Code.gs uses. Apps Script's
  // formatDate(date, tz, 'yyyy-MM-dd') renders the instant in tz; Intl does the same job.
  const Utilities = {
    formatDate(date, timeZone, format) {
      assert.equal(format, 'yyyy-MM-dd', 'stub only implements the one format Code.gs asks for');
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const get = (type) => parts.find((p) => p.type === type).value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    },
  };

  // Unused by the code paths under test, but referenced at load time.
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => {
      throw new Error('not used in these tests');
    },
    getUi: () => {
      throw new Error('not used in these tests');
    },
  };
  const UrlFetchApp = {
    fetch: () => {
      throw new Error('these tests must not hit the network');
    },
  };

  const exported = {};
  const factory = new Function(
    'Utilities',
    'SpreadsheetApp',
    'UrlFetchApp',
    'exported',
    `${source}
    exported.sheetDate_ = sheetDate_;
    exported.isoDate_ = isoDate_;
    exported.rowFromRequest_ = rowFromRequest_;
    exported.buildRows_ = buildRows_;
    exported.SCRIPT_VERSION = SCRIPT_VERSION;`,
  );
  factory(Utilities, SpreadsheetApp, UrlFetchApp, exported);
  return exported;
}

const code = loadCodeGs();

/** What the driver reads: the instant rendered in the spreadsheet's timezone. */
function renderInSheetTz(value, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

/**
 * Every zone the sheet might plausibly be set to: ones behind London (where the old
 * midnight anchor lost a day) as well as ahead of it.
 *
 * The midday-UTC anchor gives 12 hours of slack, so this list deliberately spans UTC-8 to
 * UTC+11 — Los Angeles through Sydney. Zones at UTC+13/+14 (Pacific/Auckland in its summer,
 * Pacific/Kiritimati) are outside that envelope and are NOT claimed to work; no fixed anchor
 * can cover them without reading the spreadsheet's own timezone. That is a deliberate
 * trade-off for a London charity's driver sheet, not an oversight — if this sheet ever moves
 * to New Zealand, thread `ss.getSpreadsheetTimeZone()` into sheetDate_ instead.
 */
const SHEET_TIMEZONES = [
  'Europe/London',
  'UTC',
  'Etc/GMT',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Australia/Sydney',
];

test('isoDate_ reads the London calendar day, not the UTC one', () => {
  // Midnight on 17 Sep London is 23:00Z on the 16th, because September is BST.
  assert.equal(code.isoDate_(new Date('2026-09-16T23:00:00Z')), '2026-09-17');
  // Exact UTC midnight is unambiguous and must not move.
  assert.equal(code.isoDate_(new Date('2026-09-17T00:00:00Z')), '2026-09-17');
  // In winter London is GMT, so 23:00Z genuinely is still the previous day.
  assert.equal(code.isoDate_(new Date('2026-01-13T23:00:00Z')), '2026-01-13');
  assert.equal(code.isoDate_(new Date('2026-01-14T00:00:00Z')), '2026-01-14');
});

test('sheetDate_ anchors at midday UTC, independent of the script timezone', () => {
  const d = code.sheetDate_('2026-09-17');
  // Asserted in UTC, not local: the point of the fix is that the instant does not depend on
  // the Apps Script project timezone at all. Reading it back with getDate()/getHours() would
  // pass for a midnight-local anchor too, which is exactly the bug.
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 8); // zero-based September
  assert.equal(d.getUTCDate(), 17);
  assert.equal(d.getUTCHours(), 12, 'must be midday-anchored, not midnight-anchored');
  assert.equal(d.toISOString(), '2026-09-17T12:00:00.000Z');
});

test('sheetDate_ returns an empty cell for missing or malformed dates', () => {
  assert.equal(code.sheetDate_(''), '');
  assert.equal(code.sheetDate_(null), '');
  assert.equal(code.sheetDate_(undefined), '');
  // 'not-a-date' splits into three parts, so a length check alone let it through and wrote
  // an Invalid Date into the sheet, which Sheets renders as "NaN".
  assert.equal(code.sheetDate_('not-a-date'), '');
  assert.equal(code.sheetDate_('2026-09'), '');
  assert.equal(code.sheetDate_('2026-13-01'), '', 'month out of range');
  assert.equal(code.sheetDate_('2026-09-32'), '', 'day out of range');
  assert.equal(code.sheetDate_('26-09-17'), '', 'two-digit year is not the expected shape');
  // Nothing returned here may ever be an Invalid Date.
  for (const bad of ['', null, undefined, 'not-a-date', '2026-09', '2026-13-01', '2026-09-32']) {
    const out = code.sheetDate_(bad);
    assert.ok(!(out instanceof Date) || !Number.isNaN(out.getTime()), `Invalid Date for ${bad}`);
  }
});

test('sheetDate_ renders the same day in every plausible spreadsheet timezone', () => {
  for (const ymd of ['2026-09-17', '2026-01-14', '2026-03-29', '2026-10-25', '2026-12-31']) {
    const [y, m, d] = ymd.split('-');
    const expected = `${d}/${m}/${y}`;
    for (const tz of SHEET_TIMEZONES) {
      assert.equal(
        renderInSheetTz(code.sheetDate_(ymd), tz),
        expected,
        `${ymd} shifted when the sheet timezone is ${tz}`,
      );
    }
  }
});

test('request 6815: a BST-evening Instant reaches the driver as the London day', () => {
  // The exact shape reported broken: booked 17/09/2026, stored as the preceding 23:00Z.
  const row = code.rowFromRequest_({
    id: 6815,
    collectionDate: '2026-09-16T23:00:00Z',
    collectionContactName: 'Androulla Charalambous',
    referringOrganisationContact: {
      fullName: 'Androulla Charalambous',
      phoneNumber: '+447000000000',
      referringOrganisation: { name: 'Community TechAid (CTA)' },
    },
  });
  assert.equal(row[1], 6815, 'Req No. column');
  for (const tz of SHEET_TIMEZONES) {
    assert.equal(
      renderInSheetTz(row[0], tz),
      '17/09/2026',
      `request 6815 showed the wrong day with the sheet in ${tz}`,
    );
  }
});

test('bookings use the same anchoring as requests', () => {
  // A booking's `date` is already a plain calendar day from the API, so only the write side
  // can break it — which it did, identically, before sheetDate_.
  const [row] = code.buildRows_(
    [{ date: '2026-09-17', ctaReference: 6815, firstName: 'A', surname: 'B', phone: '', address: '', accessNotes: '' }],
    {},
  );
  for (const tz of SHEET_TIMEZONES) {
    assert.equal(renderInSheetTz(row[0], tz), '17/09/2026', `booking shifted with the sheet in ${tz}`);
  }
});

test('SCRIPT_VERSION is present and looks like a date', () => {
  // The sheet holds a hand-pasted copy of Code.gs, so this stamp is the only way to tell
  // whether a fix has actually reached the driver. Losing it hides the next stale-copy bug.
  assert.match(code.SCRIPT_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

// The assertions above only prove the day is stable for ONE Apps Script project timezone —
// whichever this process happens to run in. Re-run the whole file under several, so a
// regression that only shows up when the two zones disagree cannot hide.
if (!process.env.DELIVERY_SCRIPT_TZ_CHILD) {
  for (const scriptTz of ['Europe/London', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
    test(`whole suite passes with the Apps Script project timezone set to ${scriptTz}`, () => {
      execFileSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], {
        env: { ...process.env, TZ: scriptTz, DELIVERY_SCRIPT_TZ_CHILD: '1' },
        stdio: 'pipe',
      });
    });
  }
}
