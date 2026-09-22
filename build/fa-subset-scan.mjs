// Shared scanning/resolution logic for the FontAwesome subsetting pipeline.
// Used by both fa-subset.mjs (generator) and check-fa-icons.mjs (CI guard)
// so the two can never drift out of sync on what counts as "used".

import fs from 'fs';
import path from 'path';

// FA's own non-glyph modifier classes. Anything using one of these renders
// nothing itself (sizing/animation/stacking utilities) so it needs no glyph.
export const ALLOWLIST_LITERALS = new Set([
  'fa-fw', 'fa-lg', 'fa-xs', 'fa-sm',
  'fa-spin', 'fa-spin-pulse', 'fa-spin-reverse', 'fa-pulse',
  'fa-beat', 'fa-fade', 'fa-bounce', 'fa-shake',
  'fa-stack', 'fa-stack-1x', 'fa-stack-2x', 'fa-inverse',
  'fa-border', 'fa-pull-left', 'fa-pull-right',
  'fa-li', 'fa-ul',
  'fa-solid', 'fa-regular', 'fa-brands',
  'fa-sr-only', 'fa-sr-only-focusable',
  ...Array.from({ length: 10 }, (_, i) => `fa-${i + 1}x`),
]);

export const ALLOWLIST_WILDCARDS = [/^fa-rotate-/, /^fa-flip-/];

// This tool's own generated output. It's FontAwesome's CSS copied near-
// verbatim, so it's riddled with `--fa-*` custom property names and
// `fa-brands-400.woff2`-style filenames that match the `fa-*` token regex
// but aren't icon usage — scanning it would be circular and produces false
// positives. Usage lives in the hand-authored files, never in this file.
export const GENERATED_CSS_BASENAME = 'fontawesome-subset.css';

export function isAllowlisted(token) {
  return ALLOWLIST_LITERALS.has(token) || ALLOWLIST_WILDCARDS.some((re) => re.test(token));
}

// Parse a single `content:"..."` value (already stripped of the outer
// quotes) into a numeric codepoint. Handles the three forms FA's own CSS
// uses: `\f002` (hex escape), `\!` (CSS-escaped literal), and `A` (bare
// literal, used for the fa-a..fa-z / fa-0..fa-9 keycap icons).
function parseContentValue(raw) {
  if (raw.startsWith('\\')) {
    const rest = raw.slice(1);
    const hexMatch = /^[0-9a-fA-F]{1,6}\s?$/.exec(rest);
    if (hexMatch) return parseInt(rest.trim(), 16);
    return rest.codePointAt(0);
  }
  return raw.codePointAt(0);
}

// Build a name -> codepoint map from FontAwesome's own all.min.css. This is
// the authoritative source: FA7 defines each icon as
//   .fa-name-a,.fa-alias-b{--fa:"\fXXXX"}
// so grouped selectors resolve aliases natively (fa-search, fa-times, ...)
// without needing a separate alias table.
export function buildCodepointMap(faCssText) {
  const re = /((?:\.fa-[a-z0-9-]+,?)+)\{--fa:"([^"]*)"\}/g;
  const map = new Map();
  let m;
  while ((m = re.exec(faCssText))) {
    const codepoint = parseContentValue(m[2]);
    const names = m[1].split(',').map((s) => s.slice(1));
    for (const name of names) map.set(name, codepoint);
  }
  return map;
}

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.includes(path.extname(entry.name)) && entry.name !== GENERATED_CSS_BASENAME) {
      out.push(full);
    }
  }
  return out;
}

// Scan src/ for everything that needs a glyph:
//  - fa-* class tokens in html/ts/css/scss
//  - literal content:"\fXXXX" codepoint escapes in css/scss (sb-admin.css
//    references glyphs this way, bypassing class names entirely)
export function scanSrc(srcDir) {
  const classTokenFiles = walk(srcDir, ['.html', '.ts', '.css', '.scss']);
  const codepointFiles = walk(srcDir, ['.css', '.scss']);

  const classTokens = new Map(); // token -> Set of "file:line"
  const codepointEscapes = new Map(); // codepoint -> Set of "file:line"

  const classTokenRe = /fa-[a-z0-9-]+/g;
  for (const file of classTokenFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      let m;
      classTokenRe.lastIndex = 0;
      while ((m = classTokenRe.exec(line))) {
        const rel = path.relative(process.cwd(), file);
        const loc = `${rel}:${i + 1}`;
        if (!classTokens.has(m[0])) classTokens.set(m[0], new Set());
        classTokens.get(m[0]).add(loc);
      }
    });
  }

  const contentRe = /content:\s*['"]\\([0-9a-fA-F]{3,6})['"]/g;
  for (const file of codepointFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      let m;
      contentRe.lastIndex = 0;
      while ((m = contentRe.exec(line))) {
        const codepoint = parseInt(m[1], 16);
        const rel = path.relative(process.cwd(), file);
        const loc = `${rel}:${i + 1}`;
        if (!codepointEscapes.has(codepoint)) codepointEscapes.set(codepoint, new Set());
        codepointEscapes.get(codepoint).add(loc);
      }
    });
  }

  return { classTokens, codepointEscapes };
}

// Resolve every scanned class token against the FA codepoint map. Throws on
// anything that is neither allowlisted nor resolvable — never silently skips.
export function resolveNeeded(srcDir, faCodepointMap) {
  const { classTokens, codepointEscapes } = scanSrc(srcDir);

  const icons = []; // {name, codepoint}
  const unresolved = [];
  for (const [token, locs] of classTokens) {
    if (isAllowlisted(token)) continue;
    if (faCodepointMap.has(token)) {
      icons.push({ name: token, codepoint: faCodepointMap.get(token) });
    } else {
      unresolved.push({ token, locs: Array.from(locs) });
    }
  }

  if (unresolved.length > 0) {
    const details = unresolved
      .map((u) => `  ${u.token} (used at ${u.locs.join(', ')})`)
      .join('\n');
    throw new Error(
      `fa-subset: found ${unresolved.length} class token(s) that are neither ` +
        `FontAwesome icons nor in the modifier allowlist:\n${details}`,
    );
  }

  const neededCodepoints = new Set(icons.map((i) => i.codepoint));
  for (const cp of codepointEscapes.keys()) neededCodepoints.add(cp);

  icons.sort((a, b) => a.name.localeCompare(b.name));

  return {
    icons,
    codepointEscapes,
    neededCodepoints,
  };
}
