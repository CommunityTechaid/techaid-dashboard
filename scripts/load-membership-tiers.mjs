#!/usr/bin/env node
/**
 * Loads organisation membership tiers from the "Referral Organisation Membership Request
 * Tracker" sheet (Tier Tracker tab, exported as CSV) into TaDa — UAT first, then production.
 *
 * Dry run by default: it matches every sheet row to an organisation and prints what it WOULD
 * change. Nothing is written without --apply. Production writes additionally need --confirm-prod.
 *
 * Matching is by organisation name, normalised (case, punctuation, "&"/"and", a leading "The").
 * Names that don't match exactly are listed with the closest candidates so you can add them to a
 * --map file, e.g. {"SLaM (South London & Maudsley NHS Trust)": "South London and Maudsley NHS"}
 * or {"Lambeth Libraries": 1234}. Map values are a TaDa organisation name or id; ids differ between
 * UAT and prod, so keep one map per environment. Some organisations exist only in prod, so "not
 * found" on UAT is expected for those.
 *
 * Free rows are skipped by default: FREE is every organisation's default, so loading them changes
 * nothing. Pass --include-free to also set FREE on organisations that currently have a paid tier.
 *
 * Start date: for a paid tier, the sheet's "Date paid" becomes the organisation's membership start
 * date (decision 2026-10-28), so its year runs from the day it paid. A paid row with no date paid,
 * and every Free row, keeps the server default (1 February). --start overrides all of that.
 *
 * Needs techaid-server#311 (PR #313) deployed to the target environment; without it the dry run
 * still matches names but reports that tiers cannot be read or written yet.
 *
 * Usage:
 *   CTA_BEARER_TOKEN=<token> node scripts/load-membership-tiers.mjs --csv "<Tier Tracker.csv>"
 *   CTA_BEARER_TOKEN=<token> node scripts/load-membership-tiers.mjs --csv tiers.csv --map uat-map.json --apply
 *   CTA_BEARER_TOKEN=<token> node scripts/load-membership-tiers.mjs --csv tiers.csv --prod --map prod-map.json
 *   CTA_BEARER_TOKEN=<token> node scripts/load-membership-tiers.mjs --csv tiers.csv --prod --map prod-map.json --apply --confirm-prod
 *   ... --out report.csv   (writes the per-row outcome)
 *
 * The token must belong to someone with write:organisations. Get one by logging into the
 * dashboard for that environment, then DevTools → Application → Local Storage → the Auth0
 * access token.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ENDPOINTS = {
  uat: 'https://api-testing.communitytechaid.org.uk/graphql',
  prod: 'https://api.communitytechaid.org.uk/graphql',
};

const TIERS = { 'free': 'FREE', 'tier 1': 'TIER_1', 'tier 2': 'TIER_2', 'tier 3': 'TIER_3' };

function parseArgs(argv) {
  const args = { env: 'uat', apply: false, confirmProd: false, includeFree: false, csv: null, map: null, start: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prod') args.env = 'prod';
    else if (a === '--uat') args.env = 'uat';
    else if (a === '--apply') args.apply = true;
    else if (a === '--confirm-prod') args.confirmProd = true;
    else if (a === '--include-free') args.includeFree = true;
    else if (a === '--csv') args.csv = argv[++i];
    else if (a === '--map') args.map = argv[++i];
    else if (a === '--start') args.start = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** The sheet rows under the "Organisation" header, as {name, tier, raw}. */
export function readTierRows(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const header = rows.findIndex(r => (r[0] || '').trim().toLowerCase() === 'organisation');
  if (header < 0) throw new Error('No "Organisation" header row found in the CSV');
  const out = [];
  for (const r of rows.slice(header + 1)) {
    const name = (r[0] || '').trim();
    // The legend line ("Free = 0-10 Requests, ...") closes the table.
    if (!name || /^free\s*=/i.test(name)) continue;
    const tierText = (r[1] || '').trim();
    out.push({
      name,
      tierText,
      tier: TIERS[tierText.toLowerCase()] ?? null,
      datePaid: ukDateToIso(r[4]),
      notes: (r[5] || '').trim(),
    });
  }
  return out;
}

/** "18/12/2025" → "2025-12-18"; anything else → null. */
export function ukDateToIso(text) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text || '');
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const check = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function normaliseName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

function tokens(name) {
  return new Set(normaliseName(name).split(' ').filter(t => t.length > 2 && !['and', 'the', 'for', 'ltd', 'cic'].includes(t)));
}

function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

async function gql(env, token, query, variables) {
  const res = await fetch(ENDPOINTS[env], {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 403) {
    throw new Error('HTTP 403 — that is the Cloudflare edge, not the API (see project notes); retry from an allowed network.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.errors) throw new Error(`HTTP ${res.status}`);
  return body;
}

const ORGS_QUERY = (membership) => `
  query LoadTiersOrgs($page: PaginationInput) {
    referringOrganisationsConnection(page: $page, where: {}) {
      totalElements
      content { id name website archived ${membership ? 'membershipTier membershipStartDate' : ''} }
    }
  }`;

async function fetchAllOrgs(env, token) {
  let membership = true;
  const all = [];
  for (let page = 0; ; page++) {
    const vars = { page: { page, size: 200, sort: [{ key: 'id', value: 'asc' }] } };
    let body = await gql(env, token, ORGS_QUERY(membership), vars);
    if (body.errors && membership && JSON.stringify(body.errors).includes('membership')) {
      // Server without #311: still match names, but nothing can be applied.
      membership = false;
      body = await gql(env, token, ORGS_QUERY(false), vars);
    }
    if (body.errors) throw new Error(`Organisation query failed: ${JSON.stringify(body.errors)}`);
    const conn = body.data.referringOrganisationsConnection;
    all.push(...conn.content);
    if (all.length >= conn.totalElements || conn.content.length === 0) break;
  }
  return { orgs: all, membership };
}

const UPDATE_MUTATION = `
  mutation LoadTiersUpdate($data: UpdateReferringOrganisationInput!) {
    updateReferringOrganisation(data: $data) { id name membershipTier membershipStartDate }
  }`;

function resolveRow(row, orgs, byNorm, map) {
  const mapped = map[row.name];
  if (mapped !== undefined) {
    const hit = typeof mapped === 'number' || /^\d+$/.test(String(mapped))
      ? orgs.filter(o => String(o.id) === String(mapped))
      : byNorm.get(normaliseName(mapped)) ?? [];
    return { matches: hit, via: 'map' };
  }
  return { matches: byNorm.get(normaliseName(row.name)) ?? [], via: 'name' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.csv) {
    console.log('Usage: CTA_BEARER_TOKEN=<token> node scripts/load-membership-tiers.mjs --csv <file> [--prod] [--map map.json] [--start YYYY-MM-DD] [--include-free] [--out report.csv] [--apply [--confirm-prod]]');
    process.exit(args.help ? 0 : 1);
  }
  if (args.start && !/^\d{4}-\d{2}-\d{2}$/.test(args.start)) throw new Error('--start must be YYYY-MM-DD');
  if (args.apply && args.env === 'prod' && !args.confirmProd) {
    throw new Error('Refusing to write to production without --confirm-prod. Run the dry run first and read it.');
  }
  const token = process.env.CTA_BEARER_TOKEN;
  if (!token) throw new Error('Set CTA_BEARER_TOKEN');

  const rows = readTierRows(readFileSync(args.csv, 'utf8'));
  const map = args.map ? JSON.parse(readFileSync(args.map, 'utf8')) : {};

  const { orgs, membership } = await fetchAllOrgs(args.env, token);
  const byNorm = new Map();
  for (const o of orgs) {
    const k = normaliseName(o.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), o]);
  }

  // A name listed twice with different tiers is a sheet error; the same tier twice is harmless.
  const seen = new Map();
  for (const r of rows) {
    const k = normaliseName(r.name);
    seen.set(k, [...(seen.get(k) ?? []), r.tier]);
  }

  console.log(`${args.env.toUpperCase()}: ${orgs.length} organisations in TaDa, ${rows.length} rows in the sheet.` +
    (membership ? '' : '\n⚠ This server has no membership fields yet (techaid-server#311 not deployed): matching only, nothing can be applied.'));

  const report = [];
  const done = new Set();
  for (const row of rows) {
    const out = { sheetName: row.name, sheetTier: row.tierText, id: '', taDaName: '', current: '', start: '', action: '', detail: '' };
    report.push(out);
    const key = normaliseName(row.name);
    if (!row.tier) { out.action = 'skip'; out.detail = `unknown tier "${row.tierText}"`; continue; }
    if (new Set(seen.get(key)).size > 1) { out.action = 'conflict'; out.detail = 'listed more than once with different tiers'; continue; }
    if (done.has(key)) { out.action = 'skip'; out.detail = 'duplicate row'; continue; }
    done.add(key);

    let { matches, via } = resolveRow(row, orgs, byNorm, map);
    if (matches.length > 1) {
      const live = matches.filter(o => !o.archived);
      if (live.length === 1) matches = live;
    }
    if (matches.length === 0) {
      const near = orgs
        .map(o => ({ o, s: similarity(row.name, o.name) }))
        .filter(x => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .map(x => `${x.o.id} "${x.o.name}"${x.o.archived ? ' (archived)' : ''}`);
      out.action = 'not-found';
      out.detail = near.length ? `closest: ${near.join('; ')}` : (via === 'map' ? 'map target not found' : '');
      continue;
    }
    if (matches.length > 1) {
      out.action = 'ambiguous';
      out.detail = matches.map(o => `${o.id} "${o.name}"${o.archived ? ' (archived)' : ''}`).join('; ');
      continue;
    }

    const org = matches[0];
    Object.assign(out, { id: org.id, taDaName: org.name, current: org.membershipTier ?? '' });
    if (org.archived) out.detail = 'archived in TaDa';
    if (row.tier === 'FREE' && !args.includeFree) { out.action = 'skip'; out.detail = 'free is the default'; continue; }
    const start = args.start ?? (row.tier !== 'FREE' ? row.datePaid : null);
    out.start = start ?? '';
    const startChanges = start && org.membershipStartDate !== start;
    if (membership && org.membershipTier === row.tier && !startChanges) { out.action = 'unchanged'; continue; }
    out.action = membership ? 'update' : 'update (pending #311)';
    if (!args.apply || !membership) continue;

    const data = {
      id: org.id,
      // updateReferringOrganisation still replaces name and website wholesale; send them back as
      // they are so setting a tier cannot blank them.
      name: org.name,
      website: org.website,
      membershipTier: row.tier,
      ...(start ? { membershipStartDate: start } : {}),
    };
    const body = await gql(args.env, token, UPDATE_MUTATION, { data });
    if (body.errors) { out.action = 'error'; out.detail = JSON.stringify(body.errors).slice(0, 300); continue; }
    out.action = 'updated';
  }

  const counts = {};
  for (const r of report) counts[r.action] = (counts[r.action] ?? 0) + 1;
  for (const r of report.filter(r => !['skip', 'unchanged'].includes(r.action) || r.detail === 'duplicate row')) {
    console.log(`${r.action.padEnd(21)} ${r.sheetTier.padEnd(7)} ${r.sheetName}${r.id ? ` → ${r.id} "${r.taDaName}"` : ''}${r.current ? ` [now ${r.current}]` : ''}${r.start ? ` from ${r.start}` : ''}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log('\nSummary:', JSON.stringify(counts));
  if (!args.apply) console.log('Dry run: nothing written. Re-run with --apply to write.');

  if (args.out) {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['sheetName', 'sheetTier', 'id', 'taDaName', 'current', 'start', 'action', 'detail'];
    writeFileSync(args.out, [cols.join(','), ...report.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n');
    console.log(`Report written to ${args.out}`);
  }
}

// Run only when executed directly, so the parsing helpers can be imported and checked offline.
if (process.argv[1]?.endsWith('load-membership-tiers.mjs')) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
