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
| **2** | Linux-regenerated `package-lock.json`, switch all three workflows back to `npm ci` | #121, #157 | low, CI-visible |
| **3** | FontAwesome 5→7 rename sweep | #116 | medium (visual) |
| **4** | OnPush fan-out across the remaining index components | #114 | medium |
| **5** | Upgrade train: Angular 22, apollo-angular 14 / graphql 17, NGXS 22, ng-bootstrap 21, ng-select 24, formly 8, TypeScript | #112 | high, multi-day |

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
