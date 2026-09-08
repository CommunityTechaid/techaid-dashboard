# Handoff — borough × device-type availability admin (design 3a)

**Design reference:** `Borough Availability Admin.dc.html`, option `3a` (anchor `#3a`). Open it in a
browser for the visual spec — every control, state chip and label below is drawn there. Option `3b`
(card-per-borough) was reviewed and **not** chosen; ignore it.

**Related handoff:** `handoff/1b-postcode-eligibility.md` builds the public side. This admin screen is
the config that page reads. `1b` explicitly leaves availability filtering reading "from one place" —
this is that place.

**Repo:** `CommunityTechaid/techaid-dashboard` (branch `master`, work on `dev` per CLAUDE.md).

## What we're building

A new **Borough Availability** tab in the existing admin panel
(`src/app/views/corewidgets/components/admin-panel/`), alongside *Application Configuration* and
*Feature Flags*. Same chrome as today: breadcrumb, `nav nav-tabs`, `card shadow mb-4`,
`card-header py-3` with `h6 m-0 font-weight-bold text-primary`, `btn btn-primary btn-sm` save.
No new visual language — the design deliberately uses only components already in sb-admin.

The screen holds two cards:

1. **Borough Availability** — a matrix. One row per borough group, one column per device type, plus a
   trailing **Max per referee** column. A cell click opens an in-flow editor row (see below).
2. **Request limits — exceptions by organisation** — a short table of *overrides only*.

## Data model

Two concepts, both new records; nothing about them is inferable from the current schema, so this is the
main design decision to land in the PR.

### Borough group
The unit of configuration. Today Lambeth + Southwark behave as **one record** — preserve that: a group
has a name and a **set of boroughs** (not one borough).

```
BoroughGroup { id, name, boroughs: [String], status: LIVE | PILOT | DRAFT, maxPerReferee: Int }
```

- Lambeth & Southwark → one seeded group, `boroughs: ["Lambeth","Southwark"]`, `maxPerReferee: 3`
  (this is today's live value — confirm against the current constant before seeding).
- Tower Hamlets → a second group, `boroughs: ["Tower Hamlets"]`, `PILOT`, `maxPerReferee: 1`.
- A borough not in any group is **out of area** to the postcode check in 1b. The postcode lookup
  resolves a borough name/code; group membership is what makes it supported. Keep that one lookup.
- The matrix row shows a **link icon + "Linked group · 2 boroughs · split"** for multi-borough groups.
  `split` dissolves the group into one group per borough, copying the current availability into each —
  it is a data migration, so confirm before applying and make it non-destructive/reversible in the same
  session. `Add borough group` offers only boroughs not already in a group.
- Group membership must be unique across groups — a borough cannot appear twice. Enforce server-side.

### Availability, per (group × device type)
Three states, not a boolean:

```
Availability { groupId, deviceType, mode: OFF | AUTO | ON }
```

- `ON` — offered, regardless of stock (manual).
- `OFF` — hidden from the public request form (manual).
- `AUTO` — **derived from stock**: offered while stock for that type in that group is available,
  closed when it runs out. This is the backlog item; see "AUTO" below.
- Default for a newly created group: every type `OFF`. New groups start closed and are opened
  deliberately.

Device types are the existing set used by the device request — **Laptops, Phones, Tablets,
All In Ones, Desktops, SIM Cards, Broadband Hubs, Other** — with the icons already used in the device
request subpanel (`fa-laptop`, `fa-mobile-alt`, `fa-tablet-alt`, `fa-desktop`, `fa-desktop`,
`fa-microchip`, `fa-wifi`, `fa-box`). Read the type list and its icons from wherever the request
subpanel already defines them; do not fork a second list here.

### Request limits
- `maxPerReferee` lives **on the group** (the matrix's last column) — a borough's rules are one
  horizontal read.
- Organisation-level values are **exceptions**, stored separately, and only exceptions appear in the
  second table:

```
ReferrerLimitException { organisationId, boroughGroupId, maxPerReferee }
```

- Resolution order: organisation exception for that group → group `maxPerReferee`.
- The table's *Used this month* column is read-only, derived from open requests. If that count is
  expensive or ambiguous, drop the column rather than guess a definition — say so in the PR.

## AUTO (stock-driven) — the part to figure out

Deliberately unspecified, like the postcode lookup in 1b.

- AUTO needs a per-group, per-type **stock signal**. Establish what "in stock for this group" means:
  devices in a ready/allocated state, optionally scoped to a borough allocation. Today's kit inventory
  may not be borough-scoped at all — if it isn't, either scope it or make AUTO group-agnostic and
  document that limitation prominently.
- Where a device type has **no stock signal**, AUTO must be **disabled** in the UI (rendered greyed,
  with the reason "Not stock-tracked" — see SIM Cards in the design) rather than silently behaving as
  ON. Don't let an admin select a mode that does nothing.
- Evaluate AUTO **server-side at read time** for the public form; do not let the browser decide
  availability. The public endpoint should return an already-resolved list of offered device types per
  borough.
- Show the current stock reading in the cell (`14 in stock`, `0 · closed`) and in the editor row. A
  stock threshold ("open only above N units") was raised and is **not** in this design — leave room for
  it on the `Availability` record but don't build the control.
- Ship the UI with AUTO selectable even before the stock feed exists **only if** an unresolvable AUTO
  falls back to OFF and says so. Otherwise gate AUTO behind a feature flag in the existing Feature
  Flags tab.

## Interaction notes (all drawn in 3a)

- Cells render as a small state chip: green `fa-check` (ON), blue `fa-bolt` (AUTO), grey `fa-minus`
  (OFF). AUTO cells carry a stock reading beneath the chip.
- Selecting a cell outlines it in `#12309b` and opens an **in-flow editor row spanning the full grid
  width**, directly under that borough's row: type + borough title, the allocated/stock reading, three
  radio-style buttons (On (manual) / Auto from stock / Off (manual)), an explanatory line, and a close
  `fa-times`. This is not a popover — do not reintroduce one; an absolutely-positioned panel has no
  room in a full-width matrix and clipped in review.
- Only one editor row is open at a time.
- Changes are **staged, not live**: the card header shows a red-dot `N unsaved changes` counter and
  `Save Configuration` commits. Warn on navigation with unsaved changes. `Last updated: <timestamp>`
  in the header comes from the record's audit field.
- The Tower Hamlets row is tinted (`#fcfbf7`) and its `maxPerReferee` input is outlined to mark
  changed/new values — the tint is a *new/pilot* affordance, not a per-borough colour scheme.
- Exceptions table: `Add exception` appends a row (organisation autocomplete + borough group select +
  number), red `fa-times` removes it.

## Access control

Same guard as the rest of the admin panel — this changes what the public form offers, so it must not be
reachable by referring organisations. Reuse the existing admin role check; don't invent a new
permission unless the panel already has per-tab granularity.

## Out of scope

- Stock thresholds per type (backlog).
- Per-ward availability. Groups are borough-level only.
- Any change to the public request form beyond it reading resolved availability — the public side is
  handoff 1b.
- Scheduling ("live from 1 Sep" in the design is descriptive copy on a PILOT group, **not** a date
  field to build).

## Acceptance criteria

- A third tab **Borough Availability** renders in the admin panel with the matrix and the exceptions
  table, in existing sb-admin components only.
- Lambeth & Southwark seed as **one** group with `maxPerReferee: 3`, matching today's behaviour exactly;
  no public-facing change for those boroughs on deploy.
- Tower Hamlets can be added as a new group, defaults to all types OFF, and takes its own
  `maxPerReferee`.
- Setting a type to ON/OFF changes what the public request form offers for that group's boroughs.
- AUTO reflects the stock signal, and is unselectable for types with no stock signal.
- An organisation exception overrides its group's `maxPerReferee`; with no exception, the group value
  applies.
- Unsaved changes are counted, committed by Save, and survive neither reload nor navigation silently.
- Per repo CLAUDE.md: tests land with the change and fail before it. Cover the three modes, group
  seeding/split, and limit resolution order. `ng build --configuration production` is clean.
