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
| **0** | In-range security/patch bumps: Angular 21.2.17→21.2.24 line, `@apollo/client` 4.3.1, `@auth0/auth0-angular` 2.12, App Insights 3.4.4, core-js, postcss, eslint, typescript-eslint, Playwright 1.63 | — (new) | low |
| **1** | Cheap debt: delete dead `createApi` modals; self-host Poppins and drop Google Fonts from the CSP | #120, #119 | low |
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

## Log

| Date | Batch | Outcome |
|---|---|---|
| 2026-09-21 | — | Branch cut off `dev` at `08e4abd`; scan recorded above. |
