# Paste this into your Claude Code session (techaid-dashboard repo)

I'm adding a new **Update Scanner** page to this Angular app. A designer produced a
high-fidelity HTML prototype and a spec grounded in this repo. The handoff is in
`design_handoff_update_scanner/` — **read `design_handoff_update_scanner/README.md`
in full first**, then open the `Update Scanner.dc.html` prototype in a browser to
see the exact layout, scanner states, and interaction model you're matching. (Both
files ship together in the `design_handoff_update_scanner/` folder; if it was
dropped somewhere other than the repo root, adjust the paths accordingly.) Treat the
prototype as the source of truth for behavior and copy where it and the README agree.

Framing:
- The `.dc.html` / `support.js` files are a **design reference only** — do not ship
  them. Build a real Angular standalone component that matches this app's patterns.
- The closest sibling is `src/app/views/corewidgets/components/kit-index/`
  (the Bulk Update flow). Mirror its Apollo / ngx-toastr / ng-bootstrap / Formly /
  Bootstrap 5 usage.

Do this, in order:
1. Create a standalone component (e.g. `kit-scanner`) under
   `src/app/views/corewidgets/components/`, with its own `.ts` / `.html` / `.scss`,
   following the layout in the README/prototype.
2. Register a route in `core-widgets.routes.ts`:
   `dashboard/devices/update-scanner`, `canActivate: [AuthGuard]`,
   `data: { title: 'Update Scanner' }` — **declared BEFORE `dashboard/devices/:kitId`**
   (otherwise it matches as a kitId). Gate visibility/entry on the `app:bulkedit`
   authority via NGXS `UserState.user`, exactly like `kit-index`'s `canBulkEdit`.
3. Import `KIT_STATUS` / `KIT_STATUS_LABELS` from
   `components/kit-info/kit-info.component` — don't redefine statuses. Use the
   confirmed mode→enum mapping in the README.
4. Reuse the existing `updateKits($ids: [ID!]!, $status: KitStatus)` mutation (it's
   in `kit-index.component.ts`), calling it with a single-id array per scan. Add a
   `findKit($id: Long)` lookup (adapt from `kit-info.component.ts`) returning
   `make model status archived subStatus{…}` to confirm the device and detect the
   blocking flags.
5. **Enforce the blocking-flag rule** described in the README: for the QC and
   Assessment modes, if the scanned device has any of `wipeFailed`,
   `installationOfOSFailed`, `needsFurtherInvestigation`, `needsSparePart`,
   `lockedToUser` set, refuse and show the "blocked" message instead of mutating
   (mirrors `kit-info`'s `disabledStatusGroup`). Confirm whether the server enforces
   it too.
6. Implement all result states with the **exact copy** in the README. Use the inline
   banner for scan feedback; keep `ToastrService` for incidental/GraphQL errors.
7. Replicate the **focus guard** precisely (refocus after each scan, but never when
   `document.hasFocus()` is false or another form field is focused).

Before writing code, give me a short plan and the file list you'll touch, then wait
for my go-ahead. Do NOT recreate the prototype's "Design notes" section — that's for
you, not product UI. Out of scope for v1: setting sub-status flags, and an undo strip.
