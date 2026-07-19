---
name: dashboard-testing-and-e2e
description: Load BEFORE writing or changing any techaid-dashboard test, when deciding what evidence a change needs to count as done, when a Playwright spec fails and you need to know what it guards, or when adding a new spec and picking a pattern to copy. Covers the red/green rule from the issue-triage workflow, the two-tier @mocked/live-UAT Playwright suite, the certified spec inventory (what each spec pins and when you must extend it), the hygiene/cleanup tooling, known flakes, and the acceptance ladder from green CI to production.
---

# TechAid Dashboard — Testing & E2E

What counts as evidence in this repo, the Playwright test discipline every change must follow, and
the certified inventory of the 30 specs under `e2e/tests/` — what each pins and when you are required
to extend it. It adds depth to `CLAUDE.md`'s Testing and Issue Triage sections; it does not restate
them.

**When NOT to use this skill:** designing whether a diff violates a dashboard invariant →
`dashboard-architecture-contract`; triaging a live symptom before you know the cause →
`dashboard-debugging-playbook`; cutting a release or deploying → `dashboard-release-and-deploy`; the
GitHub issue-triage loop itself (this skill is what step 4 of that loop points at) →
`triage-issues`. API-side test discipline (zonky embedded Postgres, the Kotlin test inventory) lives
in techaid-server's `techaid-validation-and-qa` — a different suite, same red/green philosophy.

---

## 1. The evidence bar: red/green, non-negotiable

Per `CLAUDE.md`'s Issue Triage Workflow (step 4): **every bug fix ships a Playwright spec that failed
before the fix and passes after.**

1. Write the spec that reproduces the bug (or specifies the new behavior) under `e2e/tests/`.
2. Run it. **Watch it fail** for the right reason — not a syntax/compile error, not a missing fixture.
3. Implement the minimal fix.
4. Verify `ng build --configuration production` **and** the new spec both pass.
5. Keep the spec in the suite permanently — it becomes a certified inventory entry (§3).

`ng build --configuration production` is the **primary structural signal** — stricter than the dev
build or `ng serve` (per `CLAUDE.md`). A clean production build plus a green red/green spec is the
floor for "done"; a change without both is not done — do not open a PR for it.

Why this bar exists here specifically: many of the dashboard's worst bugs were **silent** —
`apollo-v4-mutation-regression` swallowed a `TypeError` inside a `.then()` chain and just left a table
empty; `detail-null-relationships` hung a tab on "Loading…" forever with no console error until you
knew to look; `issue-72-user-index-sort` rejected a GraphQL variable with no visible symptom besides an
empty users table. Only a pinning spec makes these failure classes loud on the next regression.

---

## 2. The two-tier suite

### `@mocked` — the fast, no-token subset (`npm run e2e:fast`)

Every GraphQL call is stubbed via `page.route('**/graphql', ...)`; a fake JWT is minted (or read from
`e2e/.auth/user.json`) so the Auth0 SDK and `AuthGuard` are satisfied without a real login or a real
token. **Needs no bearer token, no UAT network access.** This is what CI runs
(`.github/workflows/ci.yml`, job `e2e-mocked`): it mints a synthetic-but-well-formed JWT inline (see
the workflow step "Mint fake token for the mocked subset" — `auth0-spa-js` never re-verifies the
signature of a *cached* token, only its structure and expiry), saves it via `save-token.mjs`, then runs
`npm run e2e:fast` (`playwright test --grep @mocked`). Specs opt in by tagging their `test.describe`
title literally with `@mocked` (e.g. `test.describe('kit-info conditional-field value retention
@mocked', ...)`).

Two helpers keep the mocked suite hermetic (no real network ever leaves the machine):
- `e2e/helpers/places-proxy.ts` (`stubPlacesProxy`) — routes the Google-Places-proxy Worker host so
  typing into the booking address field never fires a real debounced GET. The directive under test
  swallows request errors, so a *missed* stub wouldn't fail loudly — it would just quietly leak a
  request off the test machine. Call it before navigating to any booking flow.
- Turnstile is stubbed by pre-defining `window.turnstile` via `page.addInitScript` **before**
  navigation (`turnstile.service.ts`'s `load()` resolves immediately if it already exists), so
  `challenges.cloudflare.com` is never hit either.

### Live-UAT suite (`npx playwright test`)

Runs the full suite (minus `@live-smoke`, see below) against real UAT data. Needs a genuine bearer
token in `e2e/.auth/user.json`, saved via:

```bash
E2E_BEARER_TOKEN=<token> node e2e/save-token.mjs
```

Get the token from a logged-in dashboard session: DevTools → Application → Local Storage → the Auth0
access token. Tokens expire in **~2h**. `save-token.mjs` decodes the JWT and synthesizes the exact
`auth0-spa-js` v2 cache shape (wrapped access-token entry, unwrapped id-token entry, the
`auth0.<clientId>.is.authenticated` cookie) so the SDK treats it as a real cached session — it writes
**two** storageStates: `e2e/.auth/user.json` (localhost, used by `playwright.config.ts`) and
`e2e/.auth/uat-deployed.json` (the deployed UAT origin, used by `playwright.config.uat.ts`).

`playwright.config.ts`'s `webServer` auto-starts `ng serve --configuration uat-local`, which proxies
`/graphql` (and `/auth`) to `api-testing.communitytechaid.org.uk` via `src/proxy.conf.uat.json` — this
sidesteps CORS (the API rejects `Origin: http://localhost:4200` directly). Many specs go further and
inject the `Authorization` header themselves via `page.route('**/graphql', ...)` (the
`withAuthInterceptor` pattern repeated across most non-`@mocked` specs) so even the **first** request —
which can fire before the Auth0 SDK finishes initializing — is authenticated, avoiding a startup 403
race.

`playwright.config.uat.ts` is a second config that skips the local `ng serve` entirely and drives the
**already-deployed** `app-testing.communitytechaid.org.uk` origin directly, using
`e2e/.auth/uat-deployed.json`. It `testIgnore`s `tabs-debug.spec.ts` (see §5) and sustains 4 workers
(no local dev-server bottleneck) vs. 2 for the default config.

**Never commit anything under `e2e/.auth/`.**

### Parallelism

`fullyParallel: false` in both configs — files run on parallel workers (2 default, 4 for
`.uat.ts`/CI), but tests *within* a file run in order. Calibrated 2026-07-03: 4 workers against
dev-mode `ng serve` starved it and produced timing flakes (BUG-14, issue-72) with no net speedup; the
deployed-UAT config has no such bottleneck. Safe today because no spec performs unscoped real UAT
writes — every write-flow spec owns and tears down exactly the records it creates (§4).

### `@live-smoke` — opt-in only, never runs by default

`live-booking-smoke.spec.ts` drives the full public booking flow against the **deployed** UAT origin
and creates a real booking + sends a real email. Both configs inspect `process.argv` and only install
`grepInvert: /@live-smoke/` when the invocation did **not** already explicitly request `@live-smoke`
via `--grep`/`-g` — a static `grepInvert` would permanently exclude it even from an explicit opt-in,
since Playwright ANDs the config-level grep with the CLI's. Run it explicitly:

```bash
npx playwright test --config playwright.config.uat.ts live-booking-smoke --grep @live-smoke
```

---

## 3. The certified spec inventory

All 30 files under `e2e/tests/`. Do not delete or weaken any of these without understanding what
regression it re-opens.

| Spec(s) | What it pins | Tag | Extend when… |
|---|---|---|---|
| `smoke.spec.ts`, `navigation.spec.ts`, `age-column-hidden.spec.ts` | App shell loads authenticated (not bounced to Auth0), no unexpected Angular console errors, key routes (`/dashboard`, `/dashboard/devices`, `/dashboard/donors`) render a table/heading; the removed "Age" column never reappears on the device table. | live UAT (no explicit tag) | Adding a new top-level route that must always render, or a column-removal regression. |
| `tabs.spec.ts` | ngb-tabset → ngb-nav migration: all 10 migrated templates' tabs render and switch. | live UAT | Migrating another tab implementation, or tabs regress after a template change. |
| `tabs-debug.spec.ts` | Diagnostic/debug spec for detail-page navigation with the auth interceptor — not a pinned regression contract. **Known flaky** (§5); excluded via `testIgnore` in `playwright.config.uat.ts`. | live UAT | Rarely — treat a solo failure here as noise, not a signal. |
| `apollo-v4-mutation-regression.spec.ts` | Apollo v4 frozen-response mutation bug (issue #39): `user-permissions.component.ts` must `.map()`+spread, never `forEach`+assign, onto a frozen query result. | live UAT | Any new table code that derives rows from a GraphQL response. |
| `bugs.spec.ts` | Post-upgrade regression batch (BUG-01 Settings dropdown, and siblings) — each sub-test written to fail before its fix, pass after. | live UAT | A new bug in the same post-upgrade batch is found; add a `BUG-NN` block rather than a new file. |
| `kit-resetonhide.spec.ts`, `kit-locked-status.spec.ts`, `kit-required-field-feedback.spec.ts` | kit-info Formly hardening trio, all against a shared mocked `KIT_BASE` fixture: (a) conditional hardware-attribute fields must not lose their value on hide/show (Formly `resetOnHide` scrub); (b) the five `subStatus.*` lock flags keep checkbox-checked + status-radios-disabled + banner-visible in sync (four historical regressions layered onto one test — Apollo freeze, resetOnHide, an `@if` race, a dual-binding bug); (c) Save stays clickable and shows a bounded toast naming missing required fields instead of silently disabling (issue #49). | `@mocked` | Any new conditional/value-bearing Formly field on kit-info, or a new locked-status flag. |
| `save-button-clickable.spec.ts` | The `[disabled]="form.invalid"` → `warnIfFormInvalid` sweep applied beyond kit-info: device-request-info and post-info stay clickable and fire no mutation on an invalid submit. | `@mocked` | Sweeping the same pattern into another form (device-request-info/post-info are done; ~23 index-page create/filter buttons were swept too per the file header — see also the adjacent-pattern note in issue #49's triage comment). |
| `issue-38-long-error-toast.spec.ts` | `updateDeviceRequest` error toast is capped at ~200 chars with a "…(full error in console)" suffix; the full error still goes to `console.error`. | `@mocked` | Any new error-toast call site that could surface a large raw GraphQL error array. |
| `issue-72-user-index-sort.spec.ts` | The `users` resolver sort quirk: `user-index`/`role-users` must send `sort[].value` as **string** `'1'`/`'-1'`, not `'asc'`/`'desc'` and not integer `1`/`-1` — the original #72 bug was the integer form. | live UAT | Touching `user-index`/`role-users` sort wiring — see `dashboard-architecture-contract` §5 for why this must NOT be "consistency-fixed". |
| `detail-null-relationships.spec.ts` | User/role detail tabs must not null-deref-crash when the backend returns `null` for nested `roles`/`permissions`/`users` (server `@SchemaMapping` gap, fixed server-side in techaid-server PR #36, hardened here in dashboard PR #75). Forces the fields to `null` via response rewriting so it reproduces deterministically even after the backend fix. | live UAT | Any new nested-relationship field rendered on a detail tab. |
| `audit-system-label.spec.ts` | The Audit "Who" column shows "System" (not blank) for automated revisions with `customUser: "\|"`. `getAuditTrail` response is stubbed so the assertion doesn't depend on UAT happening to have an automated revision. | live UAT (env-gated — sandbox host allowlist blocks `api-testing`) | Adding a new synthetic/automated audit actor. |
| `exclude-status-filter.spec.ts` | The kit-index "Exclude statuses" multi-select (issue #64): selected statuses push `_neq` constraints onto `filter.AND` and excluded rows drop out server-side. | live UAT (env-gated) | Extending kit-index's filter form with another exclude-style control. |
| `referee-notes.spec.ts` | Referee detail page renders the notes UI (add-note textarea label + notes-list container attached) — a wiring smoke check, not a content assertion (an empty notes list is a legitimate zero-height state). | live UAT (env-gated) | Changing the referee notes component's DOM structure/selectors. |
| `donor-onpush.spec.ts` | `donor-index`, the sole `ChangeDetectionStrategy.OnPush` pilot, calls `cdr.markForCheck()` in both places state mutates outside the host template's event tree: the DataTables ajax callback (rows paint) and `applyFilter()` from the NgbModal footer (filter-count badge paints). | `@mocked` | Converting another component to OnPush — copy this spec's shape for the new component's async paint paths. |
| `device-intake.spec.ts` (5.2), `device-request-lifecycle.spec.ts` (5.3), `donor-crud.spec.ts` (5.4), `org-referee-crud.spec.ts` (5.5), `user-role-assign.spec.ts` (5.6), `teardown-helper.spec.ts` | **Batch 5 live-UAT write-flow family** — real create→index→edit→persist(→delete) round-trips through the UI against real UAT data: kit quick-create, a full device-request lifecycle (create fixtures → assign devices → status transitions → complete), donor CRUD with a 3-way delete-outcome branch, org+referee CRUD, and a user role assign/unassign restricted to the test account's own `METRICS_USER` role. `teardown-helper.spec.ts` is the round-trip smoke test for the shared teardown helper itself (`e2e/helpers/graphql.ts`), not a product-behavior spec. | live UAT (not `@mocked` — needs a real, unexpired token) | Any new admin CRUD write flow — copy the OWNS-its-records + `UatGraphQLClient` teardown pattern (§4, §7 pattern C). |
| `delivery-booking-public.spec.ts`, `delivery-booking-flag-gating.spec.ts`, `delivery-booking-address-autocomplete.spec.ts`, `delivery-booking-admin-delete.spec.ts`, `delivery-slots-badges.spec.ts` | **delivery-booking family** (2026-07 booking hardening) — the public flow's Turnstile gate + single-use-token reset on error + `BookingApiError` classification contract; feature-flag visibility/preview-banner gating; Places autocomplete as a pure non-gating suggestion aid (free text always valid, a failing proxy degrades silently); the admin per-booking delete control (`deleteDeliveryBooking`, not yet deployed to UAT hence mocked-only); and the Delivery Slots tab's matched/unmatched/closed booking badges. | all `@mocked` | Any change to `booking-flow.component`, `details-step.component`, `booking-api.service`, `feature-flag.service`, `delivery-slots.component`, or `place-autocomplete.directive`. |
| `live-booking-smoke.spec.ts` | Real end-to-end booking against the **deployed** UAT origin — real availability, real Turnstile round-trip (UAT's siteKey is Cloudflare's always-pass test key), a real `submitDeliveryBookingPublic` write + confirmation email. Catches the class of bug the mocked spec structurally cannot (CSP stripping the widget, FE/BE schema drift, real-availability edge cases). | `@live-smoke` (excluded by default, §2) | Any change that could only break against the real deployed server/CSP — run it manually before/after such a deploy. |

Grouped 30 files into 14 table rows; the Batch 5 and delivery-booking families are each one row
because they share fixtures, teardown pattern, and incident (see §7 for their exemplar files
individually when copying a pattern).

---

## 4. Helpers and hygiene

- **`e2e/helpers/graphql.ts`** (`UatGraphQLClient`) — the Batch 5 write-flow spine. Wraps
  Playwright's Node-side `APIRequestContext` with the saved bearer token, exposes `.request()` for
  arbitrary GraphQL, `.track(kind, id)` to register a record for teardown, and `.cleanup()`/`.dispose()`
  to remove it. **Important finding (2026-07-06):** the UAT test token has write/admin scopes but
  **no delete authority** — every `delete*` mutation returns "Access Denied" for it. Teardown therefore
  hard-deletes first, falls back to archiving (`archived: true`) for donor/kit/org/contact, and — for
  `deviceRequest`, which has neither an archive flag nor a safe minimal update payload — accepts the
  residue as policy, logging it rather than failing the spec. If a delete-capable token is ever
  supplied, the hard-delete path just works with no code change.
- **`e2e/helpers/sample-data.ts`** — every write-flow record is named `"<Entity> E2E Sample
  <timestamp>"` (`sampleName()`), sharing the single `E2E Sample` marker so all test residue is
  findable/bulk-removable in one pass regardless of entity type.
- **`e2e/helpers/places-proxy.ts`** — see §2 (`stubPlacesProxy`).
- **`e2e/cleanup-residue.mjs`** (`npm run e2e:cleanup`) — finds and (with `--delete`) hard-deletes every
  UAT record whose identifying field contains the `E2E` marker, across donor/kit/org/contact/
  deviceRequest. Dry-run by default; only ever touches records matching that marker (real CommunityTechAid
  records never do), and only ever talks to `api-testing` (UAT), never prod. Run it periodically to
  clear write-flow residue, or immediately after a crashed Batch 5 run.
- **`e2e/check-skips.mjs`** — reads the Playwright JSON report, prints a pass/fail/skip/flaky
  breakdown + skip reasons, and **fails (non-zero exit) if skipped share exceeds 40%**
  (`SKIP_RATIO_MAX`, default 0.4) — a suite that silently degrades into skips stops being a gate. Runs
  in CI with `if: always()` so the summary lands even when tests fail; its own exit code never masks
  the test result.
- **`e2e/csp-probe.mjs`** — not part of CI or the default suite; a standalone post-deploy check for the
  public booking page's CSP + Turnstile on a **real deployed origin** (`ng serve` never sends CSP
  headers, so no other spec can catch a CSP regression). Run after any change to
  `staticwebapp.config.json` or the Turnstile integration, once the deploy has rolled out:
  ```bash
  node e2e/csp-probe.mjs https://app.communitytechaid.org.uk   # prod
  node e2e/csp-probe.mjs                                       # UAT (default)
  ```
  Exit 0 = Turnstile `api.js` loaded, challenge iframe attached, zero CSP violations. Deploy-verification
  depth → `dashboard-release-and-deploy`.
- **`e2e/tests/teardown-helper.spec.ts`** — see §3; it is the regression cover for the helper above,
  not for product code.

---

## 5. Known flakes & gotchas (operational, as of 2026-07)

- **`tabs-debug.spec.ts` is a known flaky diagnostic spec** — a solo failure there is not a regression
  signal; `playwright.config.uat.ts` excludes it outright via `testIgnore`.
- **NgbModal button `textContent` is whitespace-padded** — a template like `<button>\n  Filter\n
  </button>` yields `textContent = "\n  Filter\n  "`. An anchored `hasText: /^filter$/i` will not
  match; use a plain substring (`hasText: 'Filter'`) or an unanchored regex.
- **ng-select dropdowns render in an overlay**, not inside the visual control — click the
  `.ng-option` in the overlay, and note the `.ng-dropdown-panel` can stay open afterward and obscure a
  subsequent click (e.g. a modal footer button); dismiss with `Escape` and wait for it to hide first.
- **`device-request-index` applies a default `{is_sales:[false]}` filter** even after clearing
  localStorage — the component falls back to the default. Get a true unfiltered view by setting
  `deviceRequestFilters-device-request-index` to `{}` via `page.addInitScript` before the component
  boots.
- **A wave of Auth0-redirect failures on code you didn't touch is almost always an expired token**, not
  a regression — live tokens last ~2h. Re-save (`E2E_BEARER_TOKEN=<fresh> node e2e/save-token.mjs`) and
  re-judge before assuming a real break. If `npm run e2e:fast` is green but the live suite fails broadly
  on auth, it's the token.
- **UAT data isn't guaranteed internally consistent** — e.g. a request can show a device badge on the
  index while its own detail page shows "No Devices Assigned" for a one-directional relationship. Don't
  assume a spec picking "the first row" will find a self-consistent record; either target a
  spec-owned fixture (Batch 5 pattern) or tolerate/skip.

---

## 6. Acceptance ladder

1. **Green `ng build --configuration production`** — the primary structural signal (§1).
2. **Green `npm run e2e:fast`** (the `@mocked` subset) — what CI's `e2e-mocked` job runs on every PR
   into `dev`; needs no secrets (verify: `.github/workflows/ci.yml` mints its own fake token inline).
3. **Green skip-hygiene check** (`node e2e/check-skips.mjs`) — CI runs this even on failure; a >40%
   skipped suite is itself a failure.
4. **Relevant live-UAT specs green against `api-testing`** — run locally pre-merge with a fresh token;
   required whenever the change touches anything a non-`@mocked` spec exercises (per `CLAUDE.md`'s
   Testing section, these are not run in CI).
5. **UAT smoke by a human** (and, for booking-flow changes, `@live-smoke` against the deployed origin)
   before shipping.
6. **Release** → `dashboard-release-and-deploy` (release-please PR merge, `Deploy to Production SWA`,
   post-deploy `csp-probe.mjs`).

CI gates on steps 1–3 only (`lint`, `build`, `e2e-mocked` jobs in `.github/workflows/ci.yml`); steps 4–6
are human/manual per the workflows described in `CLAUDE.md`.

---

## 7. Adding a spec — pick the right pattern

**A. Mocked regression pin (milliseconds, CI-gated).** Exemplar: `kit-resetonhide.spec.ts` (a fixture
object + `page.route` stubs for every mutation the flow touches, no live dependency at all).
- [ ] `test.describe(title + ' @mocked', ...)` — the literal tag string, not a Playwright `tag` option.
- [ ] Stub every GraphQL operation the flow reaches, including ones you don't assert on (an unstubbed
      request either hangs the test or leaks off-machine — see `stubPlacesProxy`'s header comment).
- [ ] If the flow touches the booking address field or Turnstile, reuse `stubPlacesProxy` /
      the `addInitScript` `window.turnstile` stub rather than re-deriving them.

**B. Live-UAT read-only regression pin.** Exemplar: `issue-72-user-index-sort.spec.ts` (auth
interceptor + assert on the real resolver's response/error, no writes).
- [ ] Copy the `getBearerToken()` + `withAuthInterceptor(page)` pattern (reads the token straight out
      of `e2e/.auth/user.json`'s storageState) rather than re-deriving it.
- [ ] Guard with a token-availability check if the spec can plausibly run with the CI fake token
      (`teardown-helper.spec.ts`'s `uatTokenUnavailable()` is the template — self-skip with a clear
      reason rather than fail noisily).

**C. Live-UAT write-flow with cleanup.** Exemplar: `donor-crud.spec.ts` (5.4).
- [ ] Use `UatGraphQLClient.create()` / `.track(kind, id)` / `.dispose()` in `beforeAll`/`afterAll` —
      never leave a record untracked.
- [ ] Name every created record via `sampleName('Entity')` so residue is identifiable and
      `cleanup-residue.mjs` can sweep it.
- [ ] Assume delete is denied for the current token — assert the archived/hidden end state, not a hard
      "record is gone" 404, unless you've confirmed this token can hard-delete that entity.
- [ ] The spec OWNS only what it creates — never archive/delete a pre-existing UAT record picked off a
      list.

Checklist for every new spec regardless of pattern:
- [ ] It failed first, for the stated reason (§1) — note this in the PR description.
- [ ] Correctly tagged (`@mocked` in the title, or deliberately untagged for live-UAT, or `@live-smoke`
      for a real-write smoke test) — an untagged spec that should be `@mocked` will run in CI against a
      fake token and either hang or fail for the wrong reason.
- [ ] Whitespace-tolerant / overlay-aware selectors (§5) if it touches a modal button or ng-select.
- [ ] `ng build --configuration production` still passes.

---

## Coverage posture (honest, as of 2026-07-19)

- No coverage-percentage tooling is wired into this suite (unlike techaid-server's JaCoCo report) —
  the certified inventory in §3 is the coverage signal: a behavior with no row in that table has no
  pinning spec.
- Several env-gated specs (`audit-system-label.spec.ts`, `exclude-status-filter.spec.ts`,
  `referee-notes.spec.ts`) cannot run inside the sandbox host allowlist used for some automated runs —
  they still count as certified (they ran and passed at authoring time against real UAT) but need a
  human or an unblocked environment to re-verify.
- `tabs-debug.spec.ts` is a diagnostic scratch spec, not a certified pin (§3, §5) — don't count it
  toward coverage or chase its flakes as regressions.

---

## Provenance and maintenance

Authored 2026-07-19 against branch `docs/dashboard-skill-library`, from direct reads of all 30 files
under `e2e/tests/`, `e2e/helpers/*.ts`, `e2e/*.mjs`, `playwright.config.ts`, `playwright.config.uat.ts`,
`package.json`, and `.github/workflows/ci.yml`.

Re-verify before trusting volatile facts:

```bash
ls e2e/tests/*.spec.ts | wc -l                                  # inventory drift (30 as of 2026-07-19)
grep -rn "@mocked\|@live-smoke" e2e/tests | grep "test.describe" # which specs carry which tag
grep -n "SKIP_RATIO_MAX\|threshold" e2e/check-skips.mjs          # skip-hygiene ceiling
grep -n "jobs:" -A2 .github/workflows/ci.yml                    # what CI actually gates on
npm run e2e:fast                                                # the mocked subset, ground truth
node e2e/check-skips.mjs test-results/results.json              # skip-hygiene after any local run
```
