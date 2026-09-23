// Subsets @fortawesome/fontawesome-free's three webfonts down to the glyphs
// this app actually uses, and writes fontawesome-subset.css to match: @font-face
// src URLs are repointed at the subset files, and the per-icon rules
// (`.fa-name{--fa:"XXXX"}`, ~2,000 of them) are pruned to the icons in use.
// Every other rule is kept byte-identical.
//
// Usage: node build/fa-subset.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import subsetFont from 'subset-font';
import * as fontkit from 'fontkit';
import { buildCodepointMap, resolveNeeded } from './fa-subset-scan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const faDir = path.join(repoRoot, 'node_modules', '@fortawesome', 'fontawesome-free');
const srcDir = path.join(repoRoot, 'src');
const outDir = path.join(repoRoot, 'src', 'assets', 'fonts', 'fa');
const cssOutPath = path.join(repoRoot, 'src', 'fontawesome-subset.css');
const manifestPath = path.join(__dirname, 'fa-subset-manifest.json');

const FACES = [
  { family: 'Font Awesome 7 Free', weight: 400, file: 'fa-regular-400.woff2' },
  { family: 'Font Awesome 7 Free', weight: 900, file: 'fa-solid-900.woff2' },
  { family: 'Font Awesome 7 Brands', weight: 400, file: 'fa-brands-400.woff2' },
];

// all.min.css also has a handful of legacy @font-face blocks (v5-named
// families, the unprefixed v4 "FontAwesome" family) that reuse these same
// three files — those URLs get repointed for free by the loop below. The
// one exception is fa-v4compatibility.woff2, a distinct file backing a few
// old v4 icon aliases nothing in this app uses. It isn't one of the three
// faces we subset, but its @font-face rule still needs to resolve or the
// build fails, so it's copied through unsubsetted (it's tiny: ~4KB).
const PASSTHROUGH_FILES = ['fa-v4compatibility.woff2'];

function main() {
  const faVersion = JSON.parse(fs.readFileSync(path.join(faDir, 'package.json'), 'utf8')).version;
  const allCss = fs.readFileSync(path.join(faDir, 'css', 'all.min.css'), 'utf8');

  const codepointMap = buildCodepointMap(allCss);
  const { icons, codepointEscapes, neededCodepoints } = resolveNeeded(srcDir, codepointMap);

  console.log(`fa-subset: ${icons.length} icon class(es) resolved, ${codepointEscapes.size} literal codepoint escape(s), ${neededCodepoints.size} unique codepoint(s) total`);

  const text = Array.from(neededCodepoints)
    .map((cp) => String.fromCodePoint(cp))
    .join('');

  fs.mkdirSync(outDir, { recursive: true });

  const faceResults = [];
  return (async () => {
    for (const face of FACES) {
      const srcPath = path.join(faDir, 'webfonts', face.file);
      const original = fs.readFileSync(srcPath);
      const subset = await subsetFont(original, text, { targetFormat: 'woff2' });

      const outPath = path.join(outDir, face.file);
      fs.writeFileSync(outPath, subset);

      verifySubset(face.file, original, subset, neededCodepoints);

      faceResults.push({ file: face.file, before: original.length, after: subset.length });
      console.log(
        `  ${face.file}: ${original.length} -> ${subset.length} bytes ` +
          `(${(100 - (subset.length / original.length) * 100).toFixed(1)}% smaller)`,
      );
    }

    for (const file of PASSTHROUGH_FILES) {
      fs.copyFileSync(path.join(faDir, 'webfonts', file), path.join(outDir, file));
    }

    writeCss(allCss, cssOutPath, new Set(icons.map((i) => i.name)));
    writeManifest(manifestPath, faVersion, icons, codepointEscapes, faceResults);

    console.log(`fa-subset: wrote ${cssOutPath} and manifest ${manifestPath}`);
  })();
}

function verifySubset(fileLabel, originalBuf, subsetBuf, neededCodepoints) {
  const originalFont = fontkit.create(originalBuf);
  const subsetFontObj = fontkit.create(subsetBuf);

  const missing = [];
  let checked = 0;
  for (const cp of neededCodepoints) {
    if (!originalFont.hasGlyphForCodePoint(cp)) continue; // this face doesn't carry that glyph anyway
    checked++;
    if (!subsetFontObj.hasGlyphForCodePoint(cp)) {
      missing.push(cp.toString(16));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `fa-subset: ${fileLabel} is missing glyph(s) present in the original font: ${missing.join(', ')}`,
    );
  }

  console.log(`  ${fileLabel}: verified ${checked} codepoint(s) present in subset cmap`);
}

function writeCss(allCss, outPath, usedNames) {
  // Repoint only the three @font-face src URLs we actually subset (plus the
  // passthrough file). The legacy v5/v4-compat @font-face blocks and every
  // non-icon rule are preserved verbatim.
  let css = allCss;
  for (const file of [...FACES.map((f) => f.file), ...PASSTHROUGH_FILES]) {
    const re = new RegExp(`url\\(\\.\\./webfonts/${file}\\)`, 'g');
    css = css.replace(re, `url(./assets/fonts/fa/${file})`);
  }
  // Prune the per-icon rules to the icons in use. They are ~85% of all.min.css
  // (~75 kB of the initial styles bundle) and a rule for an icon whose glyph is
  // not in the subset font could only ever render a blank box anyway. A rule is
  // kept whole (all its alias selectors) if ANY of its names is used. Same
  // pattern buildCodepointMap() parses, so the two cannot disagree.
  const before = css.length;
  css = css.replace(/((?:\.fa-[a-z0-9-]+,?)+)\{--fa:"([^"]*)"\}/g, (rule, selectors) =>
    selectors.split(',').some((sel) => usedNames.has(sel.slice(1))) ? rule : '',
  );
  console.log(`  fontawesome-subset.css: ${before} -> ${css.length} bytes (icon rules pruned to ${usedNames.size} used name(s))`);
  fs.writeFileSync(outPath, css);
}

function writeManifest(outPath, faVersion, icons, codepointEscapes, faceResults) {
  const manifest = {
    fontAwesomeVersion: faVersion,
    generatedAt: new Date().toISOString(),
    icons: icons
      .map((i) => ({ name: i.name, codepoint: i.codepoint.toString(16).padStart(4, '0') }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    codepointEscapes: Array.from(codepointEscapes.keys())
      .map((cp) => cp.toString(16).padStart(4, '0'))
      .sort(),
    faces: faceResults,
  };
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
