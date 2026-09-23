# Digital hygiene review — front-end, 2026-09

Second front-end hygiene pass, run alongside the equivalent back-end review on
techaid-server. Working branch: `chore/digital-hygiene-2026-09` (off `dev`).

The first pass (`docs/digital-hygiene-remediation.md`, completed 2026-07-07) left a
follow-up backlog as issues **#112–#121**; **#157** was added later. This document is the
execution plan for that backlog plus what the 2026-09 dependency scan newly surfaced.

## What the scan found (2026-09-21)

Stack today: Angular **21.2.17**, CLI/build 21.2.18, TypeScript 5.9.3, apollo-angular 13 /
`@apollo/client` 4.2.5, NGXS 21, ng-bootstrap 20, Node 24 local.

`npm audit`: **24 advisories** — 11 high, 12 moderate, 1 low.

**New and not covered by any open issue:** the installed Angular packages carry four live
advisories that are *already fixed inside the 21.2.x line* — no major upgrade needed:

| Advisory | Severity | Fixed in |
|---|---|---|
| GHSA-jj27-h5hq-8x99 — i18n XSS via event-handler attributes (`core`, `compiler`) | high | 21.2.19 |
| GHSA-jhpw-976m-542j — HttpTransferCache cache-key ambiguity (`common`) | high | 21.2.19 |
| GHSA-hh8m-fm6v-7cvg — sanitization bypass via directive host bindings (`core`, `compiler`) | moderate | 21.2.20 |
| GHSA-p297-fm68-3q8c — HttpTransferCache leak with `withRequestsMadeViaParent` (`common`) | moderate | 21.2.20 |

The Angular packages are pinned to an exact version in `package.json`, which is why
`npm outdated` reports "wanted 21.2.17" and nothing has pulled the fixes in. This is the
highest value / lowest risk item in the whole review and leads the plan.

The remaining high advisories are all transitive build-time dependencies (`brace-expansion`,
`browserslist`, `fast-uri`, `ip-address`, `nanoid`, `postcss`, `hono`, `@hono/node-server`) —
reachable only by the toolchain, not by shipped app code.

## Batch plan

Each batch = one checkpoint commit (or a small series), gated on
`ng build --configuration production` + `npm run e2e:fast`. Live-UAT e2e before any PR merges.

| Batch | Scope | Issues | Risk |
|---|---|---|---|
| **0** | ✅ **DONE** (`420f6e3`) In-range security/patch bumps | — (new) | low |
| **1** | ✅ **DONE** (`aa00a92`, `6439bb8`) dead `createApi` modals deleted; Poppins self-hosted, Google Fonts out of the CSP | #120, #119 | low |
| **2** | ✅ **DONE** (`1b64b8d`) all three workflows back on `npm ci`; lockfile already fixed by batch 0 | #121, #157 | low, CI-visible |
| **3** | ✅ **DONE** (`88a2609`, `214bd38`) FA 5→7 **and** subset to the 63 icons actually used | #116 | medium (visual) |
| **4** | ✅ **DONE** (`d7b95e6`, `a666293`, `6aa37f1`) all 12 components + the `delivery-slots` child fix | #114 | medium |
| **5a** | ✅ **DONE** (`bcf6d08`) apollo-angular 14, graphql 17, formly 8, ngx-progressbar 14 — on Angular 21 | #112 | medium |
| **5b** | ✅ **DONE** (`92e7387`) Angular 22.1.7, TypeScript 6.0.3, NGXS 22, ng-bootstrap 21, ng-select 24, ngx-quill 31, cdk 22, zone.js 0.16 | #112 | high |

**Deferred out of this pass** (recorded, not attempted):

- **#113** native Angular tables replacing jQuery DataTables — XL, gated on batch 4; its own project.
- **#115** zoneless — blocked by #113/#114.
- **#117** Auth0 token cache out of localStorage — the e2e harness rework is the real cost; needs a deliberate decision.
- **#118** quill 2.0.3 XSS — still no upstream fix; remains an accepted risk on the watch list.
- `jquery` 4, `@types/jquery` 4, `datatables.net` 3 — pointless to bump ahead of #113.

## Execution model

Orchestrator (this session) sequences the batches and owns the decisions; each batch's
mechanical work is delegated to a Sonnet agent with a fully-specified brief. Batches touching
`package.json` / `package-lock.json` run **sequentially**; independent file-level work inside a
batch may run in parallel.


## Batch 5 sequencing — peer ranges checked 2026-09-22

Read from the registry, not assumed. Three findings reshape #112:

**TypeScript goes to 6.0.x, not 7.** `@angular/compiler-cli@22.1.7` declares
`typescript: ">=6.0 <6.1"` — a one-minor window. `npm outdated` advertises TS
`latest 7.0.2`, which would fail the build outright. Issue #112 said "TypeScript 6"
and was right.

**Batch 5 splits in two.** These majors do NOT require Angular 22 and can land and be
verified on the current framework first:

| Package | Target | Peer constraint |
|---|---|---|
| `apollo-angular` | 14.2.0 | `@angular/core ^20 \|\| ^21 \|\| ^22`, `graphql ^16 \|\| ^17` |
| `graphql` | 17.0.2 | — |
| `@ngx-formly/core` + `bootstrap` | 8.0.0 | `@angular/forms >=19.0.0` |
| `ngx-progressbar` | 14.0.0 | `@angular/core >=17.3.0` |

Doing them separately matters: Apollo v4's frozen responses and Formly's `resetOnHide`
are the two fragile seams in this codebase (see `dashboard-architecture-contract`).
Debugging either against a stable framework beats debugging it inside a twelve-package
atomic bump.

These are locked to the Angular 22 flip and must move with it:
`@ngxs/*` 22 (`>=22 <23`), `@ng-bootstrap` 21 (`^22`), `@ng-select` 24 (`^22`),
`ngx-quill` 31 (`^22`), plus `zone.js` 0.16.3, `angular-eslint` 22.5.0, `@types/node` 26.

**`@angular/cdk` becomes a real dependency.** Both `@ng-select@24` and
`ngx-progressbar@14` peer-depend on it. It is not in `package.json` today (satisfied
transitively); after the bump it should be declared explicitly at `^22`.

## Unplanned finding — strict mode is off everywhere

None of `tsconfig.json`, `src/tsconfig.app.json` or `tsconfig.base.json` contains an
`angularCompilerOptions` block, and `compilerOptions.strict` is absent from all three.
TypeScript strict mode and Angular `strictTemplates` are both **off** project-wide.

This is why the #120 templates could bind `[fields]="fields"` to properties that do not
exist on their components, for years, without a single build error — and why unused
imports accumulate unnoticed. No open issue covers it.

Not folded into this pass: enabling `strictTemplates` across 36 components will surface a
large error backlog and deserves its own scoped issue. Recorded here as a candidate.

## Log

| Date | Batch | Outcome |
|---|---|---|
| 2026-09-21 | — | Branch cut off `dev` at `08e4abd`; scan recorded above. |
| 2026-09-22 | 0 | Angular → 21.2.23 (build/cli 21.2.24) + 8 in-range refreshes. `npm audit` 24→8; the four target Angular advisories cleared. Prod build clean. 69 packages moved, 11 added, 21 net lockfile entries removed (nested `@typescript-eslint` dedup). Needed one `npm install --legacy-peer-deps` to get past an ERESOLVE deadlock across the 11 exact-pinned Angular peers — **lockfile therefore generated with peer validation off; re-verify in Batch 2**. Incidentally added `@emnapi/core`/`@emnapi/runtime` 1.11.3 and moved `@emnapi/wasi-threads` to 1.2.3 — exactly the three complaints in #157's `npm ci` failure. |
| 2026-09-22 | — | e2e baseline re-established: minted a CI-style fake token (`ci.yml`'s own step) into `e2e/.auth/user.json`; `npm run e2e:fast` **141 passed, 0 failed**. Confirms the earlier 42 failures were the stale token alone, and that `auth0-spa-js` 2.22→2.27 did not move the cache format `save-token.mjs` writes. |
| 2026-09-22 | 1 | #120: dead `createApi` templates removed from `kit-component.html` and `user-index.html` plus orphaned `form`/`model` members and `user-index`'s now-unused `FormlyModule`/`ReactiveFormsModule` component imports. #119: Poppins self-hosted — 12 woff2 (6 combos × latin/latin-ext, 108 kB incl. OFL), `unicode-range` preserved so browsers still fetch only what they need; `fonts.googleapis.com` out of `style-src`, `fonts.gstatic.com` out of `font-src`. Both: prod build clean, e2e 141/141. |
| 2026-09-22 | 3 | FA 5.15.4→7.3.1. Five `sb-admin.css` rules hardcoded `'Font Awesome 5 Free'` and would have rendered blank glyphs silently. All 63 glyph tokens validated against FA7 metadata; 0 renames needed, 22 survive via alias. |
| 2026-09-22 | 3b | **Extra, not originally planned:** subset FA to the icons actually used. Webfonts **254K → 9.5K**. `build/fa-subset.mjs` resolves `fa-*` classes *and* literal `content:"XXXX"` escapes (3 codepoints appear only as escapes — a class-only scan would have dropped them). `build/check-fa-icons.mjs` runs in CI; proved to fail on an unlisted icon and pass once reverted. |
| 2026-09-22 | 4 | OnPush across all 12 components. `kit-index` needed **5** `markForCheck` sites, not the pilot's 2. `distributions-and-deliveries-index` regressed e2e until `delivery-slots.component.ts` (a Default-strategy child whose subtree an OnPush ancestor silently skips) also got 6 `markForCheck` calls — only 3 of which any spec covers. |
| 2026-09-22 | tests | 15 `@mocked` specs added (`6b22e58`, `343a0e2`). The 12 ajax-callback repaint tests and the 3 `delivery-slots` tests are red-proved. **Filter-apply is unguardable**: `NgbModal.open(templateRef)` attaches modal content as its own root view via `ApplicationRef.attachView`, so it ticks on zone stabilisation regardless of the host's OnPush state — the badge updates even with `applyFilter()`'s `markForCheck` deleted. Those calls stay because they become load-bearing under zoneless (#115). |
| 2026-09-22 | 5a | apollo-angular 14 / graphql 17 / formly 8 / ngx-progressbar 14 on Angular 21. Only ngx-progressbar needed app code (11→14 is an API rewrite; `app-ngx-progress-http.ts` deleted for the package's own `ngx-progressbar/http`). Both fragile seams verified intact: Apollo `.map`+spread clones, Formly `resetFieldOnHide` still defaults true with per-field opt-out. `@angular/cdk` declared — npm had been silently resolving it to 22.x, the real cause of batch 0's ERESOLVE. |
| 2026-09-22 | 5b | Angular 22.1.7 + TypeScript 6.0.3. `ng update` added `ChangeDetectionStrategy.Eager` to 59 files to pin pre-v22 default CD. **TS 6 flipped `strict` to default-true** — `strict: false` set explicitly in `tsconfig.base.json` to hold behaviour (~60-error cascade otherwise). Budget overage grew to +11kB initial / +89kB total. New `NG0956` track-expression warnings noted, not fixed. |
| 2026-09-22 | cleanup | `@angular/platform-browser-dynamic` dropped (zero imports; app is standalone). `.npmrc` added — **`ngx-toastr` 20.0.5 is the newest release and still peers on Angular ^21**, and `npm ci` DOES validate peers: verified in Docker, ERESOLVE without the file, exit 0 with it. Without `.npmrc` every workflow and both deploys would fail. |
| 2026-09-22 | sweep | Final gate on the combined tree: lint 0 errors / 1327 warnings (baseline), production **and** uat builds clean, `fa:check` OK, e2e **156/156**, check-skips 0 skipped / 0 flaky. |
| 2026-09-23 | live UAT | First live-UAT run of the branch: 208 passed, 2 failed, 9 skipped. Both failures were test drift, verified against a `dev` worktree: **ORG-B2** fails identically on `dev` (helper still clicked "That's right"; the button has said "Submit a request" since #204). **BUG-19** passes on `dev` and failed here because **ng-select 24 no longer swallows Escape on a closed select** — it propagates to NgbModal and dismisses the dialog (intended upstream change). Spec now presses Escape only while the panel is open. The 9 skips are identical on `dev` (stale selectors / default `is_sales` filter), pre-existing. |
| 2026-09-23 | audit | `npm audit fix` (lockfile only): browserslist, baseline-browser-mapping, brace-expansion, fast-uri, ip-address and friends to patched versions — all build-time transitive. `npm audit` 6→1 (quill #118, accepted). Prod + uat builds, `fa:check`, CSP probe, e2e:fast 161/161 re-run clean. |

## Deferred out of this pass — recorded, with evidence

- **#113** native Angular tables replacing jQuery DataTables — XL, unchanged.
- **#115** zoneless — now the natural next step: OnPush is complete, and the filter-apply
  `markForCheck` calls that are inert today become necessary the moment zone.js stops ticking.
- **#117** Auth0 token cache out of localStorage — unchanged; the e2e harness rework is still the real cost.
- **#118** quill 2.0.3 XSS — still no upstream fix.
- **Strict mode is off project-wide.** TypeScript 6 default-flipped `strict` to true and we
  explicitly set it back to `false` to keep the upgrade tractable. `strictTemplates` is also
  explicitly `false`. This is now *recorded* in the tsconfigs rather than merely absent — a
  better starting point for a scoped "turn strict on" issue. No issue filed yet.
- **FontAwesome alias debt** — 22 of 63 icons resolve only via v5→v6 aliases
  (`fa-search`→`magnifying-glass` etc.). Works today; will break at FA8.
- **`login-callback-guarded-root.spec.ts` hardcodes `localhost:4200`**, so it fails on any
  other port. Found when running the suite on 4300 for parallel isolation. `save-token.mjs`
  hardcodes the same origin in the storage state it writes.
- **`npm run lint` via the RTK proxy reports ~2600 warnings; `npx ng lint` reports 1327.**
  The proxy appears to double-count. Direct invocation is authoritative.

## Found during pre-deploy validation, NOT fixed — 2026-09-22

**Any GraphQL-stubbing harness must stub `buildInfo`.** The app gates its entire router-outlet
behind a `buildInfo` health check ("Server is starting up" spinner) on *every* route. The first
run of the local CSP probe reported zero violations across three pages while actually rendering
nothing but the global shell — fonts and icons only, never a routed component. A clean result
from a harness that has not stubbed `buildInfo` is meaningless. `e2e/csp-probe-local.mjs` now
stubs it everywhere.

**`normalizeData(data) { return data; }` hands Formly a frozen Apollo object.** Apollo v4 freezes
responses, so a Formly form bound to `this.model` throws
`Cannot assign to read only property '<field>'` when the user types. Observed as an unhandled
error while writing `e2e/tests/ngx-quill-richtext.spec.ts` (post-info's Content field); the Save
flow still completed, so the user-visible impact is unclear and needs establishing.

Pass-through `normalizeData` implementations, all binding a Formly model:
- `post-info.component.ts:154`
- `post-data.component.ts:67`
- `donor-parent-info.component.ts:194`
- `referring-organisation-info.component.ts:170`

`dashboard-index.component.ts:96` also returns the frozen object, though it mutates `this.styles`
rather than the response.

**Pre-existing** — `@apollo/client` was already v4 (`^4.1.7`) before this branch, so the upgrade
did not introduce it. Not fixed here: it spans four components, the correct fix (`return {...data}`
or a deeper clone where nested fields are edited) needs a per-component judgement about depth, and
the night before a deploy is the wrong time. See [[project_apollo_v4_freeze]].

**Other follow-ups noted, not actioned:** bundle budgets now overrun by ~11kB initial / ~89kB
total scripts and should be deliberately reset or investigated; Angular 22 emits new `NG0956`
track-expression warnings on some `@for`/`*ngFor` usage; `@angular/animations` is deprecated in
v22 in favour of `animate.enter`/`animate.leave`; `login-callback-guarded-root.spec.ts` and
`save-token.mjs` both hardcode `localhost:4200`, which breaks port-isolated runs.
