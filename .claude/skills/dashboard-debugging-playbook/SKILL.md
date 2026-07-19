---
name: dashboard-debugging-playbook
description: Symptom-to-triage playbook for debugging techaid-dashboard (the Angular admin + public booking SPA). Load FIRST when investigating any dashboard bug — a table or list that renders empty after a save, a mutation or button that silently does nothing, form fields that vanish on load, user-list sort reversed, a cleared field that comes back on reload, blank detail tabs / null nested fields, a login loop or "Access Denied", the public booking page missing its Turnstile widget or hitting CSP violations, address autocomplete dead, "is the right build deployed?", a prod build that fails while dev passes, or a flaky e2e run. Gives the first check, the historical trap, and a discriminating experiment for each known failure mode.
---

# TechAid Dashboard Debugging Playbook

Triage guide for the failure modes this dashboard has actually hit, in the order you should
suspect them. Each section gives: the symptom, the **first check** (cheap, copy-pasteable), the
**trap** that cost real time historically, and a **discriminating experiment** that separates
competing hypotheses before you change anything. Design rationale and the *why* behind every
invariant named here → `dashboard-architecture-contract`; writing the red test / running Playwright
→ `dashboard-testing-and-e2e`; deploy + rollback → `dashboard-release-and-deploy`; the GitHub issue
loop → `triage-issues`. API-side symptoms (resolver auth, schema, migrations) live in techaid-server's
`techaid-debugging-playbook`; KQL/App Insights in its `techaid-diagnostics-and-observability`.

Run shell commands from the repo root. All paths below are relative to
`D:\Code\techaid-dashboard`. `ng build --configuration production` is the stricter structural signal
(per `CLAUDE.md`) — when in doubt, run it.

**Jargon used below** (defined once):

- **UAT** — the user-acceptance dashboard at `https://app-testing.communitytechaid.org.uk`,
  auto-deployed from `dev` (`deploy-dev.yml`); talks to `api-testing.communitytechaid.org.uk`.
- **Frozen response** — Apollo v4 deep-freezes every GraphQL result object; writing to one throws.
- **DataTables ajax callback** — the jQuery DataTables function that resolves a GraphQL promise and
  paints table rows; an exception inside it rejects silently and the table renders empty.
- **Formly type** — a custom field renderer registered in `FORMLYCONFIG` (`choice`, `place`, `date`, …).
- **version triple** — `{version, build, commit}` in `src/environments/version.ts`, stamped by CI;
  identifies one exact UAT build.
- **Places Worker** — `cta-places-proxy` Cloudflare Worker fronting Google Places, deployed manually.

## Symptom → first check

| # | Symptom | First check |
|---|---------|-------------|
| 1 | Table renders empty / action silently no-ops after a mutation | Is anything mutating an Apollo result object in place? |
| 2 | All GraphQL queries fail with network errors on `ng serve` | Which env is served (dev vs uat-local) + is the Docker API up? |
| 3 | Form field values vanish on load / hidden-then-shown Formly field comes back empty | `resetOnHide` on the conditional field |
| 4 | User list sort broken or reversed | Users resolver wants string `'1'`/`'-1'`, not `'asc'`/`'desc'` |
| 5 | "Clear date" saves but the value comes back on reload | Which mutation the component calls + server null semantics |
| 6 | Detail tab blank / nested fields null (user/role) | Raw GraphQL response in the Network tab — FE vs BE |
| 7 | Login loop / auth errors / "Access Denied" | 401-only redirect in `graphql.module.ts` + Auth0 config |
| 8 | Public booking page: Turnstile missing / CSP violations | CSP `connect-src`/`script-src`/`frame-src` in `staticwebapp.config.json` |
| 9 | Address autocomplete dead on the booking form | Network tab: the Places Worker request status (403 / 429 / stale) |
| 10 | "Is the right build even deployed?" | `version.ts` triple vs what `deploy-dev.yml` stamped |
| 11 | Prod build fails but dev build passes | `ng build --configuration production` is the strict gate |
| 12 | e2e flakes | Expired bearer token, or a known-flaky spec — not a regression |

---

## 1. Table renders empty, or a save/action silently does nothing, after a mutation

**First check** — is any code writing back onto a GraphQL result object? `@apollo/client` v4
deep-freezes every result; `row.foo = x` throws `TypeError: Cannot assign to read only property`,
and the throw happens *inside* a `refetch().then(...)` / DataTables ajax callback that rejects
silently — an error toast may flash, then the table renders empty and the user reports "doesn't load".

```bash
grep -rn "data\.content" src/app/views    # then read each callback for in-place assignment
grep -rn "\.forEach(" src/app/views | grep -i "content\|entities"
```

**The trap:** the failure looks like a data/network problem (empty table, no visible error), so time
goes into GraphQL queries and the backend — but the query succeeded and the *render* threw on a frozen
row. The tell is an empty table with a query that returns 200.

**Discriminating experiment:** the fix pattern is clone-then-derive — `.map()` + object spread, never
`forEach` + assignment. The canonical correct site is
`src/app/views/corewidgets/components/device-request-component/device-request-component.component.ts:364`
(`data.content.map(d => ({ ...d, types }))`). Pinned by
`e2e/tests/apollo-v4-mutation-regression.spec.ts` (issue #39); historically-fixed sites include
`user-permissions.component.ts` and `reports.component.ts`. If converting a `forEach` mutation to
`.map()`+spread makes the table paint, you've confirmed the class. Design rationale (why v4 freezes,
the invariant) → `dashboard-architecture-contract` §2.

## 2. All GraphQL queries fail with network errors locally / lists empty on `ng serve`

**First check** — this is almost always the dev proxy target, not the app. Plain `ng serve` uses
`environment.ts` (`graphql_endpoint: /api/graphql`) and `src/proxy.conf.json`, which forwards `/api` to
the Docker container `techaid-server-web-1:8080`. If that container isn't running, every query fails
with a network error while **Auth0 login still works** (it hits the real
`techaid-auth.eu.auth0.com` tenant, no API needed).

```bash
grep -n "target" src/proxy.conf.json          # http://techaid-server-web-1:8080 (Docker)
docker ps | grep techaid-server-web-1          # is the API container up?
```

**The trap:** login working makes it look like everything is wired, so a dead-lists symptom gets
chased as a query/auth bug when the API container simply isn't up. Login and data have independent
dependencies.

**Discriminating experiment:** to get **real data without local Docker**, serve the uat-local config
instead — it points `/graphql` at `api-testing` via `src/proxy.conf.uat.json` (which sets `Origin` to
dodge CORS). This is exactly what Playwright uses:

```bash
ng serve --configuration uat-local     # /graphql → api-testing.communitytechaid.org.uk
```

If lists populate under `uat-local` but not plain `ng serve`, the missing piece was the Docker API —
not a code bug. Env/proxy design → `dashboard-architecture-contract` §7.

## 3. Form field values vanish on load / hidden-then-shown Formly field comes back empty

**First check** — ngx-formly v7 defaults to `resetOnHide: true`. When a field's `hideExpression`
flips to hidden, Formly scrubs its value out of the model; with a falsy `defaultValue` like `''`, the
scrub can even fire during the **first** build cycle for a field that ends up visible. A later save
then persists blanks.

```bash
grep -rn "resetOnHide\|hideExpression\|defaultValue: ''" src/app/views/corewidgets/components/kit-info
```

**The trap:** patching the model after load (`form.patchValue(...)`) does **not** fix it — the scrub
precedes the patch, so the value is gone before your patch runs. Time gets spent on load-order and
subscription timing when the fix is one property.

**Discriminating experiment:** set `resetOnHide: false` on the conditional field (and drop any bogus
`defaultValue: ''`). The live example is `kit-info.component.ts` — 13 fields carry `resetOnHide: false`
today (the `subStatus.*` lock checkboxes and hardware-attribute fields). Pinned by
`e2e/tests/kit-resetonhide.spec.ts`. If flipping `resetOnHide` to `false` makes the value survive
hide/show, that's the bug. Invariant + why → `dashboard-architecture-contract` §4.

## 4. User list sort broken, reversed, or errors with a coercion message

**First check** — the Users tables (`user-index`, `role-users`) are a deliberate exception. Every
other paginated table sends `sort[].value` as `"asc"`/`"desc"`, but the backend `users` resolver (an
Auth0 Management API proxy) validates `key:value` against `^field:(1|-1)$` and wants `value` as a
**String**. So those two components send string `'1'`/`'-1'`:

```bash
grep -n "o.dir" src/app/views/corewidgets/components/user-index/user-index.component.ts
# → value: (o.dir == 'asc') ? '1' : '-1'    (user-index.component.ts:121)
```

**The trap — the fenced-off wrong fix:** "consistency-fixing" this to send `o.dir` like the other
tables produces `String does not match pattern ^field:(1|-1)$`; sending the integer `1`/`-1` produces
`Expected a String input, but it was a 'Integer'` (the original #72 bug). **Do NOT normalize this to
match the other tables** — the inconsistency is server-side and per-resolver.

**Discriminating experiment:** pinned by `e2e/tests/issue-72-user-index-sort.spec.ts`. If that spec is
green, the sort contract is correct and any remaining sort oddity is elsewhere (the resolver, or the
Auth0 data). Invariant → `dashboard-architecture-contract` §5.

## 5. "Clear date" / clearing a field saves but the value comes back on reload

**First check** — which mutation does the component call? This is backend partial-update semantics,
not the form. (**Cross-repo fact.**) The Apps-Script calendar-sync mutation
(`synchronizeCollectionDataForDeviceRequest`) is **partial-merge**: it keeps `?: entity` fallbacks and
**ignores an explicit `null`**, so a "clear" through it can never stick. `updateDeviceRequest` is
**full-replace** and an explicit `null` *does* clear the field.

**The trap:** the form and the optimistic UI look correct (the field clears on screen), so the bug
reads as a frontend/state problem — but the write was silently dropped server-side. Reloading pulls
the un-cleared value back.

**Discriminating experiment:** watch the Network tab — read the exact mutation name and its variables
in the outgoing GraphQL request, then reload and re-query. If the field is non-null after a reload
despite you sending `null`, and the mutation is the partial-merge one, this needs a **server** change,
not a form fix. Backend null semantics → techaid-server's `techaid-debugging-playbook`;
cross-repo summary → `dashboard-architecture-contract` §10.

## 6. Detail tab blank / nested fields null (user or role detail)

**First check** — open the Network tab and read the **raw GraphQL response** for the detail query
before touching any rendering code. Nested nulls from the API can be a *server wiring* bug, not a
render bug. Historically `user.roles`, `user.permissions`, `role.users`, `role.permissions` came back
`null` with no GraphQL error — the server-side `@SchemaMapping` resolvers were lost in the
kickstart→Spring-GraphQL migration (fixed in techaid-server PR #36).

**The trap:** the DataTables callbacks dereferenced the nested field directly
(`res.data.user.roles['totalElements']`), so a `null` threw
`TypeError: Cannot read properties of null (reading 'totalElements')` and the tab hung on
"Loading…" forever — which looks like a frontend rendering hang, not a missing-data (backend) problem.

**Discriminating experiment:** the raw response discriminates cleanly. Field present with data →
frontend render bug. Field `null` (no error) → server resolver gap; the frontend can only be
*hardened* against it (done in dashboard PR #75). Pinned by
`e2e/tests/detail-null-relationships.spec.ts`, which forces those fields to `null` so the guard is
tested deterministically even after the backend is fixed.

## 7. Login loop / auth errors / "Access Denied"

**First check** — distinguish an HTTP 401 from a GraphQL `Access Denied`. The Apollo error link in
`src/app/graphql.module.ts` redirects to login on **HTTP 401 only** — never on a GraphQL-level
`Access Denied` (HTTP 200, a `CombinedGraphQLErrors` with no `statusCode`):

```bash
sed -n '50,61p' src/app/graphql.module.ts   # if (status === 401) redirectToLogin();
```

A GraphQL `Access Denied` for an **authenticated** user is a real permission result — the caller's
Auth0 token lacks the required scope, a server-side gate — not a client bug.

**The trap:** "simplifying" the error link to redirect on any auth-ish error causes a **login loop**:
an authenticated user missing one scope gets bounced to login, comes back with the same token, and
loops. The 401-only guard (plus a `reauthInProgress` latch on the auth link) exists precisely to
prevent this. **Do not remove it.**

**Discriminating experiment:** Auth0 SDK config lives in `src/main.ts` (`provideAuth0({ domain:
'techaid-auth.eu.auth0.com', clientId: '…', authorizationParams: { redirect_uri:
window.location.origin } })`); login/logout flow is in
`src/app/shared/services/authentication.service.ts`. A redirect loop *at login* (before any query)
points at the Auth0 redirect-URI / callback config; a single `Access Denied` *after* login points at a
missing scope on the token — decode the JWT (`permissions` claim) and check the resolver's gate in
techaid-server. Auth link + error link design → `dashboard-architecture-contract` §3.

## 8. Public booking page: Turnstile widget missing / CSP violations

**First check** — the browser console will name the blocked directive. The CSP is served by Azure
Static Web Apps from `src/staticwebapp.config.json` (one long `Content-Security-Policy` header). The
Turnstile widget needs `challenges.cloudflare.com` in **both** `script-src` and `frame-src`; any host
the app fetches must be in `connect-src`:

```bash
grep -n "Content-Security-Policy" src/staticwebapp.config.json
# connect-src includes https://cta-places-proxy.community-techaid.workers.dev
# script-src + frame-src include https://challenges.cloudflare.com
```

**The trap:** the CSP is hand-maintained in `staticwebapp.config.json` and enforced **only in
prod/UAT** (SWA serves the header; `ng serve` does not). So a new external origin works locally and
in every test, then silently breaks in production. A missing origin is a three-place coupling: app
code + Worker deploy + CSP (see §9 and `dashboard-architecture-contract` §8).

**Discriminating experiment:** run the post-deploy probe against the real origin — it loads the page,
confirms the Turnstile `api.js` loaded and the challenge iframe attached, and asserts zero CSP
violations:

```bash
node e2e/csp-probe.mjs https://app.communitytechaid.org.uk    # prod (default origin: app-testing)
```

Exit 0 = clean. A violation in the probe output names exactly which directive to extend.

## 9. Address autocomplete dead on the booking form

**First check** — open the Network tab and read the status of the request to
`cta-places-proxy.community-techaid.workers.dev` (referenced at
`src/app/shared/modules/formly/components/place.component.ts:9`). The Worker was hardened 2026-07-19:
an **Origin allowlist** (403 for any Origin not in `ALLOWED_ORIGINS` — `app`, `app-testing`,
`localhost:4200`) plus a per-IP rate limit (429 when tripped). Source of truth is in-repo at
`workers/cta-places-proxy/src/index.js`.

```bash
grep -n "ALLOWED_ORIGINS\|403\|429" workers/cta-places-proxy/src/index.js
```

**The trap:** the Worker is **deployed manually** (`npx wrangler deploy` from that directory) with no
CI, so the deployed edge state can drift from the repo. A local page working against a stale or
misconfigured deployed Worker (allowlist missing your origin, or a rate-limit 429) looks like a
frontend autocomplete bug when the failure is entirely at the edge.

**Discriminating experiment:** the HTTP status disambiguates — `403` = your Origin isn't allowlisted
(check `ALLOWED_ORIGINS` vs where the page is served); `429` = rate-limited; a `200` with empty results
= a Google/key issue upstream; a failed/blocked request with a CSP error = §8 (missing `connect-src`).
Worker deploy/rollback → `dashboard-release-and-deploy`; design → `dashboard-architecture-contract` §8.

## 10. "Is the right build even deployed?"

**First check** — `src/environments/version.ts` carries the exact identity of a build: the
`{version, build, commit}` triple. UAT builds carry the **last released** semver plus a unique `build`
datestamp and short `commit` SHA (the semver only moves on a release):

```bash
cat src/environments/version.ts
# e.g. {version:'1.1.0', build:'26.07.18-0941', commit:'e134f28'}
```

**The trap:** the semver alone is misleading — it's identical across every UAT build between releases,
so "it says 1.1.0, must be current" can be wrong by many commits. The `build` + `commit` fields are
what actually pin a build.

**Discriminating experiment:** `deploy-dev.yml` regenerates `version.ts` at deploy time (it echoes the
`APP_VERSION` line with the CI build stamp and commit SHA). Compare the `commit` shown by the running
app against the SHA CI deployed (the deploy run / the `deploy/dev/*` tag). Mismatch → the deploy didn't
take or you're looking at a cached build. Deep dive on the release/deploy pipeline →
`dashboard-release-and-deploy`.

## 11. Production build fails but dev build passes

**First check** — reproduce with the production configuration, which is stricter than the dev build
and than `ng serve` (per `CLAUDE.md`):

```bash
ng build --configuration production
```

**The trap:** `ng serve` / dev builds tolerate things production rejects (stricter optimization,
budgets, template/type strictness), so "it runs locally" is not evidence the build is sound. Treat a
clean `ng build --configuration production` as the primary structural signal.

**Discriminating experiment:** if production fails and dev passes, read the first production error —
it's usually a type/template strictness or budget failure, not a runtime bug. Fix to the point where
`ng build --configuration production` is clean before concluding the change is correct. Full e2e is
secondary structural signal → `dashboard-testing-and-e2e`.

## 12. e2e flakes (brief — deep dive → `dashboard-testing-and-e2e`)

**First check** — a wave of auth-redirect failures on code you didn't touch is almost always an
**expired bearer token**. Live-UAT tokens last ~2h; refresh `e2e/.auth/user.json`:

```bash
E2E_BEARER_TOKEN=<fresh-token> node e2e/save-token.mjs
```

**The trap:** treating an expired-token failure as a code regression. Also: `tabs-debug.spec.ts` is a
**known flake**, not a regression — don't chase it. Other UAT gotchas that read as bugs: button
`textContent` carries whitespace (trim before asserting), the ng-select dropdown renders in an overlay
outside the control, and the device-request index applies a default `is_sales` filter (results look
"missing" until you clear it).

**Discriminating experiment:** the `@mocked` subset (`npm run e2e:fast`) stubs all GraphQL and mints a
fake JWT — it needs **no** token and is what CI runs. If `e2e:fast` is green but the live suite fails
broadly on auth, the token (not the code) is the problem.

---

## Measuring instead of eyeballing (operational, cross-repo pointers)

When a symptom needs evidence rather than guesses:

- **Edge / traffic forensics** (which IP, path, status hit the Cloudflare-fronted origins) — the
  wrangler OAuth token works as a Bearer against the Cloudflare GraphQL Analytics API. Use it for
  Worker 403/429 rates (§9) or public-form traffic. (Operational; as of 2026-07-19.)
- **API-side telemetry** (a GraphQL error's input variables, request traces) lives in Azure App
  Insights on the *server* side, not this repo — techaid-server's
  `techaid-diagnostics-and-observability`. A dashboard symptom that turns out to be a backend error
  (§5, §6, §7) is diagnosed there.

## When NOT to use this skill

- **Designing a change** (will this diff violate an invariant?) → `dashboard-architecture-contract`.
- **Writing the red/green Playwright spec, running the suite, token setup** → `dashboard-testing-and-e2e`.
- **Cutting a release, deploying UAT/prod, deploying or rolling back the Places Worker, post-deploy
  verification** → `dashboard-release-and-deploy`.
- **The GitHub issue triage loop** (replicate, comment, scope the PR) → `triage-issues`.
- **What a kit / device-request / status / scope *means*** → techaid-server's `techaid-domain-reference`.
- **An API-side symptom** (resolver `Access Denied`, schema wiring no-op, migration failure, cold
  start) → techaid-server's `techaid-debugging-playbook`; KQL/App Insights → its
  `techaid-diagnostics-and-observability`.

## Provenance and maintenance

Authored 2026-07-19 against branch `docs/dashboard-skill-library`. Frontend facts (file:line, CSP,
proxy targets, `version.ts` contents, resolver-sort contract, error-link guard) were verified directly
against the working tree; cross-repo and edge facts (backend null semantics, `@SchemaMapping` history,
Worker hardening, Cloudflare analytics, App Insights) are labelled inline and carry their own as-of
dates — they live in techaid-server or at the Cloudflare/Azure edge, not this repo.

Re-verify volatile facts:

- Apollo clone convention / offender audit: `grep -rn "data\.content" src/app/views` then read each callback
- Error-link 401-only redirect: `sed -n '50,61p' src/app/graphql.module.ts`
- Formly resetOnHide sites: `grep -rn "resetOnHide" src`
- Users-sort quirk: `grep -n "o.dir" src/app/views/corewidgets/components/user-index/user-index.component.ts`
- Dev vs uat-local proxy targets: `grep -n "target" src/proxy.conf.json src/proxy.conf.uat.json`
- CSP + Places/Turnstile origins: `grep -n "Content-Security-Policy" src/staticwebapp.config.json`
- Places Worker URL + allowlist: `grep -n "PLACES_PROXY" src/app/shared/modules/formly/components/place.component.ts; grep -n "ALLOWED_ORIGINS" workers/cta-places-proxy/src/index.js`
- Version triple + CI stamp: `cat src/environments/version.ts; grep -n "APP_VERSION" .github/workflows/deploy-dev.yml`
- Auth0 SDK config: `grep -n "provideAuth0\|domain\|redirect_uri" src/main.ts`
- Pinning specs exist: `ls e2e/tests/apollo-v4-mutation-regression.spec.ts e2e/tests/kit-resetonhide.spec.ts e2e/tests/issue-72-user-index-sort.spec.ts e2e/tests/detail-null-relationships.spec.ts e2e/csp-probe.mjs`
- Prod build is the strict gate: `ng build --configuration production`
