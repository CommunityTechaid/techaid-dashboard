---
name: dashboard-architecture-contract
description: Load BEFORE designing any change to techaid-dashboard — adding or editing an Apollo query/mutation, a table (`cta-table` native shell) component, a Formly form, an NGXS slice, the GraphQL client wiring, an environment/proxy config, a change-detection strategy, the CSP, or the cta-places-proxy Worker — and whenever judging whether a diff is safe. Explains the load-bearing design decisions (fully-standalone zoneless Angular 22 + esbuild, Apollo v4 frozen responses, Formly resetOnHide, the users-sort quirk, zoneless change detection, CSP-constrained NGXS, the manually-deployed Places Worker) with the WHY behind each, the invariants a diff must not break, and the known weak points. Use it to answer "will this change violate how the dashboard is supposed to work?"
---

# TechAid Dashboard — Architecture Contract

This skill is the contract: the design decisions the dashboard depends on, why they exist, the
invariants every change must preserve, and the weak points that are known and accepted (several
look like bugs but are deliberate — do not "fix" them casually). It adds depth to
`CLAUDE.md` (the always-loaded contract); it does not restate it.

**The system in one paragraph:** `techaid-dashboard` is an Angular 21, fully-standalone, esbuild-built
SPA — the admin dashboard for Community TechAid, plus a public delivery-booking flow. It talks to the
Kotlin/Spring GraphQL API (`techaid-server`) over a single `/graphql` endpoint via Apollo Angular v13
(`@apollo/client` v4), holds a thin slice of state in NGXS v21, renders dynamic admin forms with
ngx-formly v7, and authenticates against a real Auth0 tenant (even in dev). It ships to Azure Static
Web Apps, which serves the app and its Content-Security-Policy. One small Cloudflare Worker
(`cta-places-proxy`) keeps a billed Google API key server-side for the address fields.

## When NOT to use this skill

- Chasing a live bug / error symptom in the running app → `dashboard-debugging-playbook`
- Writing tests, Playwright specs, the red/green rule → `dashboard-testing-and-e2e`
- Cutting a release, deploying, deploying the Worker → `dashboard-release-and-deploy`
- Triaging open GitHub issues (the triage loop) → `triage-issues`
- What a kit/device-request/status/scope *means* (domain), or the public-form business rules →
  techaid-server's `techaid-domain-reference`
- Whether an API-side change is safe (resolver auth, schema, migrations) → techaid-server's
  `techaid-architecture-contract`

(The two cross-repo skills live in `D:\Code\techaid-server\.claude\skills\`.)

## Glossary (terms used below, defined once)

| Term | Meaning |
|------|---------|
| Standalone | Angular components/providers with **no NgModules** — the app is 100% standalone (P11 of the 2026 upgrade) |
| esbuild builder | `@angular/build` application builder; `ng build` uses esbuild, not Webpack |
| Frozen response | Apollo v4 deep-freezes query result objects; writing to one throws |
| Formly type | A custom field renderer registered in `FORMLYCONFIG` (e.g. `choice`, `place`, `date`) |
| `cta-table` | The native, signal-based table shell (`src/app/shared/modules/native-table/`); the host passes a `source` function and a `ctaRow` template, the shell owns paging, sort, search, info line and saved state. It replaced jQuery DataTables (#113); DataTables-style class names (`dt-container`, `dt-paging`, ...) are kept on purpose |
| Zoneless | The app runs with `provideZonelessChangeDetection()` and no zone.js (#115, 2026-11-11): a view repaints only when a signal it reads changes, `markForCheck()` is called, an `async` pipe emits, a template event fires, or an input changes |
| version triple | `{version, build, commit}` in `version.ts`, stamped by CI — identifies one UAT build |
| Places proxy | `cta-places-proxy` Cloudflare Worker fronting Google Places for address autocomplete |
| SWA | Azure Static Web Apps — the prod/UAT host; serves `staticwebapp.config.json` headers/CSP |

---

## 1. The stack (verified against `package.json`, 2026-11-11)

| Concern | Choice | Version | Where |
|---|---|---|---|
| Framework | Angular, **fully standalone**, esbuild, **zoneless** | `@angular/*` 22.2 | app-wide (`src/main.ts`) |
| GraphQL client | Apollo Angular / `@apollo/client` | `apollo-angular` 14, `@apollo/client` 4.3 | `src/app/graphql.module.ts` |
| State | NGXS | 22 | `src/app/state/` |
| UI | ng-bootstrap + Bootstrap | 21 / 5.3 | throughout |
| Dynamic forms | ngx-formly | 11.1 | `src/app/shared/modules/formly/` |
| Tables | native `cta-table` shell (no jQuery) | — | `src/app/shared/modules/native-table/`; styles in `native-table.css` |
| Auth | `@auth0/auth0-angular` | 2.15 | `src/app/shared/services/authentication.service.ts` (hardcoded client id/domain, **real tenant in dev**) |
| Feature components | ~40 component files | — | `src/app/views/corewidgets/components/` |

The Angular 20→21 standalone + esbuild migration (roadmap P1–P11) completed **2026-05**; there are no
NgModule classes in app code, and providers are wired via `provideStore` / `provideRouter` /
`provideAuth0` / `provideToastr` / `provideFormlyConfig`. **Invariant: keep it standalone — do not
reintroduce `@NgModule`.**

Environments live in `src/environments/`: `environment.ts` (dev), `.uat.ts`, `.uat-local.ts`,
`.prod.ts`, plus `version.ts`. `version.ts` is stamped by CI (`export const APP_VERSION = {version,
build, date, commit}`); the `version`/`build`/`commit` triple is the only thing that distinguishes one
UAT build from another (the semver only moves on a release — see `CLAUDE.md`).

---

## 2. Invariant: never mutate an Apollo result in place

`@apollo/client` v4 **deep-freezes** every query result object. Writing a property back onto a response
row (`row.foo = x`) throws `TypeError: Cannot assign to read only property`. The throw usually happens
inside a `refetch().then(...)` / table `source` callback, where it rejects the whole chain **silently**
— an error toast may flash, then the table renders empty and the user reports "doesn't load".

**The rule:** clone-then-derive with `.map()` + object spread; never `forEach` + assignment.

```ts
// RIGHT — device-request-component.component.ts:364
this.entities = data.content.map(d => { /* … */ return { ...d, types }; });
// WRONG
data.content.forEach(d => { d.types = {}; });   // throws on the frozen row
```

Pinned by `e2e/tests/apollo-v4-mutation-regression.spec.ts` (issue #39). Historically-fixed sites:
`user-permissions.component.ts`, `reports.component.ts`, `device-request-component`, `kit-component`.
When a table "loads empty" with no obvious error, suspect an in-place mutation first.

---

## 3. GraphQL client wiring (`src/app/graphql.module.ts`) — load-bearing

The single Apollo client is built in `createApollo`. Three behaviours are deliberate and must be kept:

- **Auth link** — `setContext` fetches a fresh bearer token per request via
  `authService.getTokenSilently$({ audience })`, after `isAuthenticated$` has settled. When the token
  fetch fails, the outcome depends on who and where:
  - **Genuine anonymous visitor** (`isAuthenticated` false): the request goes out tokenless; the
    public resolvers accept it. Never a redirect (the 2026-07-28 incident).
  - **Cached identity on a public page** (`isStaffArea()` false — the request form, delivery booking,
    equalities preview, CMS posts): a re-auth error (`login_required` / `consent_required` /
    `missing_refresh_token`) or a dead refresh token (`invalid_grant` after one retry) sends the
    request tokenless, exactly like an anonymous visitor. **Never a redirect.**
  - **Staff area** (`/`, `/dashboard/**`, `/device-request-admin`): a re-auth error or dead refresh
    token redirects to login **once** (guarded by `reauthInProgress`) and fails the request. Any
    other failure is retried, then fails the request. **Never sent tokenless** — a downgraded staff
    request is the silent "Access Denied" bug (#164).
- **Error link** — only an **HTTP 401**, and only **in the staff area**, triggers re-login. On a public
  page a 401 (the API rejecting a stale token the browser still holds) just fails the request; the
  page's own retry/error UI handles it. A GraphQL-level `Access Denied` (HTTP 200, no `statusCode`) is
  deliberately left alone everywhere: it can be a real permission denial for an authenticated user,
  and redirecting on it would cause a login loop. **Do not "simplify" this to redirect on any auth
  error.** Pinned by `expired-session-redirects-to-login.spec.ts`, `invalid-grant-reauth.spec.ts`,
  `auth-link-no-anonymous-downgrade.spec.ts` and `anon-public-request-no-login-redirect.spec.ts`.
- **Cache** — `new InMemoryCache()` with **no `typePolicies`**. Lists are re-fetched, not normalized-
  merged. Adding type policies / field merge functions is an architectural change with real cache-
  identity risk, not a tuning knob — treat as such.

The endpoint comes from `config.environment.graphql_endpoint` (per-env, see §7).

---

## 4. Invariant: Formly `resetOnHide` on value-bearing conditional fields

ngx-formly v7 defaults to `resetOnHide: true`: when a field's `hideExpression` flips to hidden,
Formly scrubs its value out of the model (and, with a falsy `defaultValue` like `''`, the scrub can
fire during the **first** build cycle even for fields that end up visible). A later save then persists
blanks.

**The rule:** any conditional (`hideExpression`) field whose value must survive hide/show sets
`resetOnHide: false` per field (and drops any bogus `defaultValue: ''`). Patching the model after load
does **not** work — the scrub precedes the patch.

The only file that needs this today is `kit-info.component.ts` (the `subStatus.*` lock checkboxes and
the hardware-attribute fields). Pinned by `e2e/tests/kit-resetonhide.spec.ts`. Custom field types are
registered centrally in `src/app/shared/modules/formly/index.ts` (`FORMLYCONFIG.types` —
`mask`/`percentage`/`number`/`choice`/`repeat`/`richtext`/`place`/`gallery`/`date`/`datetime`/`button`);
register new types there, not ad hoc. Types are NOT registered at bootstrap: `formlyTypesGuard` (`formly/formly-types.guard.ts`) dynamically imports `formly/formly-setup.ts`, which writes everything (incl. the note/kit custom types) into the root `FormlyConfig`, before any route in the guarded group of `core-widgets.routes.ts` activates. A new route that renders a `<formly-form>` (directly or via a child component) MUST go in that group or it throws `[Formly Error] The type "x" could not be found`; a new custom type goes in `formly-setup.ts` or `FORMLYCONFIG`. Pinned by `formly-types-lazy.spec.ts` and the Formly-error check in `e2e/helpers/csp.ts`.

---

## 5. Invariant: the `users` table sort format is deliberately different

Every paginated table sends `sort[].value` as `"asc"` / `"desc"` — **except the Users tables**
(`user-index`, `role-users`). The backend `users` resolver (an Auth0 Management API proxy) validates
`key:value` against `^field:(1|-1)$` and requires `value` as a **String**, so those two components send
`value: (o.dir == 'asc') ? '1' : '-1'` (`user-index.component.ts:121`).

- Sending the integer `1`/`-1` → `Expected a String input, but it was a 'Integer'` (the original #72 bug).
- "Consistency-fixing" it to `o.dir` → `String does not match pattern ^field:(1|-1)$`.

**Do NOT normalize this to match the other tables.** The inconsistency is server-side and per-resolver.
Pinned by `e2e/tests/issue-72-user-index-sort.spec.ts`.

---

## 6. Invariant: zoneless change detection — every async state write must notify

Since #115 (PRs #362, #363; 2026-11-11) the app runs with `provideZonelessChangeDetection()` and
zone.js is not loaded (`e2e/tests/zoneless.spec.ts` fails if `Zone` reappears on `window`). Nothing
re-checks the page "after anything happens" any more. A view repaints only when a signal it reads
changes, `markForCheck()` marks it, an `async` pipe emits, a template event listener fires on it, or
an input changes.

**The rule:** template-bound state written from an Apollo/rxjs `subscribe`, `.then`, `setTimeout`,
`addEventListener`, a third-party callback, or an NgbModal footer must be a `signal()` or be followed
by `cdr.markForCheck()`. Prefer signals for new code. About 22 components are `OnPush`, the rest are
`ChangeDetectionStrategy.Eager` (default) — under zoneless **Eager is not a safety net**: it is only
refreshed when something notifies.

Load-bearing details (checked in the Angular source during #115):

- `markForCheck()` marks the view and all ancestors, so a mark anywhere tends to repaint the whole
  default-CD tree; a missing mark therefore often hides until a page has nothing else going on.
- **NgbModal content is its own view root.** A modal-footer click does not mark the host, and the
  host's `markForCheck()` does not reach the modal: host state set from a footer (e.g. `applyFilter`
  → filter badge) needs the host's own mark; state shown *inside* a modal and written async needs
  signals (device-request-info's assign-devices modal).
- **The repaint runs after the event, not inside it.** A `[value]` binding to state that the same
  input also edits can write an old value over newer typing (the `cta-table` search box bug fixed in
  #363 by binding a separate `boxText` signal). Don't bind an input's `[value]` to derived/applied
  state the user is still editing.
- Formly 11 handles NoopNgZone itself and marks a field when a `props`/`templateOptions` key that
  existed at build time changes (covers the typeahead `items` subscriptions). Keys added after the
  field is built are not watched. Keyless template fields' `hide` can land a frame after sibling
  `props` changes — poll in specs, don't read once.
- Third-party libraries (ng-bootstrap 21, ng-select, ngx-toastr, apollo-angular 14, NGXS 22,
  auth0-angular 2.15) were checked for `onStable`/`onMicrotaskEmpty` reliance: none. The Turnstile
  widget (booking page; `csp-probe.mjs` PASS on zoneless UAT 2026-11-11) and the Typeform equalities
  embed (pinned by a `streamlined-ward-lookup.spec.ts` case) were verified after the switch.

Specs that pin this: `zoneless.spec.ts`, `donor-onpush.spec.ts`, `onpush-fanout.spec.ts`,
live `onpush-live-repaint.spec.ts`. The per-file audit is `docs/native-tables-plan.md` §5 "Z1 audit".

---

## 7. Environments, proxies, and the API dependency

`graphql_endpoint` is per-environment:

| Env file | `graphql_endpoint` | How it reaches the API |
|---|---|---|
| `environment.ts` (dev, `ng serve`) | `/api/graphql` | `src/proxy.conf.json`: `/api` → `http://localhost:8080` (techaid-server `docker compose` API), strips `/api` |
| `environment.uat-local.ts` (Playwright) | `/graphql` | `src/proxy.conf.uat.json`: `/graphql` + `/auth` → `https://api-testing.communitytechaid.org.uk` (sets `Origin` to dodge CORS) |
| `environment.uat.ts` | `/graphql` | UAT SWA same-origin |
| `environment.prod.ts` | `https://api.communitytechaid.org.uk/graphql` | direct |

Consequences a dashboard dev must hold:

- **Dev without the Docker API:** Auth0 login still works (real tenant), but every GraphQL query fails
  with network errors — lists render empty/errored. This is expected, not a bug.
- The `uat-local` serve config (in `angular.json`) swaps in `environment.uat-local.ts` and
  `proxy.conf.uat.json`; Playwright uses it so specs run against **real UAT data**. Specs additionally
  inject the `Authorization` header via `page.route()`.

---

## 8. The Places Worker & the CSP are coupled — keep all three in sync

`workers/cta-places-proxy/` (`wrangler.toml` + `src/index.js`) is the **source of truth** for a
Cloudflare Worker that fronts Google Places autocomplete/details, keeping the billed `GOOGLE_API_KEY`
server-side. It is **deployed manually** (`npx wrangler deploy` from that directory) — there is no CI
for it, so repo and deployed state drift unless you redeploy after editing. Hardened 2026-07-19:
Origin allowlist (`app`, `app-testing`, `localhost:4200` — else 403), per-IP rate limit `60/min`
(top-level `[[ratelimits]]`; the `unsafe.bindings` shape deploys but never enforces), `input` capped
at 100 chars.

The app calls it at `https://cta-places-proxy.community-techaid.workers.dev`
(`place.component.ts:9`, and the public booking flow). **That origin is enumerated in the CSP
`connect-src`** in `src/staticwebapp.config.json` (served by Azure SWA). So a change to the Worker's
hostname, or any new external origin the app fetches/frames, is a **three-place edit**: app code +
Worker deploy + `staticwebapp.config.json` CSP. Miss the CSP and the call is blocked in prod only.

Two more CSP-coupled facts:
- **NGXS runs with `compatibility: { strictContentSecurityPolicy: true }`** (`state.module.ts`) because
  the CSP has no `unsafe-eval`; without it NGXS builds getters via `new Function()` and the store
  breaks under CSP. Don't remove that flag.
- **Turnstile** on the public booking form loads `challenges.cloudflare.com` (in CSP `script-src` +
  `frame-src`); site keys live in `environment.*.ts` (`turnstile_site_key` — real in prod, dummy
  `1x…AA` in uat-local, empty in dev). `e2e/csp-probe.mjs` verifies the prod CSP/Turnstile post-deploy.

---

## 9. The public-form close-toggle is NOT in this repo (operational, as of 2026-07)

Turning the public device-request form **off** is a Cloudflare **edge** redirect on the
`communitytechaid.org.uk` zone (`/organisation-device-request` → `/requests-temp-closed`), not app
code, not the admin panel, not the API. Grepping this repo for `requests-temp-closed` / `requestsClosed`
finds nothing. The admin-panel `canPublicRequest*` device-type flags only control which device types
appear **inside** an open form — they don't gate the page. (Operational fact; last confirmed by live
probe 2026-05, worker/CF context 2026-07-19. The wrangler OAuth token has `zone:read` only and cannot
read Page/Redirect Rules — needs Cloudflare dashboard access.)

---

## 10. Backend-coupled behaviours (cross-repo — see techaid-server skills for depth)

The dashboard cannot fix these from the frontend; know them before "fixing" a symptom here:

- **`updateDeviceRequest` is full-replace**: an explicit `null` clears the field (e.g. clearing
  `collectionDate`). The Apps-Script **calendar-sync** mutation
  (`synchronizeCollectionDataForDeviceRequest`) is **partial-merge** (keeps `?: entity` fallbacks). A
  frontend "clear the date" button that relies on the partial-merge mutation cannot clear — that needs a
  server change.
- **Auth scopes are enforced server-side, per resolver.** Hiding a button in the UI is UX, not
  security; the API is the gate. A GraphQL `Access Denied` for an authenticated user is a real
  permission result (see §3), not a client bug.

Point at techaid-server's `techaid-domain-reference` (meaning) and `techaid-architecture-contract`
(API invariants) rather than reverse-engineering the API from the dashboard.

---

---

## 11. The invariants checklist

Check any diff against this table. "MUST" means a violation is a blocking review finding.

| # | Invariant | How to check |
|---|-----------|--------------|
| 1 | App stays fully standalone — no new `@NgModule` | grep the diff for `@NgModule` |
| 2 | Never mutate an Apollo result in place — `.map()`+spread to clone | Read every `refetch/ajax` callback that touches `data.content` |
| 3 | GraphQL error link redirects only on HTTP 401 in the staff area, never on GraphQL `Access Denied`; public pages never redirect to login | `graphql.module.ts` `onError` + auth link |
| 4 | Conditional Formly fields that must retain values set `resetOnHide: false` (no bogus `defaultValue`) | grep `hideExpression` near value fields |
| 5 | New custom Formly field types are registered in `formly/index.ts` `FORMLYCONFIG` | that file |
| 6 | Users-table sort sends string `'1'`/`'-1'`, NOT `'asc'`/`'desc'` — don't normalize | `user-index` / `role-users` |
| 7 | Template state written outside a template event (subscribe/then/timer/listener/modal footer) is a signal or followed by `markForCheck()` — OnPush **and** Eager (zoneless) | component + spec |
| 8 | NGXS keeps `strictContentSecurityPolicy: true` | `state.module.ts` |
| 9 | Any new external origin the app fetches/frames is added to the CSP `connect-src`/`frame-src`/`script-src` | `src/staticwebapp.config.json` |
| 10 | Editing the Places Worker → redeploy it (`wrangler deploy`) AND reconcile its hostname with the CSP | `workers/cta-places-proxy/`, CSP |
| 11 | New endpoints go through the per-env `graphql_endpoint`/proxy indirection, not hardcoded URLs | `src/environments/*`, `proxy.conf*.json` |
| 12 | Every behaviour change ships a red/green Playwright spec (per `CLAUDE.md`) | PR contents |

---

## 12. Known weak points — stated plainly (as of 2026-11-11)

Do not silently "fix" these; each is accepted or parked. Keep changes scoped (per `CLAUDE.md` triage
rules).

| Weak point | Status | Detail |
|------------|--------|--------|
| Apollo frozen-response footgun | Accepted, guarded | In-place mutation throws silently → empty table. Mitigations: the `.map()`+spread convention, `apollo-v4-mutation-regression.spec.ts`, reviewer discipline. Recurs in any new table code. |
| Formly `resetOnHide` default | Accepted, per-field opt-out | v7 default scrubs hidden-field values; each value-bearing conditional field must opt out. No global switch is set (would change behaviour app-wide). |
| Per-resolver sort inconsistency | Parked (server-side) | Users tables need `'1'`/`'-1'`; all others `'asc'`/`'desc'`. A server fix to unify would remove the footgun; until then the FE inconsistency is required, not a bug. |
| Places Worker deployed manually | Accepted | No CI; repo↔deployed drift is possible. `wrangler deploy` by hand; README + `CLAUDE.md` note it. |
| Places Worker Origin check is forgeable | Accepted, rate-limit is the backstop | Origin header is script-forgeable; the 60/min per-IP limit is the real quota guard. Google-side key restriction + daily quota cap still open (no GCP access noted 2026-07-19). |
| CSP is hand-maintained in `staticwebapp.config.json` | Accepted, fragile | New external origins silently break in prod only. `csp-probe.mjs` is the post-deploy check; run it after any origin change. |
| Zoneless repaint relies on discipline | Accepted, partly guarded | A forgotten signal/`markForCheck()` gives stale UI with no error (§6). Missing marks often hide because another mark repaints the tree; they surface on quiet pages or under timing changes. Guards: the Z1 audit, `zoneless.spec.ts`, the OnPush specs, live `onpush-live-repaint`. ~58 components are still `Eager` with plain fields + marks; converting them to signals is optional cleanup, not required. |
| Public-form close-toggle off-repo | Accepted (edge) | Lives at the Cloudflare edge; not discoverable or changeable from this repo. |

---

## 13. Error reporting and Application Insights (lazy) — how browser telemetry works

Browser telemetry goes to Azure Application Insights, and the design is deliberately lazy and capped:

- **The SDK is a lazy chunk.** `AppInsightsService` (`src/app/shared/services/app-insights.service.ts`)
  imports `@microsoft/applicationinsights-web` dynamically, straight after the first render
  (`afterNextRender`), and only if `window.__env.appInsightsConnectionString` is set (deploy-time
  `assets/env.js`; absent in local dev, so the SDK is never fetched). It was ~210-240 kB of the eager
  bundle. Page views and exceptions raised before it arrives are buffered (up to 100) and flushed on
  load; a failed import logs a warning and drops telemetry, never breaking the app. The role name is
  `techaid-dashboard` (`ai.cloud.role`, `AppRoleName` in Log Analytics), since prod shares a resource
  with the API's `techaid-api` rows.
- **`GlobalErrorHandler`** (`src/app/shared/services/global-error-handler.ts`) replaces Angular's
  `ErrorHandler`. Angular swallows errors from templates, event handlers, lifecycle hooks and failed
  navigations into `ErrorHandler`, which only logs to the console, so they never reached
  `window.onerror` or the SDK's own collection. The handler keeps the `console.error`, then forwards to
  `AppInsightsService.trackException` with properties `source=angular-error-handler` and `route`
  (`location.pathname`), **capped at 50 reports per page load** so an error thrown on every repaint
  cannot flood Azure. Reporting is wrapped in try/catch (it must never throw: that would recurse), and
  the service is resolved through `Injector` on first use because it depends on `Router`, which itself
  asks for `ErrorHandler` (constructor injection would be a cycle).
- **Trade-off:** the SDK only records API calls (dependencies) made after it has patched `fetch`/XHR,
  so requests issued before the chunk loads are not recorded as dependencies. Loading straight after
  first render rather than on idle keeps that window, and lost landing page views, small; it does not
  remove it.

Pinned by `e2e/tests/app-insights-lazy.spec.ts`. **Invariant: do not move the SDK back into the eager
bundle, and do not remove the 50-report cap or the try/catch.** Any new external telemetry origin
follows the CSP rule (§8).

---

## Provenance and maintenance

Authored 2026-07-19 against branch `docs/dashboard-skill-library`. Version/dependency facts are from
`package.json` and `src/environments/version.ts` at that time; operational facts (close-toggle, Worker
hardening, GCP key status) carry their own as-of dates inline and come from session history, not the
tree. Re-verify volatile facts:

- Stack versions: `grep -E '"@angular/core"|@apollo/client|apollo-angular|@ngxs/store|ngx-formly|auth0' package.json`
- Standalone (no NgModules): `grep -rn "@NgModule" src/app` (expect none in app code)
- Apollo client wiring: `sed -n '50,67p' src/app/graphql.module.ts`
- In-place mutation offenders (audit): `grep -rn "\.content\.forEach\|data\.content" src/app/views` then read each callback
- Formly resetOnHide sites: `grep -rn "resetOnHide" src`
- Formly type registry: `sed -n '40,205p' src/app/shared/modules/formly/index.ts`
- Users-sort quirk: `grep -n "o.dir" src/app/views/corewidgets/components/user-index/user-index.component.ts src/app/views/corewidgets/components/role-users/*.ts`
- Zoneless: `grep -n "provideZone" src/main.ts` (expect only `provideZonelessChangeDetection`); `grep -rn "zone.js\|NgZone" src package.json` (expect none)
- NGXS CSP flag: `grep -n "strictContentSecurityPolicy" src/app/state/state.module.ts`
- Per-env endpoints: `grep -n "graphql_endpoint" src/environments/*.ts`
- Proxies: `cat src/proxy.conf.json src/proxy.conf.uat.json`
- CSP + Places origin coupling: `grep -n "cta-places-proxy\|Content-Security-Policy" src/staticwebapp.config.json src/app/shared/modules/formly/components/place.component.ts`
- Worker source/deploy: `ls workers/cta-places-proxy && sed -n '1,25p' workers/cta-places-proxy/wrangler.toml`
- Pinning specs exist: `ls e2e/tests/apollo-v4-mutation-regression.spec.ts e2e/tests/kit-resetonhide.spec.ts e2e/tests/issue-72-user-index-sort.spec.ts e2e/tests/donor-onpush.spec.ts e2e/csp-probe.mjs`
