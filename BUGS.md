# Bug Tracker — Post-Upgrade Issues

Each bug follows a red/green test cycle:
- **Red**: a test (Playwright e2e or build check) that fails before the fix
- **Fix**: the code change
- **Green**: the same test passes after the fix

Status key: `[ ]` open · `[x]` fixed · `[-]` won't fix / by design

---

## BUG-01 · Settings dropdown opens the home page instead of the menu

**Symptom**: Clicking the top-right initials/avatar navigates to `/` (home) instead of opening the user dropdown.

**Root cause (identified)**: The header template ([app.header.component.html:23](src/app/components/app-header/app.header.component.html#L23)) uses Bootstrap 4 `data-toggle="dropdown"` and `data-toggle="modal"`. Bootstrap 5 requires `data-bs-toggle`. Without the attribute the `<a href="#">` falls through and navigates to the root.

**Files**: [app.header.component.html](src/app/components/app-header/app.header.component.html)

**Fix**: Changed `data-toggle="dropdown"` → `data-bs-toggle="dropdown"` on the nav-item toggle anchor. Removed vestigial `data-toggle="modal" data-target="#logoutModal"` from the logout link (the `(click)="logout()"` handler is what fires; no modal exists).

**Status**: [x]

---

## BUG-02 · Device record pages load blank (devices/1234 or click from table)

**Symptom**: Navigating to `/dashboard/devices/1234` shows a blank page (side and top menus appear, content area is empty).

**Root cause**: `Lightbox` from `ngx-lightbox` was injected in the `KitInfoComponent` constructor but `LightboxModule` was never imported anywhere in the app. Angular threw a `NullInjectorError` at route activation, which blanked the content area. `this.lightbox` was never called in the component — the dependency was dead.

**Fix**: Removed `import { Lightbox } from 'ngx-lightbox'` and the `private lightbox: Lightbox` constructor parameter from [kit-info.component.ts](src/app/views/corewidgets/components/kit-info/kit-info.component.ts). Also removed the unused `ViewEncapsulation` import.

**Status**: [x]

---

## BUG-03 · Tables show "No matching records found" / "No data available" on load

**Symptom**: Requests, Referees, Organisations index tables display an empty-state message immediately on page load instead of showing rows.

**Root cause**: DataTables 2.x renamed its empty-row CSS class from `dataTables_empty` to `dt-empty`. The global `display: none` rule in `styles.css` targeted the old class, so the DataTables-generated empty row was visible. Because Angular's `@if (entities?.length != 0)` renders no `<tbody>` while entities is empty, DataTables creates its own tbody with the empty row above Angular's data tbody — making the message appear above the real data.

**Fix**: Added `td.dt-empty { display: none; }` alongside the legacy `.dataTables_empty` rule in [styles.css](src/styles.css).

**Status**: [x]

---

## BUG-04 · Distributions & Deliveries table shows "No data available in table"

**Symptom**: D&D index page shows the DataTables empty-state row on load.

**Root cause**: Same as BUG-03 — DataTables 2.x `dt-empty` class not hidden by CSS.

**Fix**: Same CSS addition as BUG-03.

**Status**: [x]

---

## BUG-05 · Dashboard emoji icon overlaps the blue nav bar on the right

**Symptom**: The `fa-laugh-wink` icon in the top nav-scroller bar is visually clipped against the right edge.

**Root cause (TBD)**: Layout / padding issue in `.nav-scroller` or the Bootstrap 5 navbar. Check [app.header.component.html:86-99](src/app/components/app-header/app.header.component.html#L86).

**Files**: [app.header.component.html](src/app/components/app-header/app.header.component.html), [styles.css](src/styles.css)

**Status**: [ ]

---

## BUG-06 · Tab colour inconsistency on record detail pages

**Symptom**: Inside a referee/org/request/donor record, some tabs render in a brighter blue than others (e.g. "Device Requests" tab vs "Details" tab).

**Root cause (TBD)**: Mixed use of ng-bootstrap `ngbNav` tabs vs plain Bootstrap 5 `nav-link` markup. The two sets pick up different CSS custom-property values. Inspect which tabs in which components are not wrapped in `ngbNavLink`.

**Files**: [referring-organisation-contact-info.component.html](src/app/views/corewidgets/components/referring-organisation-contact-info/referring-organisation-contact-info.component.html), [referring-organisation-info.component.html](src/app/views/corewidgets/components/referring-organisation-info/referring-organisation-info.component.html), [donor-info.html](src/app/views/corewidgets/components/donor-info/donor-info.html), [donor-parent-info.html](src/app/views/corewidgets/components/donor-parent-info/donor-parent-info.html)

**Status**: [ ]

---

## BUG-07 · Every table row turns blue when clicked

**Symptom**: Clicking any row in any DataTable highlights it with a solid blue background.

**Root cause**: DataTables 2.x Bootstrap 5 CSS (`dataTables.bootstrap5.css`) added `table.table.dataTable > tbody > tr.selected > * { box-shadow: inset 0 0 0 9999px rgb(13,110,253) }`. Index templates apply `[class.selected]="selections[dt.id]"` to rows for selection tracking, so every clicked row gets the full opaque-blue treatment. In DataTables 1.x / Bootstrap 4 the same class was far less visible.

**Fix**: Overrode the DataTables 2.x selector in [styles.css](src/styles.css) to use a subtle 12% opacity tint instead of the opaque blue box-shadow, and restored `color: inherit` so text remains readable.

**Status**: [x]

---

## BUG-08 · Device Requests status section shows no colour

**Symptom**: The coloured status radio buttons inside a device request record are rendered without background colours.

**Root cause**: [styles.css](src/styles.css) targeted `.device-request-status .custom-control` and `.kit-status .custom-control`. Bootstrap 5 renamed `custom-control` to `form-check`; the selectors no longer matched any rendered element.

**Fix**: Duplicated both colour-block rule sets in [styles.css](src/styles.css) using `.form-check` as the child selector (kept the old `.custom-control` rules intact above for reference). No template changes needed.

**Status**: [x]

---

## BUG-09 · Audit table for device requests shows "no data!"

**Symptom**: The Audit Table tab inside a device request record shows a "no data!" message.

**Root cause (TBD)**: Check [device-request-audit-component.component.ts](src/app/views/corewidgets/components/device-request-audit-component/device-request-audit-component.component.ts) — Apollo query or DataTables init likely broken.

**Files**: [device-request-audit-component.component.ts](src/app/views/corewidgets/components/device-request-audit-component/device-request-audit-component.component.ts), [device-request-audit-component.html](src/app/views/corewidgets/components/device-request-audit-component/device-request-audit-component.html)

**Status**: [ ]

---

## BUG-10 · DataTables pagination control is centred instead of right-aligned

**Symptom**: The page-number selector at the bottom of every table is horizontally centred.

**Root cause**: DataTables 2.x Bootstrap 5 integration no longer floats the pagination; it uses a flex layout without `justify-content: flex-end`. The old DataTables 1.x used Bootstrap 4 `float-right` which no longer exists.

**Fix**: Added a `@media (min-width: 768px)` rule to [styles.css](src/styles.css) that sets `display: flex; justify-content: flex-end` on `div.dt-paging`. Mobile remains centred (already set by the DataTables BS5 stylesheet).

**Status**: [x]

---

## BUG-11 · Address lookup broken when creating a new referee

**Symptom**: The address lookup field on the "Create Referee" form does nothing / returns no results.

**Root cause (TBD)**: Google Places Autocomplete (`pac-container` z-index is set in [styles.css:192](src/styles.css#L192), so the widget is configured somewhere). Check for a broken API key, missing script load, or a broken formly field type.

**Files**: [referring-organisation-contact-index.component.ts](src/app/views/corewidgets/components/referring-organisation-contact-index/referring-organisation-contact-index.component.ts) or the relevant formly field type in [src/app/shared/modules/formly/](src/app/shared/modules/formly/)

**Status**: [ ]

---

## BUG-12 · Defunct "View Map" button on Devices page

**Symptom**: A "View Map" button appears next to the Bulk Update control on the Devices index. The Map feature is defunct.

**Root cause**: Hard-coded `<a routerLink="/dashboard/map">View Map</a>` button was left in [kit-index.html](src/app/views/corewidgets/components/kit-index/kit-index.html) from a feature that no longer exists.

**Fix**: Removed the `<a>` element entirely.

**Status**: [x]

---

## BUG-13 · Show/Hide device types in device requests does nothing

**Symptom**: Clicking "show/unhide device types" in the device requests view has no visible effect (expected to expand/collapse the device type list).

**Root cause (TBD)**: Likely uses Bootstrap 4 `data-toggle="collapse"` / `data-target` which became `data-bs-toggle` / `data-bs-target` in Bootstrap 5.

**Files**: [device-request-index.component.html](src/app/views/corewidgets/components/device-request-index/device-request-index.component.html) or [device-request-info.component.html](src/app/views/corewidgets/components/device-request-info/device-request-info.component.html)

**Status**: [ ]

---

## BUG-14 · Clicking a date on D&D page shows no records

**Symptom**: Selecting a date filter on the Distributions & Deliveries page returns an empty table even when records exist for that date.

**Root cause (TBD)**: Date filtering logic in [distributions-and-deliveries-index.component.ts](src/app/views/corewidgets/components/distributions-and-deliveries-index/distributions-and-deliveries-index.component.ts). May be a format mismatch or a broken DataTables column search.

**Files**: [distributions-and-deliveries-index.component.ts](src/app/views/corewidgets/components/distributions-and-deliveries-index/distributions-and-deliveries-index.component.ts), [distributions-and-deliveries-index.component.html](src/app/views/corewidgets/components/distributions-and-deliveries-index/distributions-and-deliveries-index.component.html)

**Status**: [ ]
