# Digital-Hygiene Remediation — Tracker

Staged remediation of the July 2026 codebase health review (security, correctness, CI/testing,
performance). Work happens in credit-conscious batches that can stop/start across days: every
milestone ends committed to a `claude/hygiene-*` branch and/or an open PR to `dev`. This doc is
the resume point — update the status block and checkboxes in every PR that advances it.

**Model column** = recommended subagent strength when delegating a milestone
(Haiku = mechanical, Sonnet = moderate, Opus = complex/risky). Cx = complexity S/M/L.
Time = estimated agent wall-clock.

## Current status

- **Batches 1–3 complete and verified on UAT** (PRs #89–#98 merged). Latest deployed-UAT suite:
  54 passed / 9 data-skips / 1 known pre-existing failure (DEVREQ-B1 data drift). E2E speed
  levers also done (#94): full suite ~3-4m, `npm run e2e:fast` mocked subset ~30s.
- **Batch 4 complete:** 4.1+4.2 (CI gate, #99), 4.3 (ESLint, #100 — 0 errors / ~1.1k
  documented warn-baseline; `lint` job added to `ci.yml` in the same PR), 4.4 (skip
  hygiene) merged.
- **Batch 5 started:** 5.1 done (`e2e/helpers/graphql.ts` teardown helper + smoke spec +
  data-testids on create/save/delete controls, PR open). **Key finding:** the UAT test token
  gets "Access Denied" on ALL `delete*` mutations — the helper hard-deletes first and falls
  back to archiving (donor/kit/org/contact have `archived`; deviceRequest has neither an
  archived flag nor a minimal-update path, so it is hard-delete-only → spec 5.3 must plan for
  manual cleanup or a delete-capable token). Also: the Kotlin `Create*/Update*Input`
  constructors require EVERY field present (nullable ones included) — partial payloads throw
  "Failed to instantiate". 5.2 done 2026-07-06 (`device-intake.spec.ts` — create→index→edit→
  persist through the UI; full suite 57P/9S/1 known-fail DEVREQ-B1; zero active residue, created
  kits archived). **Next:** 5.3 (device-request lifecycle spec) on a fresh branch off dev.
  **5.3 blocker:** device requests have NO archive path and the UAT token can't `deleteDeviceRequest`
  (Access Denied) — so a lifecycle spec cannot auto-clean its records. 5.3 needs either a
  delete-capable token or an accepted manual-cleanup/residue policy before it can own its writes.
- **Follow-up queue (flagged, not yet scheduled):** dead `createApi` modals in
  `kit-component.html` / `user-index.html` (nonexistent handlers, see 3.2 notes); googlemaps
  trio removal in 6.4; self-hosting the Poppins font (6.x candidate).
- Remember: **branch fresh from dev for every PR** — stacking follow-ups on a squash-merged
  branch causes self-conflicts.
- **Last updated:** 2026-07-06

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
| [x] | 2.2 | Verified on UAT 2026-07-03: deployed suite 51P/9S/1F(known), zero CSP violations incl. kit-info Save interaction; two soak rounds fixed Typeform CORS, fonts, NGXS eval, formly string-expression eval (see notes below) | S | 20m | Sonnet |

**Second UAT soak finding (2026-07-03, caught by the deployed-UAT suite, fixed in follow-up #2):**
- ngx-formly evaluates STRING-valued expressions (`hideExpression`, `expressionProperties`
  values) via `new Function()` — blocked by the CSP, breaking conditional required/validation/
  hide behavior and kit-info Save on the deployed build. All 57 string expressions across 14
  components converted to arrow functions (CSP-safe). **Lesson: the first CSP probe only
  covered page loads; form *interactions* are where eval hides. The deployed-UAT suite caught
  it — concrete proof of the suite-as-deploy-gate goal.**
- E2E parallelism calibrated in the same PR: local config `workers: 2` (4 starved the dev-mode
  ng serve and produced timing flakes), deployed-UAT config `workers: 4` (4.3m → 3.4m). Future
  specs that write real UAT data must run serial or own their records (comment in config).

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
| [x] | 3.1 | Done 2026-07-03: `resetOnHide: false` on 8 fields (incl. `ramCapacity`, missed by the review) + red-first `kit-resetonhide.spec.ts` (@mocked). Red evidence: type toggle scrubbed `typeOfStorage` SSD→'' in the Save payload | M | 1–1.5h | Opus |
| [x] | 3.2 | Done 2026-07-03: 23 buttons / 14 templates → `warnIfFormInvalid()` + 2 red-first spec extensions. **New findings:** (a) several buttons guarded the WRONG FormGroup — kit-index quick-create silently fired with invalid data (fixed: guards now use the actually-bound form); (b) two never-openable `createApi` modals reference nonexistent handlers (`kit-component.html`, `user-index.html`) — dead template code, flagged for a follow-up delete; (c) components where `applyFilter()` has multiple internal callers got a guarded `applyFilterFromModal()` wrapper so quick-filter buttons aren't blocked | M | 1–2h | Sonnet |
| [x] | 3.3 | Done 2026-07-03: deleted `reports/`, `map/`, `map-view/` (393 lines) + route imports + commented blocks. Bonus finding for 6.4: `ngx-google-places-autocomplete` was already fully unreferenced (place field uses the proxy worker), and `@types/googlemaps` + `tsconfig.app.json` `"types": ["googlemaps"]` are now orphaned — remove all three together in 6.4 | S | 30m | Haiku |
| [x] | 3.4 | Done 2026-07-04: PDF URL → `environment.pdf_generator_url` (all 4 envs); lookup-failure toasts placed inside the upstream `catchError(() => of([]))` (the subscribe error callback would never fire) — 15 instances / 11 files; 5 date-format outliers → `date:'medium'`; native `confirm()` → styled NgbModal in 3 custom-notes + custom-kit-info-input (that one gates an edit → "YES, EDIT" primary) | M | 1h | Sonnet |

## Batch 4 — CI + lint gate (`ci:` PR)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [x] | 4.1 | Decided + proven 2026-07-04: **mocked-subset + self-minted token, zero secrets** — auth0-spa-js never verifies cached-token signatures and @mocked specs stub all GraphQL, so a fake JWT passes `e2e:fast` 12/12 (verified locally). UAT-data specs stay local/pre-merge; nightly UAT job deferred until a token-refresh secret strategy exists | S | 15m | Sonnet |
| [x] | 4.2 | Done 2026-07-04: `.github/workflows/ci.yml` — PR→dev gate with `build` (prod compile) + `e2e-mocked` (fake token → `e2e:fast`) jobs, report artifact on failure. The PR introducing it proves the gate fires | M | 1h | Sonnet |
| [x] | 4.3 | Done 2026-07-06 (#100): angular-eslint flat config + `npm run lint`; recommended TS/template rule sets with bulk legacy rules (`no-unused-vars`, `no-explicit-any`, `prefer-inject`, `template/eqeqeq`, a11y…) downgraded to a documented warn-baseline (~1.1k warnings, 0 errors); auto-fixables fixed (~50 files, incl. 96 `implements` lifecycle interfaces); hand-fixed the remainder; deleted dead `typings.d.ts`, `declare require` shims, stray `String;` stmt; `lint` job added to `ci.yml` | M | 1–2h | Sonnet |
| [x] | 4.4 | Done 2026-07-06: all 48 `test.skip(true,…)` already carried reasons (the review's "~90 with no reasons" was overtaken by batch 1–3 spec work) — remaining work was the gate: JSON reporter output in both Playwright configs + `e2e/check-skips.mjs` (skip breakdown w/ reasons → `$GITHUB_STEP_SUMMARY`, exit 1 if >40% skipped, `SKIP_RATIO_MAX` override) + an `if: always()` CI step after the mocked subset | S | 30m | Haiku |

## Batch 5 — E2E write-flow coverage (`test:` PRs, one per flow)

| Done | ID | Task | Cx | Time | Model |
|------|----|------|----|------|-------|
| [x] | 5.1 | Done 2026-07-06: `e2e/helpers/graphql.ts` (`UatGraphQLClient` — direct UAT API access, id tracking, delete-with-archive-fallback teardown) + `teardown-helper.spec.ts` round-trip smoke (self-skips on expired/fake token) + `data-testid`s on kit/donor/org/contact/device-request/user-roles create/save/delete controls. UAT token cannot hard-delete (Access Denied on all `delete*`) — teardown archives instead; deviceRequest is the exception (no archive path) | M | 1h | Opus |
| [x] | 5.2 | Done 2026-07-06: `device-intake.spec.ts` — real-UAT UI write-flow (quick-create modal → find by unique model in index → edit make/model on kit-info → Save → reload-persist), owns its record via `UatGraphQLClient.track`/archive teardown. **Findings:** create modal fires `quickCreateKit` (not `createKit`), captures only type/make/model — no serialNo, so identity = unique model string; DataTables search input is `input[aria-controls="kit-index"]`; UAT backend cold-starts ("Server is starting up" overlay) so specs must warm the API before driving the UI (added a beforeAll poll); a create that fires server-side but whose client `waitForResponse` misses leaks an untracked active record (track only after capture) — warm-up closes that race | M | 1–1.5h | Opus |
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
