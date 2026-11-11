# Native tables plan (#113), then zoneless (#115)

Resumable project plan. Each milestone is a commit-sized pause point: stop after any of them and
the tree builds, passes `@mocked`, and the app works (DataTables and the native shell coexist
until the removal milestone).

**Status (update this block on every pause)**

| Milestone | State |
|---|---|
| M1 shell + role-index pilot | DONE (PR #341) |
| M2 audit tables | DONE (PR M2-M4, commit 1) |
| M3 users-admin cluster | not started |
| M4 post-index, dashboard-index | not started |
| M5 onward | not started |

### Progress notes (newest last)

**M2 (done).** `kit-audit-component` and `device-request-audit-component` no longer use DataTables.
They hold rows in signals (`entities` / `allEntities` / `loaded`), are `OnPush`, and keep their
ids (`kit-audit-<id>`, `device-request-audit-<id>`) so `audit-system-label` and `bugs` still
select them. Notes:

- The old components sent a `page` variable the audit queries do not declare, and read a
  `search$` term that was never forwarded. Both are dropped; the header-search subscription still
  refetches (first emission skipped, it is the current value). The header search box has no
  element in the template today (`postSearch()` is never bound), so that refetch cannot be driven
  from e2e.
- "No data!" now appears only after the first answer (it showed from the first paint before).
- Zoneless (#115): nothing to do here, state is signals. Both were `Eager` before and only
  repainted because zone.js re-checked them.
- New spec: `e2e/tests/native-table-audit.spec.ts` (5 tests, `@mocked`; needs `admin:kits` and
  `admin:organisations` on top of the staff set to see the Audit tab).

Model strength: **S** = Sonnet-class is enough, **O** = Opus-class (design judgement, subtle
behaviour). Effort in focused hours; a milestone is one sitting or less unless noted.

## 1. Inventory

21 components render a DataTables table through `AppGridDirective` (`datatable` attribute +
`dtOptions`). Counts below were taken from the sources on 2026-11-11; `selection` = host keeps a
`selections` map and `tr.selected` class (visual only, plus bulk actions where noted).

### Server-side, paged, sortable, searchable (18)

| Component | pager | page length (menu) | default order | notes |
|---|---|---|---|---|
| role-index | full_numbers | 10 (5-100) | col 0 desc | **pilot, migrated** |
| user-index | full_numbers | 5 | col 3 desc | sends `'1'`/`'-1'` not asc/desc; most columns non-sortable; spec `issue-72-user-index-sort` |
| role-users | full_numbers | 5 | col 0 desc | child tab, `w-100`; add/remove mutations reload the table; col 0 non-sortable; e2e `user-admin` pages through it |
| role-permissions | full_numbers | 10, **no length menu** | col 1 desc | child tab, `Eager` CD |
| user-permissions | full_numbers | 10 | col 1 desc | child tab, `Eager`, mutation reloads |
| user-roles | full_numbers | 10 | col 1 desc | child tab, mutation reloads; table id is `user=roles` (contains `=`) |
| post-index | simple_numbers | 10 | col 2 desc | mutation (delete/publish), checkbox column |
| referring-organisation-index | simple_numbers | 10 | col 6 desc | filter modal, bulk selection, mutation |
| referring-organisation-contact-index | simple_numbers | 10 | col 7 desc | filter modal, selection, mutation |
| referring-organisation-contact-component | simple_numbers | 5 | col 7 desc | child tab of an organisation |
| donor-parent-index | simple_numbers | 10 | col 4 desc | filter modal, selection, mutation |
| donor-index | simple_numbers | 10 | col 5 desc | filter modal (count badge), selection, mutation; OnPush pilot spec |
| donor-component | simple_numbers | 10 | col 5 desc | child tab |
| device-request-index | simple_numbers | 10 | col 0 desc | filter modal, selection, non-sortable item columns |
| device-request-component | simple_numbers | 10 | col 0 desc | child tab, `Eager` CD |
| kit-component | simple_numbers | 5 | col 1 desc | child tab of a request/donor |
| kit-index | simple_numbers | 10 | col 1 desc | 1433 lines; biggest; filter modal, selection, bulk mutations (2), ID-list paste into the search box (spec `kit-id-list-bulk-update`) |
| distributions-and-deliveries-index | simple_numbers | 10 | col 0 desc | 830 lines; week/Failed/On hold quick buttons call `reload(resetPaging=true)`; `columnDefs orderSequence` override; `HostListener` |

### Server-side, no paging, no sort, no search (2)

`kit-audit-component`, `device-request-audit-component`: `paging:false, ordering:false,
searching:false`; DataTables is only a loader (ajax + `Eager`). These do not need the shell: they
become a plain `@for` over a signal. Cheapest migrations, no UX to match.

### Client-side (1)

`dashboard-index`: no `serverSide`; DataTables paginates and searches 5 rows per page over rows
Angular already holds, with a search box only. Needs a client-side mode of the shell (slice +
filter over a signal) or a tiny dedicated table. Note its table id is `donor-index` (a duplicate
of the real donor table id; harmless today because pages never co-exist, but the native
`<id>_wrapper` ids make it worth renaming).

### Features common to all server-side tables

- **Search**: DataTables' default 400 ms throttle for server-side mode, Enter fires at once, any
  new term resets to page 0. No component sets `searchDelay`.
- **Header search box**: every table subscribes to the NGXS `CoreWidgetState.query` and calls
  `table.search(q); table.ajax.reload(null, false)`, which **keeps the current page** (a quirk the
  shell keeps: `search()` on the shell does the same).
- **Info line**: `Showing x to y of z entries`, plus `(filtered from N total entries)`. Numbers
  use thousands separators.
- **`stateSave: true` everywhere**: page, length, order and search are kept in localStorage
  (`DataTables_<id>_<path>`, 2 h). The shell keeps this under `cta-table_<id>_<path>`; the first
  visit after release starts from defaults (decision 3).
- **`processing: true`**: the `dt-processing` overlay while a request is in flight.
- **Out-of-order responses**: every component uses `LatestDraw`; the shell now owns it.
- **Sort format**: `{ key: columns[col].data, value: 'asc'|'desc' }`, and `'1'`/`'-1'` for the
  two users tables.
- **Row rendering is Angular's**, not DataTables': components render `<tr>`s from `entities` and
  hand DataTables an empty `data: []`. This is why the migration is mostly chrome: the shell
  takes a row template and the host's `entities` field goes away.
- **No** component uses `drawCallback`, `createdRow`, `rowCallback`, `initComplete`, column
  visibility, export buttons, `responsive`, `scrollX` or DataTables events. Selection is
  Angular-side. (Grepped; none found.)
- **Global CSS coupled to DataTables classes**: `styles.css` hides `td.dt-empty`, right-aligns
  `div.dt-container div.dt-paging`, styles `table.dataTable tr.selected`; the Bootstrap 5 DataTables
  stylesheet is in `angular.json` `styles`.

### Other jQuery users that block removing jQuery (found during the inventory)

DataTables is not the only reason jQuery ships:

1. `src/app/components/app-header/app.header.component.ts:51`: `$('body').toggleClass('sidebar-toggled')`.
2. `src/sb-admin-2.min.js` (loaded through `angular.json` `scripts`) is an IIFE on the **global**
   `$`: a window `resize` handler plus an initial width check that toggle `body.sidebar-toggled`.

Both are a few lines of `classList` (M9). Until they move, jquery must stay in `scripts`. Also
`bootstrap.js` is in `scripts`; it does not need jQuery (Bootstrap 5) and is not touched here.

### E2E coverage today

Every DataTables page is covered by `onpush-fanout` (first render, 12 components),
`onpush-live-repaint` (live UAT, search repaint, 12 tables), `stale-search-response` (3),
`apollo-v4-mutation-regression`, `donor-onpush`, `distributions-and-deliveries-table`,
`exclude-status-filter`, `device-request-borough-filter`, `age-column-hidden`, `tabs`, `bugs`
(info line, pager alignment, empty cell), `issue-72-user-index-sort`, `user-admin` (users/role
tables against real Auth0), `kit-id-list-bulk-update`, `uat-release-pass` (4 indexes at desktop and
phone width). They select on `#<id> tbody tr`, `#<id>_wrapper`, `.dt-info`, `.dt-search input`,
`.dt-length select`, `.dt-paging button.page-link.next|previous`, `li.dt-paging-button`,
`td.dt-empty`. The shell emits exactly those, so those specs need no edits during the sweep.
Role-index had only the first-render check; `native-table-role-index.spec.ts` (10 tests) is new.

## 2. Design

`NativeTableComponent` (`cta-table`) in `src/app/shared/modules/native-table/`:

- **Signal-based, OnPush.** State (`page`, `pageSize`, `sortOrder`, `term`, `rows`, `total`,
  `loading`, `loaded`) is signals; the response callback writes signals, so no `markForCheck()`
  and nothing depends on zone.js (this is what #115 needs).
- **Host contract.** `[source]` is `(query) => Promise<{ rows, total }>`; `query` is
  `{ page, size, sort: [{key, dir}], term }`. The host maps it to its GraphQL variables (the
  users tables map `dir` to `'1'`/`'-1'` there). `[columns]` gives title, sort key, width. A
  `<ng-template ctaRow let-row>` renders the `<tr>`, so row classes, click handlers and the
  existing cell markup move over verbatim. `(loadError)` lets the host toast.
- **Frozen rows.** The shell never writes to a row. Hosts that derive fields do it inside
  `source` with map + spread.
- **Sort.** Asc first, then reverse on every click (#336); a different column starts asc;
  sorting or changing length or search returns to page 0. Header has `aria-sort`; the sort icon
  is a focusable `role=button` handling Enter/Space.
- **Search.** 400 ms after the last keystroke, Enter immediately, unchanged term is a no-op.
  Public `search(term)` for the header search box keeps the current page; `reload(resetPage)`
  replaces `ajax.reload(null, resetPaging)`.
- **Info line and pager** replicate DataTables 3 text and markup, including the 7-slot page
  number algorithm with ellipses, first/last for `full_numbers`.
- **State saving** as above, with a 2 h expiry, try/catch around storage.
- **Markup compatibility.** The shell reproduces DataTables' DOM and class names, so the
  DataTables Bootstrap stylesheet still styles it and no e2e selector changes. Deliberate
  consequence: M10 must port the few CSS rules (sort arrows, pager, processing dots) into the
  shell before the stylesheet is dropped.

Deliberate small differences from DataTables (all improvements, listed so none is a surprise):

1. "No data!" shows only after the first response; DataTables-era pages flashed it while loading.
2. A failed request clears the rows (it used to leave the previous rows under a "0 entries" info line).
3. "filtered from N total" is shown only when N is actually known (the old code froze `total`
   at the first non-zero response, which was wrong if the first load was a restored search).
4. Saved state uses a new storage key, so users' remembered page length/order reset once.

## 3. Milestones

Order is lowest risk first: the plain table pages, then filter-modal pages, then the biggest.
Every milestone ends with: `npx ng build --configuration production`, `npm run lint` (no new
errors), `E2E_PORT=<free port> npm run e2e:fast` green, one conventional commit
(`refactor:` ... `Refs #113`).

| # | Milestone | Model | Effort | Pause point |
|---|---|---|---|---|
| M1 | Shell + role-index pilot + parity spec + this plan | O | 6 h | **done** |
| M2 | Audit tables (kit-audit, device-request-audit): drop DataTables for a plain signal list | S | 1.5 h | commit |
| M3 | Users admin cluster: user-index, role-users, role-permissions, user-permissions, user-roles. Needs the `'1'`/`'-1'` mapping in `source`, a no-length-menu table (`pageLengths=[]`), table id `user=roles`, mutation reloads via `reload()`. Re-run `issue-72` and `user-admin` (live) | O | 4 h | commit per 2-3 components |
| M4 | Simple filter-less indexes: post-index, then dashboard-index (needs a client-side mode: `source` over held rows, or a 20-line dedicated table) | S (post), O (client mode) | 3 h | commit |
| M5 | Referring organisations: referring-organisation-index, -contact-index, -contact-component. Filter modal calls `reload()`. | S | 3 h | commit |
| M6 | Donors: donor-parent-index, donor-index, donor-component. Re-run `donor-onpush` | S | 3 h | commit |
| M7 | Devices and requests: device-request-index, device-request-component, kit-component | O | 4 h | commit |
| M8 | The big two: distributions-and-deliveries-index (`reload(true)` from quick buttons, week-button date logic), then kit-index (1433 lines, bulk actions, ID-list paste in the search box) | O | 6 h | commit per component |
| M9 | Replace the two non-table jQuery uses (header toggle, `sb-admin-2.min.js` resize handler) with `classList` / a host listener; delete `sb-admin-2.min.js` from `scripts` if nothing else uses it | S | 1 h | commit |
| M10 | Removal: delete `app-grid.directive.ts`, `datatables-types-shim.d.ts`, `LatestDraw` (now internal), `jquery`, `datatables.net`, `datatables.net-bs5`, `@types/jquery` (and `@types/datatables.net*` if present) from `package.json`, the three `scripts` entries and `dataTables.bootstrap5.css` style entry and the `allowedCommonJsDependencies` entries in `angular.json`; port the needed DataTables CSS into the shell (sort arrows, pager alignment, processing); remove `.dt-empty`/`.dataTables_*` rules from `styles.css`; update the architecture-contract skill and CLAUDE.md. Run the full `@mocked` suite and the live `uat-release-pass` | O | 3 h | commit, PR |

Total after M1: about 28 h of focused work, 9 more commits. Suggested PR split: M2-M4, M5-M7,
M8, M9-M10, so each PR is reviewable and shippable alone.

### Removal and the bundle

Today `jquery` (about 280 kB raw) and DataTables + bs5 glue (about 430 kB source, minified in the
`scripts` bundle) ship in the initial bundle: `scripts-*.js` is 280 kB raw (82 kB transfer) in the
current production build, and `angular.json` also lists them in `scripts`, so the directive's own
imports can pull a second copy into `main`. The initial total is 2.71 MB against a 2.70 MB
budget (warning: 13.97 kB over; total-scripts budget 24.63 kB over). `scripts` contains jquery,
DataTables, DataTables-bs5, bootstrap.js and sb-admin-2; removing jquery and DataTables should take
roughly 200 kB raw off the initial bundle (expect about 60 kB transfer), which clears both
warnings with margin. **Measured number to be filled in by M10**; M1 changes nothing here because
DataTables is still loaded (the shell adds about 2 kB to the lazy role-index chunk).

## 4. Risks and decisions a human should weigh in on

1. **Visual parity relies on DataTables CSS until M10.** The shell reuses its class names. M10
   needs a browser pass at phone and desktop width (the `uat-release-pass` spec measures
   geometry).
2. **kit-index search-box ID-list paste** (`kit-id-list-bulk-update`) depends on typing/pasting
   into the search input and on Enter; the shell keeps both but M8 must re-run that spec.
3. **Saved table state resets once** (new storage key). Acceptable? Alternative: read the old
   `DataTables_*` entry once as a fallback (about 15 lines).
4. **"Selection" stays visual** in the shell; nothing in the inventory uses DataTables' Select
   extension, so there is nothing to port.
5. Lint baseline: the repo carries about 170 files of warnings (`no-explicit-any`,
   `prefer-inject`); migrated components are not required to fix them but should not add any.

## 5. Then #115 (zoneless)

Prerequisites: #114 OnPush fan-out (closed) and this plan through M10. After M10 no code runs
outside Angular's scheduling except the third-party libraries below.

| # | Milestone | Model | Effort |
|---|---|---|---|
| Z1 | Audit: grep every `subscribe`, `setTimeout`, `.then(` and event-listener that writes template state without a signal, `markForCheck()` or `async` pipe. Convert or mark. Include the Eager (default-CD) components: they only worked because zone.js re-checked them | O | 4 h |
| Z2 | Third-party check at current majors: ngx-toastr, ng-bootstrap 20, ngx-formly 11 (custom types in `shared/modules/formly`), ng-select, apollo-angular 13, NGXS 21, ngx-quill, auth0-angular 2. Note any that call `NgZone.run`/rely on `onStable` | S | 2 h |
| Z3 | Switch on in a branch: `provideZonelessChangeDetection()`, drop `zone.js` from `polyfills` (angular.json and `src/polyfills.ts`); fix what breaks, starting with Formly forms and NgbModal footers (`donor-index` `applyFilter` path) | O | 6 h |
| Z4 | Test: full `@mocked` suite, then live `onpush-live-repaint` and `uat-release-pass` against deployed UAT with the real CSP; add a spec that fails if `zone.js` is on `window` | O | 3 h |
| Z5 | Ship to UAT first, soak, then release; update the architecture-contract skill (sections 6, 12) and CLAUDE.md | S | 1 h |

Expected saving: `zone.js` is part of `polyfills` (about 170 kB raw in the current build; most of it zone.js).
