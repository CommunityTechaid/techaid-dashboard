#!/usr/bin/env node
/**
 * e2e:affected — run only the Playwright specs a change can plausibly affect.
 *
 *   npm run e2e:affected                    # diff vs origin/dev, @mocked specs only
 *   npm run e2e:affected -- --base main     # other base ref (also E2E_AFFECTED_BASE)
 *   npm run e2e:affected -- --live          # include live-UAT specs (needs a real token)
 *   npm run e2e:affected -- --dry-run       # print the selection, run nothing
 *   npm run e2e:affected -- -- --headed     # everything after a bare `--` goes to playwright
 *   E2E_PORT=4315 npm run e2e:affected      # honoured (inherited by playwright.config.ts)
 *
 * How a changed file maps to specs (a heuristic: it errs towards running more):
 *   - e2e/tests/*.spec.ts          the spec itself.
 *   - e2e/helpers/*.ts             every spec that imports it, transitively through other helpers.
 *                                  A helper used by >= HELPER_GLOBAL_SHARE of specs is "global".
 *   - src/app/**                   keys derived from the file, then specs whose text mentions a key:
 *                                    component folder name (kit-info), file stem (kit-info.component),
 *                                    component selector (app-kit-info), route path from
 *                                    core-widgets.routes.ts ('dashboard/devices'), and GraphQL
 *                                    operation names (findAllKits). Files that import a changed
 *                                    non-component file (services, state, models) are followed
 *                                    up to IMPORT_DEPTH levels to the components that use it.
 *   - global files                 playwright config, package.json, angular.json, tsconfig, app
 *                                  config/routing, styles, index.html, environments, proxy config,
 *                                  CI workflow, staff-permissions: run the whole suite.
 *   - docs only (*.md, docs/, .claude/, _archive/)  ignored; nothing to run if that is all.
 * Falls back to the full suite when mapping finds nothing for a src change, a global file
 * changed, or the selection is more than FALLBACK_SHARE of the candidate specs.
 * Default universe is @mocked specs (--grep @mocked); --live drops that filter.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER_GLOBAL_SHARE = 0.5;
const FALLBACK_SHARE = 0.6;
const IMPORT_DEPTH = 3;

const GLOBAL_FILES = [
  /^playwright\.config.*\.ts$/, /^package(-lock)?\.json$/, /^angular\.json$/, /^tsconfig.*\.json$/,
  /^src\/app\/app\.(config|module|routing\.module|component)\./, /^src\/main\.ts$/,
  /^src\/styles/, /^src\/index\.html$/, /^src\/environments\//, /^src\/proxy/,
  /^src\/app\/graphql\.module\.ts$/, /^src\/app\/shared\/services\/auth/,
  /^\.github\/workflows\/ci\.yml$/, /^e2e\/auth\.setup\.ts$/, /^e2e\/helpers\/staff-permissions\.json$/,
  /^e2e\/(save|mint-fake)-token\.mjs$/, /^eslint\.config\./,
  /core-widgets\.routes\.ts$/, /^staticwebapp\.config\.json$/,
];
const DOC_ONLY = [/\.md$/, /^docs\//, /^\.claude\//, /^_archive\//, /^LICENSE/, /^\.gitignore$/];

// ---- args -------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const passthrough = sep >= 0 ? argv.slice(sep + 1) : [];
const own = sep >= 0 ? argv.slice(0, sep) : argv;
const flag = n => own.includes(n);
const opt = (n, d) => { const i = own.indexOf(n); return i >= 0 ? own[i + 1] : d; };
const base = opt('--base', process.env.E2E_AFFECTED_BASE || 'origin/dev');
const live = flag('--live');
const dryRun = flag('--dry-run');
const quiet = flag('--quiet');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const norm = p => p.replace(/\\/g, '/');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir, accept) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap(n => {
    const rel = posix.join(dir, n);
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel, accept) : accept(rel) ? [rel] : [];
  });
};

// ---- changed files ----------------------------------------------------------------------
// --commit <sha> maps a single (e.g. squash-merged) commit instead of the working diff; used to
// validate the mapping against history. Spec contents are still read from the working tree.
const commit = opt('--commit');
let mergeBase = commit ? `${commit}^` : '';
if (!commit) {
  try { mergeBase = git('merge-base', base, 'HEAD'); }
  catch { console.error(`e2e:affected: cannot resolve base "${base}" (git fetch origin?)`); process.exit(2); }
}
const changed = [...new Set((commit
  ? git('diff', '--name-only', `${commit}^`, commit).split('\n')
  : [
    ...git('diff', '--name-only', mergeBase).split('\n'),                     // committed + unstaged
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),          // untracked
  ]).map(norm).filter(Boolean))];

// ---- spec universe ----------------------------------------------------------------------
const allSpecs = walk('e2e/tests', p => p.endsWith('.spec.ts'));
const specText = Object.fromEntries(allSpecs.map(s => [s, read(s)]));
// A real tag in a describe/test title — not a comment that merely mentions "@mocked".
const isMocked = s => specText[s].split('\n').some(l => {
  const t = l.trim();
  return t.includes('@mocked') && !/^(\*|\/\/|\/\*)/.test(t);
});
const candidates = live ? allSpecs : allSpecs.filter(isMocked);

const why = new Map(); // spec -> Set<reason>
const pick = (spec, reason) => { if (!why.has(spec)) why.set(spec, new Set()); why.get(spec).add(reason); };

function fullSuite(reason) {
  report(`FULL SUITE (${reason})`, candidates, null);
  run(null);
}

// ---- classify ---------------------------------------------------------------------------
const globalHit = changed.find(f => GLOBAL_FILES.some(r => r.test(f)));
const relevant = changed.filter(f => !DOC_ONLY.some(r => r.test(f)));
if (!quiet) console.log(`e2e:affected: base ${base} (merge-base ${mergeBase.slice(0, 8)}), ${changed.length} changed file(s)`);
if (!relevant.length) { console.log('e2e:affected: only docs changed; nothing to run.'); process.exit(0); }
if (globalHit) fullSuite(`global file changed: ${globalHit}`);

// ---- helpers: reverse import closure ----------------------------------------------------
const helperFiles = walk('e2e/helpers', p => /\.(ts|mjs)$/.test(p));
const importsOf = (text) => [...text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => m[1]);
function importers(helperRel) {
  const stem = basename(helperRel).replace(/\.(ts|mjs)$/, '');
  const hit = new Set();
  const queue = [stem];
  const seen = new Set(queue);
  while (queue.length) {
    const s = queue.pop();
    const re = new RegExp(`from\\s+['"][^'"]*helpers/${s}['"]|from\\s+['"]\\./${s}['"]`);
    for (const sp of allSpecs) if (re.test(specText[sp])) hit.add(sp);
    for (const h of helperFiles) {
      const hs = basename(h).replace(/\.(ts|mjs)$/, '');
      if (!seen.has(hs) && importsOf(read(h)).some(i => basename(i) === s)) { seen.add(hs); queue.push(hs); }
    }
  }
  return hit;
}

for (const f of relevant) {
  if (/^e2e\/tests\/.*\.spec\.ts$/.test(f) && specText[f]) { pick(f, `spec changed`); continue; }
  if (/^e2e\/helpers\//.test(f)) {
    const users = importers(f);
    if (users.size / allSpecs.length >= HELPER_GLOBAL_SHARE) fullSuite(`helper ${f} is used by ${users.size}/${allSpecs.length} specs`);
    for (const s of users) pick(s, `imports changed helper ${basename(f)}`);
  }
}

// ---- app source: keys -------------------------------------------------------------------
const srcFiles = walk('src/app', p => /\.(ts|html)$/.test(p) && !/\.spec\.ts$/.test(p));
const srcText = Object.fromEntries(srcFiles.map(f => [f, read(f)]));
const stemOf = f => basename(f).replace(/\.(component|service|state|model|directive|pipe|guard)?\.(ts|html|css|scss)$/, '');
const folderOf = f => { const m = f.match(/\/components\/([^/]+)\//); return m ? m[1] : null; };

// route path (static) -> component folder, from core-widgets.routes.ts one-liners
const routesByFolder = new Map();
for (const f of srcFiles.filter(f => /\.routes\.ts$/.test(f))) {
  for (const line of srcText[f].split('\n')) {
    const m = line.match(/path:\s*'([^']+)'.*import\('\.\/components\/([^/']+)\//);
    if (!m) continue;
    // Parameterised routes (':id') are skipped: their static prefix is the LIST page's URL,
    // which nearly every spec visits, so it would say nothing about this component.
    if (m[1].includes(':')) continue;
    const staticPath = m[1];
    if (staticPath.length >= 4) (routesByFolder.get(m[2]) ?? routesByFolder.set(m[2], new Set()).get(m[2])).add(staticPath);
  }
}

// reverse import graph within src/app (by relative-import basename; good enough for this repo)
function usersOf(file) {
  const stem = basename(file).replace(/\.(ts|html)$/, '');
  return srcFiles.filter(f => f !== file && importsOfSrc(srcText[f]).some(i => basename(i) === stem));
}
const importsOfSrc = text => [...text.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);

function keysFor(file) {
  const keys = new Map(); // key -> kind
  const folder = folderOf(file);
  if (folder) keys.set(folder, 'component folder');
  const stem = stemOf(file);
  if (stem.length >= 4) keys.set(stem, 'file name');
  const dirTs = folder ? srcFiles.filter(f => f.includes(`/components/${folder}/`) && f.endsWith('.ts')) : [file];
  for (const t of dirTs.filter(f => f.endsWith('.ts'))) {
    for (const m of srcText[t]?.matchAll(/selector:\s*['"]([^'"]+)['"]/g) ?? []) keys.set(m[1], 'selector');
    // Real operation definitions only (`query Name(...) {` / `mutation Name {`), not prose in comments.
    for (const m of srcText[t]?.matchAll(/\b(?:query|mutation)\s+([A-Za-z_]\w+)\s*[({]/g) ?? []) keys.set(m[1], 'GraphQL operation');
  }
  if (folder) for (const p of routesByFolder.get(folder) ?? []) keys.set(`/${p}`, 'route');
  return keys;
}

function specMentions(spec, key, kind) {
  const t = specText[spec];
  if (kind === 'route') return new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w/-])`).test(t);
  if (kind === 'selector') return t.includes(key);
  return new RegExp(`(?<![\\w-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(t);
}

// Other src/ files (assets, ...) map to nothing and fall through to the full-suite fallback below.
for (const f of relevant.filter(f => f.startsWith('src/app/'))) {
  // Follow importers from a non-component file to the components that use it.
  const roots = new Set([f]);
  if (!folderOf(f)) {
    let frontier = [f];
    for (let d = 0; d < IMPORT_DEPTH && frontier.length; d++) {
      const next = [];
      for (const x of frontier) for (const u of usersOf(x)) if (!roots.has(u)) { roots.add(u); next.push(u); }
      frontier = next.filter(u => !folderOf(u));
    }
  }
  const seenKeys = new Set();
  for (const r of roots) {
    for (const [key, kind] of keysFor(r)) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      for (const sp of candidates) if (specMentions(sp, key, kind)) {
        pick(sp, `${basename(f)}${r === f ? '' : ` (via ${basename(r)})`} -> ${kind} "${key}"`);
      }
    }
  }
}

const selected = candidates.filter(s => why.has(s));
const srcTouched = relevant.some(f => f.startsWith('src/'));
const specsTouched = relevant.some(f => f.startsWith('e2e/'));
if (!selected.length) {
  if (srcTouched || specsTouched) fullSuite('changes found but no spec mapped');
  else { console.log('e2e:affected: no e2e-relevant change; nothing to run.'); process.exit(0); }
}
if (selected.length / candidates.length > FALLBACK_SHARE) fullSuite(`selection is ${selected.length}/${candidates.length} specs`);

report('SELECTED', selected, why);
const skippedChanged = [...why.keys()].filter(s => !candidates.includes(s));
if (skippedChanged.length) console.log(`  (not run, not @mocked: ${skippedChanged.join(', ')}; use --live)`);
run(selected);

// ---- output / run -----------------------------------------------------------------------
function report(title, specs, reasons) {
  console.log(`\ne2e:affected: ${title} — ${specs.length}/${candidates.length} ${live ? '' : '@mocked '}spec file(s)`);
  if (reasons) for (const s of specs) console.log(`  ${s}\n      ${[...reasons.get(s)].slice(0, 4).join('; ')}`);
}

function run(specs) {
  if (dryRun) { console.log('\n(dry run — not executing)'); process.exit(0); }
  const args = ['playwright', 'test', ...(specs ?? []), ...(live ? [] : ['--grep', '@mocked']), ...passthrough];
  console.log(`\n> npx ${args.join(' ')}${process.env.E2E_PORT ? `   (E2E_PORT=${process.env.E2E_PORT})` : ''}\n`);
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}
