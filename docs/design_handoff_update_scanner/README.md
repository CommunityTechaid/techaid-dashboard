> **Note on this copy.** This is the design handoff that produced the Update
> Scanner page (`src/app/views/corewidgets/components/kit-scanner/`), kept as
> provenance for why the page looks and reads the way it does. The accompanying
> HTML prototype (`Update Scanner.dc.html`) and its runtime (`support.js`) are
> **deliberately not committed** — they are a design-tool artefact, not shippable
> code, and the built page supersedes them.
>
> Two things in here were superseded during the build and are left unedited so
> the original intent stays readable:
> - **Access gating.** This document proposes gating on `app:bulkedit` alone. The
>   shipped rule is `flagOn || hasAuthority('app:bulkedit')`, where the
>   `update-scanner` server feature flag *widens* access. See
>   `update-scanner-visible.guard.ts`.
> - **Armed/disarmed vocabulary.** The shipped page says ACTIVE / INACTIVE, the
>   button is "Pause", and the fourth mode card is `CTA*PAUSED`. "Disarm" read as
>   too loaded for a page volunteers use under time pressure.

---

# Handoff: Update Scanner (Devices)

## Overview
A full-screen, keyboard-only **bench scanning page** for the device-refurbishment
workflow, living inside the existing dashboard. An operator arms a *mode* (a target
`KitStatus`) once — by scanning a printed "mode card" or picking from a dropdown —
then rapid-scans device barcodes; each scanned device is set to the armed status
with no further clicks. It's a faster alternative to the multi-step **Bulk Update**
modal on the Devices index for the "walk down the bench and mark what I just
finished" case.

## About the design files
`Update Scanner.dc.html` + `support.js` are a **design reference** — a high-fidelity
HTML prototype of layout, copy, and interaction. **Do not ship them.** Recreate the
design as an Angular standalone component in `techaid-dashboard`, reusing that app's
existing patterns (below). The prototype uses React-ish inline styling and Font
Awesome 6 purely as a rendering convenience; the real thing is Angular + Bootstrap 5
+ Font Awesome 5.

## Fidelity
**High-fidelity** for layout, copy, and behavior. Match the app's existing Bootstrap
5 / sb-admin-2 classes rather than the prototype's literal pixel values wherever an
established equivalent exists (`card shadow`, `card-header`, `text-primary`,
`btn btn-warning btn-sm`, status pills, etc.).

## Target codebase — confirmed facts
Repo: `CommunityTechaid/techaid-dashboard` (branch `master`). Angular 21, standalone
components. Relevant existing code:
- **Bulk update lives in** `src/app/views/corewidgets/components/kit-index/`
  (`kit-index.component.ts` + `kit-index.html`). Copy its patterns — this is the
  closest sibling.
- **Status source of truth:** `src/app/views/corewidgets/components/kit-info/kit-info.component.ts`
  exports `KIT_STATUS` (enum→label map), `KIT_STATUS_LABELS`, and
  `KIT_STATUS_LABELS_WITH_DISABLED`. Import from there — do not redefine.
- **Routes:** `src/app/views/corewidgets/core-widgets.routes.ts`.
- Stack: `@ng-bootstrap/ng-bootstrap` (`NgbModal`), `ngx-toastr` (`ToastrService`),
  `apollo-angular` (Apollo v4), `@ngx-formly`, DataTables, Bootstrap 5.3, Font
  Awesome 5 free (`fas fa-*`), NGXS (`UserState`).

## Mode → KitStatus mapping (CONFIRMED against `KIT_STATUS`)
| Mode (operator-facing)     | Mode-card payload  | KitStatus enum            |
|----------------------------|--------------------|---------------------------|
| OS installed               | `CTA*OS-INSTALLED` | `PROCESSING_OS_INSTALLED` |
| Quality check completed    | `CTA*QC-COMPLETE`  | `ALLOCATION_QC_COMPLETED` |
| Assessment check completed | `CTA*ASSESS-CHECK` | `ALLOCATION_READY`        |
| Disarm (pause)             | `CTA*DISARM`       | — (no status)             |

All three are plain values in `KIT_STATUS` — `updateKits(ids, status)` covers them
with **no backend work**. (`KIT_STATUS['ALLOCATION_READY'] === 'Assessment check
completed'` — confirmed in source.)

## ⚠ Important behavioral rule discovered in `kit-info.component.ts`
`ALLOCATION_READY` and `ALLOCATION_QC_COMPLETED` are **blocked** when a device has
any of these `subStatus` flags set:
`wipeFailed`, `installationOfOSFailed`, `needsFurtherInvestigation`,
`needsSparePart`, `lockedToUser`. The single-device editor disables those statuses
(`disabledStatusGroup` + `KIT_STATUS_LABELS_WITH_DISABLED`) and shows a
"Status locked" alert. **The scanner must honour the same rule** for the QC and
Assessment modes: fetch `subStatus` on scan and, if a blocking flag is set, refuse
the change and show the "blocked" message (copy below) instead of calling
`updateKits`. Confirm whether the server also enforces this; regardless, the client
must, to match existing behavior. (OS installed / `PROCESSING_OS_INSTALLED` is not in
the blocked group.)

## GraphQL to reuse
**Apply (already exists in `kit-index.component.ts`):**
```graphql
mutation updateKits($ids: [ID!]!, $status: KitStatus) {
  updateKits(data: { ids: $ids, status: $status }) { id status }
}
```
Call with a single-element `ids` array per scan.

**Lookup on scan (adapt `findKit` from `kit-info.component.ts`):** fetch confirming
context + the blocking flags:
```graphql
query findKit($id: Long) {
  kit(where: { id: { _eq: $id } }) {
    id make model status archived
    subStatus {
      wipeFailed installationOfOSFailed
      needsFurtherInvestigation needsSparePart lockedToUser
    }
  }
}
```
Use `KIT_STATUS[kit.status]` to show the human-readable current status (same as the
index table's `statusTypes[dt.status]`).

## Screens / Views

### Update Scanner — one route
**Suggested route:** `dashboard/devices/update-scanner`, `canActivate: [AuthGuard]`,
`data: { title: 'Update Scanner' }`.
> **Routing gotcha:** it MUST be declared **before** `dashboard/devices/:kitId` in
> `core-widgets.routes.ts`, or Angular matches "update-scanner" as a `:kitId`.

**Access gating:** gate on the `app:bulkedit` authority, exactly as `kit-index` does
(`canBulkEdit = user.authorities['app:bulkedit']` via NGXS `UserState.user`). There
is no dedicated feature flag in this repo today; if you want one, add it separately,
but `app:bulkedit` is the established gate and is sufficient for v1. Add a
"Back to Devices" `routerLink="/dashboard/devices"`.

**Layout** (see prototype for exact spacing): a `card shadow` with a `card-header`
titled "Bench scanner", then a two-column body (~`col-8` / `col-4`):

Left column:
1. **Armed/idle banner** — full-width, coloured by armed mode, with a left accent
   bar. Shows uppercase state ("ARMED"/"NOT ARMED"), the mode name large, and a
   one-line instruction. "Disarm" button at right when armed.
2. **Scan field** — a large text input that holds focus (see focus rule). Icon +
   "Cursor here" indicator + helper line. This is where the wedge/USB scanner types.
3. **Waiting/last-result area** — shows the scanned device's id, make/model, and
   current status as each change is applied.

Right column:
1. **Arm a mode** card — a `<select>` (the four modes incl. Disarm) plus three
   clickable "printed mode card" buttons showing name + payload.
2. **This session** tally card — running count + per-mode breakdown.

**Do NOT recreate the prototype's "Design notes" section** — it's documentation for
you; its content is reproduced in this README.

## Interactions & behavior
- **Arm/disarm:** dropdown change, mode-card button click, or (production) scanning a
  `CTA*…` mode-card barcode sets the armed mode; `CTA*DISARM` / "Disarm" clears it.
  Idle is a valid resting state.
- **Focus management (subtle — replicate exactly):** the scan input keeps the cursor
  so the scanner types into it, and focus returns after each scan. But auto-refocus
  must **not** steal focus while the user is elsewhere. Guard: on blur, wait ~40ms,
  then refocus **only if** `document.hasFocus()` is true AND the active element is
  not another `INPUT`/`TEXTAREA`/`SELECT`/contenteditable. (A naive refocus-on-blur
  caused focus-stealing across the page during design review.) In Angular, use a
  `@ViewChild` on the input and an `(blur)` handler with this guard.
- **Scan → apply loop:** on Enter/scan of a device id:
  1. If a mode-card payload → arm/disarm, clear input, refocus.
  2. Else treat as a kit id → run `findKit`.
     - not found → "Not found" message; archived → "Archived" message.
     - already in the target status → "Already in status" message (no mutation).
     - QC/Assessment mode AND a blocking `subStatus` flag set → "Blocked" message
       (no mutation).
     - else → show "applying", call `updateKits([id], status)`, on success show
       "applied", increment the session tally.
  3. Reject scans while a mutation is in flight ("busy" message).
  4. Clear + refocus the input.
- Main scan feedback uses the **inline banner** in the prototype. Keep `ToastrService`
  for incidental/GraphQL errors, consistent with the rest of the app.

## Operator copy — every state (use verbatim; `{…}` are interpolations)
- **Idle:** `Not armed. Scan a mode card or choose a mode to start.`
- **Armed:** `Armed: {mode}. Scan devices now — each is set to {mode}.`
- **Applying:** `#{id} — applying {mode}…`
- **Applied:** `#{id} · {make} {model} → {mode} ✓`
- **Already in status:** `#{id} is already {mode}. No change made.`
- **Duplicate this session:** `#{id} already set to {mode} at {time}. No change.`
- **Blocked by sub-status flag:** `#{id} can't move to {mode} — a device flag is set (e.g. needs spare part). Clear it on the device record first.`
- **Not found:** `No device found for #{id}. Check the label and scan again.`
- **Archived:** `#{id} is archived and can't be updated.`
- **Scan while busy:** `Busy — finishing the last scan. That scan was ignored, try again.`
- **Unknown scan:** `Didn't recognise '{raw}'. Not a device barcode or a mode card.`
- **Disarmed:** `Disarmed. Scanning paused until you arm a mode.`
- **Session summary:** `Session complete — {n} updated. {a} OS · {b} QC · {c} assessment.`

Banner pattern: icon + uppercase kicker + monospace body, coloured by severity
(success green, info blue, warning amber, error red, neutral slate). Non-blocking;
never a modal in the scan loop.

## Action cards to print
Four Code 128 barcodes on the existing device-label printer, laminated for the bench.
Payloads use a `CTA*` prefix so a mode card is distinguishable from a device id. See
the mapping table for payloads.

## Session state
- `armedKey`: `PROCESSING_OS_INSTALLED | ALLOCATION_QC_COMPLETED | ALLOCATION_READY | null`.
- Per-mode session tally (client-side, resets per session).
- `applying` in-flight flag (rejects concurrent scans).
- Set of ids seen this session (for the duplicate message).
- No undo in v1.

## Sequencing / dependencies
- **Core flow: no backend work** — reuse `updateKits`.
- **Enforce the blocking-flag rule client-side** (see above); confirm server behavior.
- **Add the route before `:kitId`** and gate on `app:bulkedit`.
- **Print 4 Code 128 mode cards.**
- **Out of v1:** setting sub-status flags (wipe failed, needs spare part…) — those are
  a different mutation (`updateKit` with `subStatus`), not `updateKits`. Not in scope.
- **No undo strip in v1.** If added later: no backend needed (revert = `updateKits`
  to the prior status), but capture each device's prior status client-side first.

## Design tokens
Prefer the app's existing Bootstrap 5 / sb-admin-2 classes. Prototype reference values:
- Mode palette (accent / bg / border / text):
  OS installed `#2e9e5b`/`#e7f6ee`/`#b6e2c8`/`#1c6b3f`;
  Quality check `#2050d8`/`#eaf0ff`/`#b9ccf5`/`#14357f`;
  Assessment `#e3a82b`/`#fff4d6`/`#f0d492`/`#8a6100`;
  Idle `#94a3b8`/`#f2f4f8`/`#d7dde6`/`#475569`.
- Severity accents: success `#2e9e5b`, info `#2050d8`, warning `#d99a1c`, error
  `#d64550`, neutral `#64748b`.
- Icons: Font Awesome 5 `fas fa-*` (barcode `fa-barcode`, crosshairs `fa-crosshairs`,
  check `fa-check-circle`, etc.). Card radius/shadow: use `card shadow`.

## Files in this bundle
- `Update Scanner.dc.html` — the design prototype (open in a browser to view).
- `support.js` — prototype runtime (reference only).
