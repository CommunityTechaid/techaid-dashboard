# Digital-Hygiene Remediation — Tracker

Staged remediation of the July 2026 codebase health review (security, correctness, CI/testing,
performance). Work happens in credit-conscious batches that can stop/start across days: every
milestone ends committed to a `claude/hygiene-*` branch and/or an open PR to `dev`. This doc is
the resume point — update the status block and checkboxes in every PR that advances it.

**Model column** = recommended subagent strength when delegating a milestone
(Haiku = mechanical, Sonnet = moderate, Opus = complex/risky). Cx = complexity S/M/L.
Time = estimated agent wall-clock.

## Current status

- **Active batch:** 2 (CSP) — PR open from `claude/hygiene-batch2`; Batch 1 merged (PR #89)
- **Next action:** after Batch 2 merges + UAT deploy, run the deployed-UAT suite
  (`npx playwright test --config playwright.config.uat.ts`) and check the browser console for CSP
  violations across login, dashboard, and the public referral form; then Batch 3
- **Last updated:** 2026-07-03 (afternoon)

### E2E harness notes (2026-07-03)

- **Fixed in PR #89:** `save-token.mjs` must key the token cache by the scope the SDK actually
  requests — `openid profile email offline_access` (the app's `useRefreshTokens: true` appends
  `offline_access`). With the wrong key the lookup misses and every spec bounces to Auth0 login
  ("Missing Refresh Token"). Suite went 24 failed → 52 passed / 9 data-skips / 1 fail after the fix.
- The one remaining failure (`DEVREQ-B1`) is pre-existing UAT data drift — it fails identically
  on the pre-upgrade deployed build. Not a regression.
- The `setup` Playwright project never runs: its `testMatch` (`auth.setup.ts`) lies outside
  `testDir` (`e2e/tests`). Token injection via `save-token.mjs` is the real auth path.
- **Autonomy option (Batch 4 decision):** store `E2E_USERNAME`/`E2E_PASSWORD` as secrets so
  `auth.setup.ts` can do a real headless login (removes the ~24h manual token hand-off), or keep
  the token hand-off as the single human touchpoint.
- **Suite speed levers (fold into Batch 4):** parallel workers for read-only specs (currently
  `workers: 1`), replace the 43 `waitForTimeout` sleeps, split a fast route-mocked project from
  the UAT-data specs, abort third-party requests (Typeform/App Insights) in a global fixture.

### Batch 1 outcome notes

- Angular 21 is now **LTS** (21.2.17 framework / 21.2.18 CLI); **Angular 22 is the current major**
  (22.0.5) — the v22 upgrade is added to the Batch 6 backlog list (6.6).
- Regenerating `package-lock.json` from scratch (delete lock + node_modules) dropped production
  `npm audit` from 13 vulns (8 high) to 1 low. An npm quirk blocks in-place Angular patch bumps:
  the resolver seeds from the installed tree's exact cross-pins, so a clean reinstall is required.
- `@babel/core` fixed via a root `overrides` entry (`^7.29.7` — same version `@angular/build`
  already ships; only `@angular/compiler-cli` pinned the vulnerable 7.29.0).
- **Accepted risk:** `quill@2.0.3` XSS-via-HTML-export (GHSA-v3m3-f69x-jf25) has **no upstream
  fix** (npm's suggested "fix" is a downgrade to 2.0.2, which is older). Exposure is limited:
  the editor is only reachable by authenticated staff and Angular's template sanitizer guards
  rendering. Revisit when quill >2.0.3 ships.
- Typeform's evergreen `next/embed.js` cannot be SRI-pinned (mutable by design) — moved to
  explicit `https:` + `crossorigin`; CSP (Batch 2) is the compensating control.
- 1.4: `PostDataComponent`'s query hard-filters `published: {_eq: true}` server-side, so the
  unguarded `'**'` route can only render published CMS posts. Safe by design; no change.

## Review findings (verified 2026-07-03)

- **Security:** `@angular/*` at 21.2.8 (21.2.17 patches 2 sanitizer-bypass XSS + HttpTransferCache
  CVEs); `npm audit --omit=dev` = 13 vulns (8 high) incl. `quill@2.0.3` XSS; Typeform CDN script
  protocol-relative without SRI (`src/index.html:11,18`); no CSP; Auth0 tokens in localStorage
  (`src/main.ts:68-69` — accepted trade-off, mitigate via CSP); unguarded `'**'` →
  `PostDataComponent` route (`core-widgets.routes.ts:72`) needs a public-content check.
- **Correctness:** `kit-info.component.ts` resetOnHide fix half-applied (typeOfStorage,
  storageCapacity, tpmVersion, batteryHealth, subStatus.network, subStatus.installedOSName still
  scrubbed on type/status toggle); 24 submit buttons / 15 templates still on
  `[disabled]="form.invalid"` (use `warnIfFormInvalid()` from `src/app/shared/utils/form-validation.ts`);
  dead routed components `ReportsComponent`/`MapComponent`/`MapViewComponent`; stale TODO over the
  working hardcoded Apps Script URL (`device-request-info.component.ts:1151`).
- **Testing/CI:** deploy workflows are build-only (no test/lint/e2e gate); no unit tests or ESLint;
  16 Playwright specs, all regression-focused, no write-flow coverage; ~90 `test.skip(true,…)`,
  43 `waitForTimeout`, no `data-testid`s.
- **Performance:** all ~36 components eager in one chunk; only budget is `anyComponentStyle 6kb`;
  UAT builds unminified; wholesale lodash import (`src/app/shared/hash_utils.ts:1`); zero OnPush;
  jQuery/DataTables/tablesaw/FontAwesome5 global; leftover `@types/jasminewd2`/`@types/googlemaps`.

## Batch 1 — Security & dependency patch (`fix:` PR)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [x] | 1.1 | Bump `@angular/*` → 21.2.17/21.2.18 LTS; fresh lockfile; prod build ✓; e2e pending fresh token | S | 30–45m | Sonnet |
| [x] | 1.2 | `npm audit` 13 (8 high) → 1 low: fresh lock + `@babel/core` override; quill = accepted risk (no upstream fix) | M | 30–60m | Sonnet |
| [x] | 1.3 | `index.html`: Typeform URLs → explicit `https:` + `crossorigin`; SRI impossible (evergreen script), CSP is the control | S | 15m | Haiku |
| [x] | 1.4 | Verified: `PostDataComponent` query hard-filters `published: true` server-side — safe, no change | S | 15–30m | Sonnet |

Pause point: PR open, this tracker committed.

## Batch 2 — CSP hardening (`fix:` PR, separate — needs UAT soak)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [x] | 2.1 | CSP + nosniff/Referrer-Policy/Permissions-Policy in existing `src/staticwebapp.config.json`. Origins beyond the obvious: ward-lookup iframe (`communitytechaid.github.io`), Places proxy worker (`cta-places-proxy.community-techaid.workers.dev`), Apps Script PDF fetch (`script.google.com` + `*.googleusercontent.com` redirect), Wix logos (img). No `unsafe-inline`/`unsafe-eval` in script-src; `unsafe-inline` required for style-src (Angular runtime style injection) | M | 45–60m | Opus |
| [ ] | 2.2 | Post-merge on UAT: deployed-UAT suite + verify Auth0 round-trip, GraphQL load, Typeform widget, ward iframe, no CSP console violations | S | 20m | Sonnet |

**First UAT soak (2026-07-03) found three issues, fixed in the follow-up PR:**
- `crossorigin="anonymous"` on the Typeform tags (added in Batch 1) made the browser CORS-block
  the embed entirely — Typeform's CDN sends no CORS headers. Attribute removed; it's only useful
  alongside SRI, which the evergreen script can't support anyway.
- `sb-admin.css` @imports the Poppins font from `fonts.googleapis.com` — missed in the origin
  sweep (it greps `src/app`, the import is in `src/`). Added `fonts.googleapis.com` (style-src)
  and `fonts.gstatic.com` (font-src). Self-hosting the font is a Batch 6 candidate.
- NGXS builds property getters via `new Function()` (an eval), blocked by script-src. Fixed
  properly with `compatibility: { strictContentSecurityPolicy: true }` in `state.module.ts`
  rather than allowing `unsafe-eval`.

## Batch 3 — Correctness sweep (`fix:` PRs, red/green specs)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [ ] | 3.1 | kit-info resetOnHide completion (6 fields) + red-first spec (extend `kit-locked-status.spec.ts` mocked pattern) | M | 1–1.5h | Opus |
| [ ] | 3.2 | Migrate 24 buttons / 15 templates off `[disabled]="form.invalid"` → `warnIfFormInvalid()`; extend `save-button-clickable.spec.ts` | M | 1–2h | Sonnet |
| [ ] | 3.3 | Delete dead components (`reports/`, `map/`, `map-view/`) + route imports + commented blocks (`kit-info.component.ts:816-877`, `kit-audit-component.html`) | S | 30m | Haiku |
| [ ] | 3.4 | Apps Script URL → environment config; error toasts on lookup `watchQuery` subs; standardize `date:'medium'` outliers; native `confirm()` → modal in 3 `custom-notes.ts` | M | 1h | Sonnet |

## Batch 4 — CI + lint gate (`ci:` PR)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [ ] | 4.1 | Read `e2e/auth.setup.ts`; decide CI auth strategy (creds secrets vs mocked-subset + nightly UAT job) | S | 15m | Sonnet |
| [ ] | 4.2 | `.github/workflows/ci.yml`: PR→dev gate, prod build + Playwright per 4.1 | M | 1h | Sonnet |
| [ ] | 4.3 | ESLint via `ng add @angular-eslint/schematics`; fix auto-fixables; gate errors in CI | M | 1–2h | Sonnet |
| [ ] | 4.4 | Skip hygiene: reasons on every `test.skip(true,…)`, skip-count in CI summary, fail if >40% skipped | S | 30m | Haiku |

## Batch 5 — E2E write-flow coverage (`test:` PRs, one per flow)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [ ] | 5.1 | GraphQL-mutation teardown helper; `data-testid`s on needed controls | M | 1h | Opus |
| [ ] | 5.2 | Device intake spec: create → in index → edit → persist | M | 1–1.5h | Opus |
| [ ] | 5.3 | Device-request lifecycle spec: create → assign → transitions → complete | L | 1.5–2h | Opus |
| [ ] | 5.4 | Donor CRUD spec | M | 1h | Sonnet |
| [ ] | 5.5 | Referring-org + referee CRUD spec | M | 1–1.5h | Sonnet |
| [ ] | 5.6 | User role assign/remove spec | M | 1h | Sonnet |

Pitfalls: button textContent whitespace, ng-select overlay, device-request-index default
`is_sales` filter. New specs use `expect`-polling/`waitForResponse`, never `waitForTimeout`.

## Batch 6 — Performance pass (`perf:`/`chore:` PRs, after Batch 5 suite exists)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [ ] | 6.1 | Measure initial chunk; add `initial`+`allScript` budgets; script optimization for `uat` config | S | 30m | Sonnet |
| [ ] | 6.2 | Route-level code splitting: `component:` → `loadComponent:` throughout `core-widgets.routes.ts` | M | 1h | Sonnet |
| [ ] | 6.3 | Lodash per-function imports in `hash_utils.ts` | S | 15m | Haiku |
| [ ] | 6.4 | Remove dead deps: `tablesaw`, `@types/jasminewd2`, `@types/googlemaps`; audit `datatables.net*` usage | S | 30m | Haiku |
| [ ] | 6.5 | OnPush pilot on `donor-index` (`markForCheck()` in DataTables ajax callbacks) → fan out if green | L | 2–4h | Opus |
| [ ] | 6.6 | File backlog issues: DataTables→native tables, zoneless, FA5→7, apollo-angular 14/graphql 17/NGXS 22/TS 6, Auth0 in-memory cache | S | 30m | Haiku |

## Verification (every batch)

- `ng build --configuration production` + `npx playwright test` against UAT before each PR.
- Behavior fixes: spec red on `dev`, green on branch.
- Conventional commit titles so release-please versions correctly.
- Never push `master`/`dev` directly; human review merges every PR.
