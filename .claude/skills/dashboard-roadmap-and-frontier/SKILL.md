---
name: dashboard-roadmap-and-frontier
description: The vetted backlog of open improvement candidates for techaid-dashboard. Load when asked "what should we work on next", when planning roadmap or improvement work, when evaluating whether an idea is new or already known/parked, when scoping platform-health / upgrade-train / tech-debt or staff-efficiency-UX work, or before proposing any enhancement — to check it is not already listed here with a decided status and sequence.
---

# Dashboard Roadmap and Frontier

The honest "advance the project" layer for **techaid-dashboard**. Every item below is
**open/candidate** — some analysed, some already filed as a GitHub issue, but NOT decided
and NOT committed. Nothing here is a promise; a candidate stays a candidate until it survives
the promotion protocol at the bottom of this file.

This skill does **not** duplicate issue bodies — the GitHub tracker is the canonical home of
each repo-scoped candidate. What this file adds is **sequencing, cross-item dependencies, and
current status** (ready-now vs blocked-external vs waiting-on-release), plus the dashboard-side
half of the staff backlog spreadsheet. It points at issue numbers; read the issue for the detail.

## The maintainer's advancement definition (Tony, 2026-07-19)

"Advancement" for the dashboard means exactly **two things**:

1. **Platform health** — the upgrade train and debt burn-down that keep the app cheap to change.
   These are GitHub issues **#112–#121** (the 2026 digital-hygiene backlog). Part A below.
2. **Staff efficiency UX** — features that get staff and volunteers through ops work faster:
   the **B-series** issues (**#60–#63**) plus the **dashboard-side items of the staff backlog
   spreadsheet** (scan programme, prep mode, admin exception bookings, driver deliveries,
   supply-led availability, portal). Part B below.

Anything else is **out-of-scope-for-now** and is listed as such (bottom table) with one line of
why. Public-surface performance, and test/deploy automation beyond what a candidate itself needs,
are *support rails* — they enable advancement but are not themselves advancement.

## When NOT to use this skill

- **Executing the 1.2.0 production release** → `dashboard-release-and-deploy`. A pending prod cut
  is an *operation*, never a roadmap item — even though half of Part B is waiting on it.
- **Fixing a filed bug / triaging the tracker** (#76, #77, #82, #42) → `triage-issues`. Bugs are
  not roadmap candidates.
- **Debugging a live failure** → `dashboard-debugging-playbook`.
- **Judging whether a change is architecturally safe** → `dashboard-architecture-contract`.
- **What evidence a change needs to ship** → `dashboard-testing-and-e2e`.
- **Server-side candidates** (the API/DB half of any feature) → techaid-server's
  `techaid-roadmap-and-frontier`. Several Part B items are cross-repo; the split is marked per item.

## Candidate index

Part A — Platform health (the #112–#121 upgrade/debt train):

| ID | Title | Status |
|---|---|---|
| PH1 | Upgrade train: Angular 22 / apollo-angular 14 / NGXS 22 / TS 6 (#112) | open |
| PH2 | Replace jQuery DataTables with native Angular tables (#113) | open, gated |
| PH3 | OnPush fan-out after donor-index pilot (#114) | ready-now |
| PH4 | Zoneless change detection (#115) | blocked-internal |
| PH5 | FontAwesome 5→7 (#116) | ready-now |
| PH6 | Auth0 token cache out of localStorage (#117) | ready-now |
| PH7 | quill XSS advisory watch (#118) | watch |
| PH8 | Self-host Poppins / drop Google Fonts from CSP (#119) | ready-now |
| PH9 | Delete dead createApi modals (#120) | ready-now |
| PH10 | CI: Linux package-lock so `npm ci` works (#121) | ready-now |

Part B — Staff efficiency UX (B-series issues + dashboard items of the staff backlog spreadsheet):

| ID | Title | Status |
|---|---|---|
| SE1 | B-series ops-UX quick wins (#60, #61, #62, #63) | ready-now |
| SE2 | Scan-session foundation (sheet item 3) | blocked-external |
| SE3 | Device prep mode (sheet item 14) | blocked (after SE2) |
| SE4 | Admin exception bookings (sheet item 17) | waiting-on-release + policy |
| SE5 | Deliveries in the app — driver view (sheet item 16) | waiting-on-release, cross-repo |
| SE6 | Supply-led request availability (sheet item 15) | blocked (after SE2/SE3) |
| SE7 | Public / client portal (sheet item 2) | gated, late |

**Terms used below:**
- **The staff backlog spreadsheet** — the staff wishlist/backlog Google Sheet (Google Drive; ask
  a maintainer for access), with a code-grounded analysis pass dated **2026-07-18**. It predates
  the 2026-07-19 booking merges, so its booking rows read stale: the booking domain is merged;
  only the prod promotion (the 1.2.0 cut) remains. Server file:line citations quoted from it are
  attributed as *per the 2026-07-18 backlog analysis (server-side, not re-verified here)*.
- **Red/green** — house rule: every behaviour change ships with a Playwright spec that failed
  before and passes after (`dashboard-testing-and-e2e`).
- **The release gate** — as of 2026-07-19 `dev` is **70 commits ahead of master**, release PR
  **#125** ("chore(dev): release 1.2.0") is open, and there has been no prod deploy since
  **2026-06-01**. "Waiting-on-release" means the candidate needs that 1.2.0 cut live in prod.

---

## Part A — Platform health candidates

Each item: why it matters / current state (verified in the tree **2026-07-19**) / leverage /
first steps / a falsifiable "you have a result when…". These map 1:1 to GitHub issues — the issue
body has the full remediation detail; do not copy it here.

### PH1. Upgrade train — Angular 22 / apollo-angular 14 / NGXS 22 / TS 6 — status: open (#112)

**Why:** the stack is current-LTS today but the next majors are all released and interlock via
peer ranges; drifting further behind makes every later upgrade more expensive.

**Current state (verified):** `@angular/core 21.2.17`, `apollo-angular ^13.0.0`,
`@apollo/client ^4.1.7`, `@ngxs/store ^21.0.0`, `typescript ~5.9.3` in `package.json`. All one
major behind the #112 targets.

**Leverage:** the P1–P11 Angular-21 train is the proven playbook — one commit per checkpoint,
`ng build --configuration production` + full e2e between steps. The certified e2e suite is the net.

**First steps:** (1) branch; run `ng update` and read each library's compat table to fix ordering;
(2) one checkpoint commit per library, prod build + e2e green between each; (3) heed the
`dashboard-architecture-contract` invariants — Apollo v4 frozen responses and the NGXS/CSP wiring
are the fragile seams an upgrade can break.

**Result when:** the app builds prod-clean and the full e2e suite is green on the four bumped
majors, with no new CSP or Apollo-freeze regressions.

**Sequencing note:** interacts with **PH2** — the native-tables refactor is easier to land on the
current major *before* the framework bump, but the upgrade must not wait on PH2 if PH2 slips.
Coordinate, don't serialise blindly.

### PH2. Replace jQuery DataTables with native Angular tables — status: open, gated (#113)

**Why:** jQuery + `datatables.net-*` is the app's largest legacy dependency cluster and the main
blocker to a zoneless future (its callbacks run outside Angular scheduling).

**Current state (verified):** `datatables.net ^2.3.7`, `datatables.net-bs5 ^2.3.7`, `jquery ^3.5.1`
present; DataTables is imported across ~10 components plus `app-grid.directive.ts` and
`datatables-types-shim.d.ts`. Server-side paging already flows through GraphQL `*Connection`
queries, so only the table chrome needs replacing.

**Leverage:** build one signal-based OnPush table shell, pilot on a low-risk index, then sweep; the
Batch 5 write-flow e2e suite covers every index page.

**First steps:** (1) confirm **PH3** is green first (issue says "depends on OnPush fan-out"); (2)
prototype the shell on one index; (3) sweep with prod build + e2e between components.

**Result when:** one index renders on the native shell with paging/sort/search parity and its e2e
spec green — jQuery/DataTables removable from that component's bundle path.

**Sequencing:** after **PH3**; strongly precedes **PH4**.

### PH3. OnPush fan-out after the donor-index pilot — status: ready-now (#114)

**Why:** OnPush cuts per-event change-detection work and is the prerequisite for zoneless.

**Current state (verified):** `donor-index.component.ts` is the **only** component on
`ChangeDetectionStrategy.OnPush` — the PR #111 pilot, pinned red/green by
`e2e/tests/donor-onpush.spec.ts`. Every other index is still default CD.

**Leverage:** the pilot established the safe pattern (`cdr.markForCheck()` in the DataTables ajax
callback and in `applyFilter()`); the fan-out is mechanical but each template needs the same audit.

**First steps:** (1) confirm the pilot has soaked on UAT without stale-UI reports; (2) audit each
target component's template for state mutated from modal views / async callbacks; (3) apply OnPush
+ `markForCheck` per component, red/green each.

**Result when:** the listed index components are on OnPush with no stale-UI regressions and their
e2e specs green.

**Sequencing:** unblocks **PH2** and **PH4**. This is the keystone of the Part-A CD work.

### PH4. Zoneless change detection — status: blocked-internal (#115)

**Why:** dropping zone.js cuts bundle size and per-event CD cost app-wide.

**Current state (verified):** not started; blocked by its two prerequisites still being open.

**Leverage / dependencies:** requires **PH3** complete (zoneless needs explicit notification
everywhere) and *strongly prefers* **PH2** first (DataTables callbacks run outside Angular
scheduling). Third-party audit (toastr, ng-bootstrap, formly, ng-select, Apollo) at time of work.

**First steps:** (1) do not start until PH3 is green and PH2 has landed (or accept auditing every
jQuery callback path by hand); (2) enable zoneless on a branch; (3) full e2e + manual CD-smoke.

**Result when:** the app runs zoneless with zone.js out of the bundle and the full e2e suite green.

**Sequencing:** strictly **after PH3**, and after **PH2** unless you accept the callback-audit cost.

### PH5. FontAwesome 5 → 7 — status: ready-now (#116)

**Why:** debt burn-down; FA5 is two majors stale.

**Current state (verified):** `@fortawesome/fontawesome-free ^5.14.0`.

**First steps:** (1) bump; (2) reconcile renamed/retired icon classes across templates; (3) prod
build + visual e2e smoke.

**Result when:** FA7 in `package.json`, no missing-glyph regressions, prod build clean.

### PH6. Auth0 token cache out of localStorage — status: ready-now (#117)

**Why:** an XSS foothold can read a bearer token out of localStorage; in-memory caching shrinks
that blast radius.

**Current state (verified):** `cacheLocation: 'localstorage'` at **`src/main.ts:68`** (the Auth0
config). `useRefreshTokens` behaviour must be re-checked when moving to in-memory so silent renewal
still works.

**First steps:** (1) switch to in-memory cache on a branch; (2) verify login, refresh, and a hard
reload still authenticate (the SDK falls back to iframe/refresh-token renewal); (3) run the live-UAT
e2e login path.

**Result when:** no bearer token is present in localStorage after login and every auth flow (login,
silent refresh, reload) still passes on UAT.

### PH7. quill XSS advisory watch — status: watch (#118)

**Why:** GHSA-v3m3-f69x-jf25 tracks a quill XSS advisory; the dashboard uses quill in the notes
rich-text editor.

**Current state (verified):** `quill ^2.0.3`, `ngx-quill ^30.0.0`. This is a *watch* item, not a
fix — no patched version to move to yet. Note the overlap with **SE1/#63** (rich-text device notes):
if #63 expands quill's surface, re-weight this.

**First steps:** (1) periodically re-check the advisory for a fixed release; (2) when one ships,
bump and verify the notes editor; (3) until then, sanitise/validate any quill-authored HTML on
render.

**Result when:** either quill is on a patched version, or the advisory is confirmed not-applicable
to how the dashboard uses it, recorded with the date checked.

### PH8. Self-host Poppins / drop Google Fonts from CSP — status: ready-now (#119)

**Why:** first-paint drops a third-party request chain, and two origins come out of the CSP —
this is genuine debt burn-down (CSP tightening), which is why it lives in Part A, not out-of-scope
public-surface perf. The perf gain is a side effect; the *policy simplification* is the advancement.

**Current state (verified):** `src/sb-admin.css:14` does `@import url('https://fonts.googleapis.com
/css2?family=Poppins…')`; `src/staticwebapp.config.json` carries `fonts.googleapis.com` in
`style-src` and `fonts.gstatic.com` in `font-src` solely to permit it.

**First steps:** (1) vendor the Poppins woff2 weights actually used into `src/assets/fonts/` and
replace the `@import` with a local `@font-face`; (2) remove both origins from the CSP; (3) run the
CSP probe (`node e2e/csp-probe.mjs`) against UAT to confirm no violation.

**Result when:** no request to `fonts.g*.com` on load and both origins are gone from
`staticwebapp.config.json` with the CSP probe green.

### PH9. Delete dead createApi modals — status: ready-now (#120)

**Why:** two `createApi` ng-templates reference handler methods that don't exist — dead template
code that can never open, noise for the next reader.

**Current state (verified via issue):** `kit-component/kit-component.html` and
`user-index/user-index.html`. XS.

**First steps:** (1) delete the templates and now-unused refs/imports; (2) `ng build --configuration
production` + `npm run e2e:fast`.

**Result when:** both templates gone, prod build and fast e2e green. Cheapest item on the board.

### PH10. CI package-lock so `npm ci` works — status: ready-now (#121)

**Why:** CI reproducibility — a Linux-regenerated lockfile lets CI use `npm ci` instead of a
looser install.

**Current state:** per issue #121 (CI tooling; not a runtime change). Verify the current CI install
step before acting.

**First steps:** (1) regenerate `package-lock.json` on Linux; (2) switch the workflow to `npm ci`;
(3) confirm a clean CI run.

**Result when:** CI installs via `npm ci` from a committed Linux lockfile and passes.

---

## Part B — Staff efficiency UX candidates

The B-series issues plus the dashboard-relevant rows of the staff backlog spreadsheet. Server-side
rows (sheet items 4, 5, 6, 7, 8, 9, 10, 13, 19, 20, 21) are **out of scope here** and appear only
where they gate a dashboard candidate — their home is techaid-server's `techaid-roadmap-and-frontier`.

### SE1. B-series ops-UX quick wins — status: ready-now (#60, #61, #62, #63)

**Why:** four small, independent friction-removers in the daily admin flow. Highest ratio of
staff-time-saved to build cost on the board.

**Current state (open, ready-now):**
- **#60 (B-01)** — show user initials in the header instead of full name.
- **#61 (B-02)** — auto-save device-edit form changes. *Heed `dashboard-architecture-contract`:
  Formly `resetOnHide` and the Apollo-v4 frozen-response trap both bite auto-save flows.*
- **#62 (B-03)** — auto-refresh the notes list after add/delete instead of a full page reload.
- **#63 (B-04)** — switch device notes to a rich-text editor (bold/bullets/links). *Overlaps
  **PH7** — this expands quill's surface, so re-weight the XSS watch when it lands.*

Note: **#64 (B-05)** and **#65 (B-06)** are the same series but already **status: in-uat** — they
ship with the 1.2.0 release, so they are not candidates, just context.

**Leverage:** each is a single-component change with an obvious red/green spec; no cross-cutting
refactor. Keep them scoped (one PR per issue, per the triage discipline).

**First steps:** pick the smallest (#60), red/green it, ship to `dev`; repeat. #61 needs the most
care (form-state + save semantics).

**Result when:** each issue has a merged PR with a failing-first Playwright spec now green.

### SE2. Scan-session foundation — status: blocked-external (sheet item 3)

**Why:** a barcode-driven device-update flow (scan CTA-ID → scan action code → auto-apply) is the
foundation for the whole scan programme (SE3, and the physical station in sheet item 9). It is
*all-frontend* work in this repo.

**Current state / split (per the 2026-07-18 backlog analysis, server-side not re-verified here):**
the backend needs **nothing new** — the `updateKits(ids, status)` bulk mutation is already the
scan-apply primitive. All new work is a **shared Angular scan-session service**: a focused-input
keybuffer (scanners type + Enter, no hardware API), CTA-ID-vs-action-code parsing by prefix, and a
pluggable mode strategy reused by SE3. Action codes are pure frontend mappings to `updateKits`.

**Blocked-external prerequisite:** sheet **row 20** — a five-minute physical spike confirming that
printed device labels actually carry *scannable* barcodes (the label PDFs come from an external
Google Apps Script, unverifiable from either repo). If labels lack barcodes, an Apps Script change
becomes extra scope. **Do not design SE2 until row 20 is confirmed.** This is a physical/external
gate owned outside this repo.

**First steps:** (1) confirm row 20; (2) design the scan-session service (keybuffer + prefix parse
+ mode strategy); (3) wire one mode (e.g. OS-install status apply) end-to-end against `updateKits`
with a visual error-scan check, red/green.

**Result when:** an operator can scan a device label + an action code and see the kit's status
update, with a bad scan rejected visibly — proven by a Playwright spec driving synthetic scan input.

### SE3. Device prep mode — status: blocked, strictly after SE2 (sheet item 14)

**Why:** a "device prep" page that opens a day/week queue of requests, shows requested items, lets
staff scan kits to fulfil, marks the request prepped, and advances to the next. Phase two of the
scan programme.

**Current state / split (per the 2026-07-18 backlog analysis, server-side not re-verified here):**
backend is **done** — requests are filterable by `collectionDate` range, typed per-request item
counts exist, `assignKitsToDeviceRequest` (bulk) exists, and an `isPrepped` completion flag exists.
All new work is the **dashboard sequential prep-mode UI** built on SE2's scan foundation. Optional
server-side kit-type-vs-count *enforcement* (as opposed to display) is a separate server candidate.

**Product decision needed** (before build): how to handle substitutions, partial preps, and
skip-to-next.

**First steps:** (1) land SE2; (2) settle the substitution/partial-prep rules with Tony; (3) build
the queue → open → scan → validate → set-prepped → advance loop, red/green.

**Result when:** an operator can work a day's request queue end-to-end by scanning, with each
request marked prepped and the next opening automatically — proven by an e2e spec.

**Sequencing:** **strictly after SE2** (shares its scan service). Also gates **SE6**.

### SE4. Admin exception bookings — status: waiting-on-release + policy decision (sheet item 17)

**Why:** staff regularly need to book a collection outside the normal capacity rules (e.g. squeeze
a missed beneficiary into a "full" day). Today it is handled inconsistently. A quick win once the
booking domain is live in prod.

**Current state / split (per the 2026-07-18 backlog analysis, server-side not re-verified here):**
capacity enforcement is fully backend (pessimistic lock + capacity re-check in the public mutation;
the frontend only *displays* availability), so an admin bypass is safe to add server-side. The
**server half** is one authenticated mutation (`submitDeliveryBookingAdmin`) reusing the booking
save + email but skipping capacity/offered-date/Turnstile — that belongs to techaid-server's
roadmap. The **dashboard half** (this repo's candidate) is a **small admin form** in the existing
delivery-slots admin screen, plus a `PublicSurfaceAuthorizationTest` case on the server side.

**Blocked by:** (a) the booking domain being **live in prod** — i.e. the 1.2.0 release cut
(waiting-on-release); (b) a **policy decision**: do admin bookings count against the displayed
window capacity? The build is smaller than the policy discussion.

**First steps:** (1) ship the release; (2) settle the exception policy + capacity-display question
with Tony; (3) build the admin form once the server mutation exists (coordinate the cross-repo PR
pair so they don't diverge).

**Result when:** an admin can create an exception booking on a "full" day from the delivery-slots
screen, gated by role, with the public capacity path unchanged (existing public-surface tests green).

### SE5. Deliveries in the app — driver view — status: waiting-on-release, cross-repo (sheet item 16)

**Why:** the strongest impact case in the backlog — completing deliveries in-app closes requests
immediately (easing the 3-request limit) and automates status updates. Also the **highest scope**.

**Current state / split (per the 2026-07-18 backlog analysis, server-side not re-verified here):**
mostly **server-side** — the `DeliveryBooking` entity links to requests via a free-text
`ctaReference` (no FK); the server work is a `ctaReference`→FK migration with backfill, a new
`Delivery` bundling entity, status mutations, and Envers mirroring, plus a **GDPR retention sweeper**
(storing beneficiary addresses breaks the deliberate no-client-PII invariant — the retention
automation, patterned on the server's decline scheduler, must ship in the *same* release). All of
that is techaid-server's roadmap. The **dashboard half** (this repo's candidate) is a **phone-usable
driver status view** designed around the driver's real usage (load for the day, plan order, complete,
add notes).

**Blocked by:** booking domain in prod (SE4's release gate), the server-side model-convergence
decision with the booking/exception work, and the server retention pattern (sheet row 19) landing.

**First steps:** (1) do not start the dashboard view until the server `Delivery` model is designed
and the convergence decision with SE4 is made; (2) prototype the phone-first driver view against the
new server surface; (3) red/green the complete-delivery flow.

**Result when:** a driver can, on a phone, see the day's deliveries, complete one, and have the
linked request auto-close — proven end-to-end once the server side exists. Large; gate carefully.

### SE6. Supply-led request availability — status: blocked, after SE2/SE3 (sheet item 15)

**Why:** auto-toggle request types (e.g. phones on/off) based on live stock counts at a given
status — removes a manual gate.

**Current state (per the 2026-07-18 backlog analysis):** technically a simple threshold toggle on
stock-status counts, but it depends entirely on **record accuracy**, which the scan flows (SE2/SE3)
are what deliver. Cheap follow-on *after* those land, not before. No owner/size on the sheet.

**First steps:** (1) land SE2 and SE3 so stock counts are trustworthy; (2) confirm the toggle is a
display/config concern vs a server rule (likely both — server owns the enforcement); (3) size it.

**Result when:** a request type visibly auto-disables when its stock threshold is crossed, on data
staff trust. Low priority until data hygiene is proven.

### SE7. Public / client portal — status: gated, late (sheet item 2)

**Why:** a public portal (donor wipe-report access; referee request monitoring by membership tier;
possibly impact reporting). High strategic value, sequenced **late**.

**Current state / gates (per the 2026-07-18 backlog analysis):** gated by an **Auth0 app audit**
(the free-tier 10-app ceiling constrains separate donor/referee apps) and by the **reporting-layer
decision** (sheet item 12 / the Superset PoC — see below). A new public surface also inherits the
scale-to-zero cold-start, so reuse a "waking up" interstitial. Recommend **splitting**: donor
wipe-report access (smaller, clear value) vs referee monitoring (larger, needs a tiered-access
model).

**First steps:** (1) complete the Auth0 app audit; (2) await the Superset PoC verdict on the
reporting layer; (3) scope the donor-wipe-report slice first.

**Result when:** the audit + PoC outcomes are recorded and the smaller donor slice has a scoped,
sequenced design. Not build-ready today.

### Reference only — reporting PoC (sheet item 12, "Dashboard functionality")

This is the **Superset reporting PoC in embryo** (stakeholders Cat + Mahi), *already in flight
elsewhere* — not a techaid-dashboard build candidate. Its outcome decides SE7's reporting approach
(and whether PowerBI is on the table at all). The data-exposure half lives in techaid-server's
roadmap (its `B1 — impact analytics` candidate). Listed here only so nobody re-opens it as
dashboard work or explores PowerBI in parallel with Superset.

---

## Suggested near-term sequence

Reconciles the staff backlog spreadsheet's suggested order with the advancement definition and
today's repo state. This is a *recommendation*, not a commitment — each step still runs the
promotion protocol.

0. **Ship release 1.2.0 first.** This is an **operation, not a roadmap item** — execute it via
   `dashboard-release-and-deploy`, not from this skill. It unblocks everything waiting-on-release
   (the booking domain in prod, #64/#65 landing, and SE4/SE5). Today `dev` is 70 commits ahead of
   `master`; nothing in Part B's booking cluster can proceed until this lands.
1. **Ready-now platform quick wins:** PH9 (#120, XS) → PH8 (#119, S, CSP win) → PH5 (#116) →
   PH10 (#121). Cheap debt burn-down, no dependencies.
2. **Ready-now ops-UX quick wins:** SE1 (#60 → #62 → #63 → #61, easiest first).
3. **The CD chain:** PH3 (#114 OnPush fan-out) → PH2 (#113 native tables) → PH4 (#115 zoneless),
   in that order; coordinate PH1 (#112 upgrade train) around PH2. PH6 (#117) can slot in anywhere.
4. **The scan programme:** confirm the row-20 barcode spike (external) → SE2 (scan foundation) →
   SE3 (prep mode) → SE6 (supply-led).
5. **Booking follow-ons (post-release):** SE4 (admin exceptions, after policy call) → SE5 (driver
   deliveries, large, cross-repo, retention-gated).
6. **Late / gated:** SE7 (portal) once the Auth0 audit and Superset PoC settle.

---

## Explicitly out-of-scope-for-now

Real work, but **not** advancement per Tony's definition. Listed so it is not silently re-adopted:

| Item | Why out of scope |
|---|---|
| Public-surface *performance* (booking cold-start interstitial, first-paint tuning beyond PH8) | Support rail, not staff-ops throughput. *PH8 is in-scope because it is CSP/debt burn-down; the perf gain is incidental.* |
| Test/deploy automation for its own sake — #59 (T-04 Playwright-in-CI), #57 (T-02 endpoint hardening), #58 (T-03 key rotation) | Support rails. In-scope only as much as a specific candidate needs (e.g. a candidate's own red/green spec). |
| Server-side sheet items — 4, 5, 6, 7, 8, 9(software half), 10, 13, 19, 21 | → techaid-server `techaid-roadmap-and-frontier`. Appear here only where they gate a dashboard candidate. |
| Physical / workshop items — sheet 9 (station), 20 (barcode spike), 21 (locate HW script) | Physical/external. Row 20 is tracked only as SE2's blocking prerequisite. |
| Reporting PoC — sheet 12 / Superset | Already in flight elsewhere (Cat + Mahi); data half → server roadmap. Reference-only above. |
| Filed bugs — #76, #77, #82; question #42 | Not roadmap candidates → `triage-issues`. |
| The 1.2.0 prod cut itself | An operation → `dashboard-release-and-deploy`. |

---

## Promoting a candidate to actual work

No item here self-authorises. The route is always:

1. **Check it is still open** — run the re-verification one-liner (below) or `gh issue view <n>`;
   retire solved items from this file.
2. **Settle the decision** where the item names one (SE3 substitution rules, SE4 exception policy,
   SE7 split) — that is Tony's call, not the implementer's.
3. **Scope to the issue** — one PR per issue/candidate, base `dev`, conventional-commit title so
   release-please picks the bump. Do not fan out into adjacent patterns (the triage-workflow rule).
4. **Red/green it** — every behaviour change ships a failing-first Playwright spec now green
   (`dashboard-testing-and-e2e`); `ng build --configuration production` is the structural gate.
5. **Ship to `dev` → UAT**, then leave the prod-cut decision to the release workflow
   (`dashboard-release-and-deploy`). PRs never target `master`.

When an item finishes or is rejected, update **this file** (status → done/retired with the PR
number) and close the GitHub issue (remember: `Fixes #N` does **not** auto-close on a `dev` merge —
close it by hand).

## Provenance and maintenance

Authored **2026-07-19** from: (a) the live GitHub tracker (issues #60–#63, #112–#121 read that day —
the canonical candidate detail lives in the issue bodies, not here); (b) direct repo verification
against `dev` on 2026-07-19 (versions, OnPush, `src/main.ts:68`, `src/sb-admin.css:14`, CSP origins,
`dev` 70 ahead of `master`, PR #125 open, last prod deploy `2026-06-01`); (c) the staff backlog
spreadsheet's code-grounded analysis pass dated **2026-07-18** (external, Google Drive — ask a
maintainer; its server file:line citations are second-hand and marked as not re-verified here).
Dates and line numbers drift — re-verify before acting:

- **PH1** stack still behind: `node -e "const d=require('./package.json').dependencies; console.log(d['@angular/core'], require('./package.json').devDependencies.typescript)"` (21.x / 5.9 = still open)
- **PH2** DataTables still present: `grep -rln "datatables.net" src/ | wc -l` (non-zero = open)
- **PH3** donor-index still sole OnPush: `grep -rln "ChangeDetectionStrategy.OnPush" src/` (one hit = fan-out not done)
- **PH5** FA still v5: `grep fontawesome-free package.json`
- **PH6** token still in localStorage: `grep -n cacheLocation src/main.ts`
- **PH7** quill version: `grep '"quill"' package.json` + re-check GHSA-v3m3-f69x-jf25
- **PH8** Poppins still remote: `grep -n googleapis src/sb-admin.css src/staticwebapp.config.json`
- **PH9/PH10**: `gh issue view 120` / `gh issue view 121`
- **SE1**: `gh issue list --state open --search "B-0 in:title"`
- **Release gate**: `git rev-list --count origin/master..origin/dev` and `gh pr view 125 --json state`
- **SE2 barcode gate (row 20)** and all sheet items: the staff backlog spreadsheet (external, 2026-07-18)
