# TaDa ↔ Delivery Schedule sync — proof of concept

Two ways to get booked deliveries out of TaDa and into the "TaDa Import" tab of the
driver's **Delivery Schedule** spreadsheet.

| | What it is | Auth | Effort to run |
|---|---|---|---|
| **1. Manual CSV** | `scripts/export-delivery-schedule.mjs` in this repo writes a CSV in the exact column shape of the "TaDa Import" tab. Import it into the sheet. | Your own dashboard bearer token, pasted into an env var | One command, 24h token life |
| **2. Apps Script** | `Code.gs` here, pasted into the spreadsheet, pulls the same data on demand from a menu item or a button. | Auth0 machine-to-machine client (or a pasted token for a first try) | One click, once set up |

Both read the **same two queries**, so they produce identical rows.

## Where the data comes from

There are **two** sources, because there are two ways a delivery comes about.

### 1. Public bookings — `deliveryBookingsAdmin(from:, to:)`

The exact query the admin **Delivery Slots** page runs, so what lands in the sheet is what
staff already see there. These carry the recipient's own name, phone, delivery address and
access notes, because the recipient typed them.

Bookings do **not** carry the referring organisation, so a second batched query resolves
each booking's `ctaReference` to its device request and reads the org from
`referringOrganisationContact.referringOrganisation.name`. A booking whose reference
matches no request still exports — it just has a blank Org.

As of 2026-09-01 production has **zero** bookings, so in practice everything currently
comes from source 2.

### 2. Staff-arranged deliveries — `collectionMethod: DELIVERY`

Deliveries are **already explicitly marked** in TaDa; nothing has to be inferred. The rule is:

```graphql
where: { AND: [
  { collectionMethod: { _eq: DELIVERY } }
  { status: { _eq: PROCESSING_COLLECTION_DELIVERY_ARRANGED } }
  { collectionDate: { _gte: $from } }
  { collectionDate: { _lte: $to } }
]}
```

Verified against the driver's **31 Aug** tab: `collectionMethod: DELIVERY` alone returned
**exactly the 13 requests listed there — no misses, no false positives** — while correctly
excluding 18 `COLLECTION` requests dated the same week. All 13 were also
`status: PROCESSING_COLLECTION_DELIVERY_ARRANGED`, so the status filter is included as a
belt-and-braces guard: it keeps requests that are still mid-collection-workflow (a
`collectionDate` set for planning purposes, but not yet at the "Arranged" stage) out of the
export.

Two traps worth knowing:

- `collectionDate` is an **`Instant`**, not a date. `"2026-09-01"` is rejected; it needs
  `"2026-09-01T00:00:00Z"`. Worse, the server accepts it **only as a query variable** — the
  identical string inline in the query body fails with *"not a valid 'Instant'"*.
- `deviceRequestConnection`, not `deviceRequests` — the bare plural returns a single entity
  with no `content`.

### The gap: TaDa does not hold the delivery address

A staff-arranged request's only address is `referringOrganisationContact.address`, which is
the **referring organisation's office**, not where the devices go. Checked against the
31 Aug tab, it was wrong for 4 of the 6 rows sampled:

| Req | TaDa contact address | Actual delivery address |
|---|---|---|
| 6977 | 336 Brixton Rd (Carers' Hub office) | 119 Lockwood House, Kennington Oval SE11 5TD |
| 6982 | 336 Brixton Rd (Carers' Hub office) | 15 Permain House SW9 8FT |
| 6951 | The Advocacy Academy, 2 Beehive Pl | 136 Salcott Road SW11 6DG |
| 6964 | 96 Great Guildford St | Flat 30 Latimer, Beaconsfield Rd SE17 2EN |
| 6973 | Martha Jones House, Wandsworth Rd | *same* — delivery is to the hostel |

So the export leaves Address as `[N/A]` for
staff-arranged rows rather than filling in an address that would send the driver to a
charity's head office instead of someone's flat. Name and phone are the **referrer's** for
the same reason — the recipient's own details only exist once they book through the public
flow.

**This is the gap the public booking flow closes.** Every request that gets booked moves
from source 2 to source 1 and gains a real delivery address, so this placeholder should get
rarer over time. Until then, Date / Req No. / Org / referrer contact are pre-filled and the
address is still typed by hand.

## Column mapping

| Sheet column | Source |
|---|---|
| `Date` | `booking.date` (rendered `dd/mm/yyyy`, matching the weekly driver tabs) |
| `Req No.` | `booking.ctaReference` |
| `Distributions Only` | Literal `Distribution` — every booking made through the public flow is a device delivery to a beneficiary |
| `Name` | `booking.firstName` + `booking.surname` |
| `Org` | Matched device request → referring organisation name |
| `Address` | `booking.address` — or `[N/A]` for a staff-arranged row, see above |
| `Telephone no.` | `booking.phone` |
| *(H, I)* | **left empty on purpose** — see below |
| `Access Notes` (J) | `booking.accessNotes`; always empty for a staff-arranged row, since only a booking captures them |

Two differences from the weekly tabs worth knowing about:

- The weekly tabs' third column is **"Donation or Distribution"** and carries four values
  (`Distribution`, `Donation`, `Other`, `Southwark Project`). The import tab's is
  **"Distributions Only"**. Donations, ad-hoc jobs and the Southwark Project bulk drops
  are not booked through the public delivery flow, so they can't come from here — they
  stay manual.
- The weekly tabs' `Req No.` sometimes holds several ids in one cell (`6914, 6913`) where
  the driver merged two requests into one trip. The export writes one row per booking, so
  merging stays a human decision made in the sheet.

Access Notes lands in **column J**, not H, so a block of exported rows pastes straight into
one of the weekly driver tabs — there H is `Delivered (Y or N)`, I is the follow-up call
permission and J is `Notes`. The two blank columns are load-bearing; don't tidy them away.

The refresh rewrites columns **A–G and J only**. H and I are never cleared, so anything the
driver has put there survives a refresh.

## 1. Manual CSV

```bash
# Get a token: log in to the dashboard → DevTools → Application → Local Storage → the Auth0 access token
CTA_BEARER_TOKEN=<token> node scripts/export-delivery-schedule.mjs --prod --days 14 --out delivery-schedule.csv
```

Flags: `--uat` (default) / `--prod`, `--days N` (default 14), `--from YYYY-MM-DD`
(default today), `--out FILE` (default stdout).

Then in the spreadsheet: **File → Import → Upload**, choose *Replace data at selected
cell* with `A1` of the "TaDa Import" tab selected.

## 2. Apps Script

Config lives in cells on the "TaDa Import" tab, matching the bulk-insert sheet's
"Login first" tab:

| Cell | Value |
|---|---|
| `M2` | a live bearer token (the `Bearer ` prefix is tolerated) |
| `M3` | `Production` or `UAT` — picks `api.` vs `api-testing.` |

`M3` has no default: an empty or unrecognised value stops with an error rather than
guessing, because guessing wrong either fills the driver's sheet from test data or points a
UAT token at production. The token and the environment have to agree.

1. Open the spreadsheet → **Extensions → Apps Script**, paste `Code.gs` in, save.
2. Reload the spreadsheet — a **TaDa** menu appears with *Refresh TaDa Import*.
3. Fill in `M2` and `M3`, then run it once from the menu and accept the auth prompt.
4. For the clickable link in `L1`: **Insert → Drawing**, add a text box reading
   "Click here to refresh" styled blue and underlined, drag it over `L1`, then use the
   drawing's ⋮ menu → **Assign script** → `refreshTaDaImport`.

### Why the link is a Drawing and not `onSelectionChange`

The test stub used `onSelectionChange` to fire when `L1` is selected. That works for the
stub because it only writes literal rows — but `onSelectionChange` is a **simple trigger**,
and Google runs simple triggers in a restricted context that cannot call any service
requiring authorisation. The moment it calls `UrlFetchApp` it dies with *"You do not have
permission to call UrlFetchApp.fetch"*.

There is no installable variant of `onSelectionChange`, and the usual workaround (have it
write a marker cell and let an installable `onEdit` react) doesn't work either, because
`onEdit` triggers don't fire for changes made by a script.

A **Drawing with an assigned script** runs fully authorised, and it's already the proven
pattern in this org — it's how the bulk-insert sheet's "Insert Single Device" button works.
`onSelectionChange` is still in the file, but only to show a toast pointing at the link.

### Auth, longer term

Reading the token from a cell means anyone who can open the spreadsheet can read it and act
as you until it expires (24h). That's the same trade the bulk-insert sheet already makes, so
it's a known and accepted shape rather than a new risk — but it does mean someone has to
re-paste a token once a day.

For an unattended refresh the script would need an **Auth0 machine-to-machine application**
in the `techaid-auth.eu.auth0.com` tenant, scoped to just the queries it uses. That's a
tenant change, not a code change, and it puts a long-lived credential within reach of anyone
who can open the script editor — worth deciding deliberately rather than by default.
