// CI guard: fails the build if src/ uses a FontAwesome glyph that isn't in
// the currently-committed subset (build/fa-subset-manifest.json). Converts
// "developer adds fa-calendar, gets a blank square in prod" into a red build.
//
// Does NOT regenerate the fonts — only re-runs the scan and diffs against
// the manifest, so it's cheap enough to run on every CI push/PR.
//
// Usage: node build/check-fa-icons.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCodepointMap, resolveNeeded } from './fa-subset-scan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const faDir = path.join(repoRoot, 'node_modules', '@fortawesome', 'fontawesome-free');
const srcDir = path.join(repoRoot, 'src');
const manifestPath = path.join(__dirname, 'fa-subset-manifest.json');

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error(`fa:check: no manifest at ${manifestPath} — run "npm run fa:subset" first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestCodepoints = new Set([
    ...manifest.icons.map((i) => parseInt(i.codepoint, 16)),
    ...manifest.codepointEscapes.map((cp) => parseInt(cp, 16)),
  ]);

  const allCss = fs.readFileSync(path.join(faDir, 'css', 'all.min.css'), 'utf8');
  const codepointMap = buildCodepointMap(allCss);

  // resolveNeeded already throws loudly for tokens that aren't valid
  // FontAwesome icons or allowlisted modifiers, which is itself a useful
  // check, but here we let it surface the same way fa-subset.mjs does.
  const { icons, codepointEscapes } = resolveNeeded(srcDir, codepointMap);

  const missing = [];
  for (const icon of icons) {
    if (!manifestCodepoints.has(icon.codepoint)) {
      missing.push(`${icon.name} (\\${icon.codepoint.toString(16).padStart(4, '0')})`);
    }
  }
  for (const [cp, locs] of codepointEscapes) {
    if (!manifestCodepoints.has(cp)) {
      missing.push(`content escape \\${cp.toString(16).padStart(4, '0')} (${Array.from(locs).join(', ')})`);
    }
  }

  // The committed CSS is pruned to the icons in use (fa-subset.mjs), so a newly used
  // icon also needs its `.fa-name{--fa:...}` rule, not just its glyph.
  const committedCss = fs.readFileSync(path.join(srcDir, 'fontawesome-subset.css'), 'utf8');
  const committedRules = buildCodepointMap(committedCss);
  for (const icon of icons) {
    if (!committedRules.has(icon.name)) {
      missing.push(`${icon.name} (no rule in src/fontawesome-subset.css)`);
    }
  }

  if (missing.length > 0) {
    console.error('fa:check: the following icons are used in src/ but are not in the committed FontAwesome subset:');
    for (const m of missing) console.error(`  ${m}`);
    console.error('\nRun "npm run fa:subset" and commit the regenerated fonts/manifest.');
    process.exit(1);
  }

  console.log(`fa:check: OK — ${icons.length} icon class(es) and ${codepointEscapes.size} codepoint escape(s) all covered by the subset.`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
