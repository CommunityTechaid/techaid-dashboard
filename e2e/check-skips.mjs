// Skip hygiene for the Playwright suite (hygiene tracker 4.4).
//
// Reads a Playwright JSON report, prints a pass/fail/skip breakdown (and the
// skip reasons), appends a markdown summary to $GITHUB_STEP_SUMMARY when
// running in GitHub Actions, and exits non-zero if the skipped share of the
// suite exceeds the threshold — a suite that silently degrades into skips
// stops being a gate.
//
// Usage: node e2e/check-skips.mjs [path/to/results.json]
//   SKIP_RATIO_MAX  override the failure threshold (default 0.4)

import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'test-results/results.json';
const threshold = Number(process.env.SKIP_RATIO_MAX ?? '0.4');

if (!existsSync(reportPath)) {
  // Missing report means the run died before producing one (webServer boot
  // failure etc.) — that step's own failure is the signal, not this check.
  console.log(`check-skips: no report at ${reportPath}; nothing to check.`);
  process.exit(0);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const skipReasons = new Map();
let passed = 0, failed = 0, skipped = 0, flaky = 0;

const walk = (suite) => {
  for (const child of suite.suites ?? []) walk(child);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      switch (t.status) {
        case 'expected': passed++; break;
        case 'unexpected': failed++; break;
        case 'flaky': flaky++; break;
        case 'skipped': {
          skipped++;
          const reason =
            t.annotations?.find((a) => a.type === 'skip')?.description ??
            t.results?.flatMap((r) => r.annotations ?? []).find((a) => a.type === 'skip')?.description ??
            '(no reason given)';
          skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
          break;
        }
      }
    }
  }
};
for (const suite of report.suites ?? []) walk(suite);

const total = passed + failed + skipped + flaky;
const ratio = total === 0 ? 0 : skipped / total;
const pct = (ratio * 100).toFixed(1);
const over = ratio > threshold;

const lines = [
  `Total ${total} — ${passed} passed, ${failed} failed, ${flaky} flaky, ${skipped} skipped (${pct}%)`,
];
if (skipReasons.size) {
  lines.push('', 'Skip reasons:');
  for (const [reason, n] of [...skipReasons].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${String(n).padStart(3)}× ${reason}`);
  }
}
console.log(lines.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    '## E2E skip hygiene',
    '',
    `| Total | Passed | Failed | Flaky | Skipped |`,
    `|---|---|---|---|---|`,
    `| ${total} | ${passed} | ${failed} | ${flaky} | ${skipped} (${pct}%) |`,
    '',
  ];
  if (skipReasons.size) {
    md.push('<details><summary>Skip reasons</summary>', '');
    for (const [reason, n] of [...skipReasons].sort((a, b) => b[1] - a[1])) {
      md.push(`- ${n}× ${reason}`);
    }
    md.push('', '</details>', '');
  }
  if (over) md.push(`❌ Skipped share ${pct}% exceeds the ${threshold * 100}% ceiling.`, '');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n'));
}

if (over) {
  console.error(`\ncheck-skips: FAIL — ${pct}% of the suite skipped (ceiling ${threshold * 100}%).`);
  console.error('A suite that mostly skips is not a gate; fix the data/setup the skips point at.');
  process.exit(1);
}
