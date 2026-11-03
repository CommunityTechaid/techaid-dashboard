# Handoff: Membership support (tiers, yearly request allowance, membership contacts)

## Overview
Referring organisations now have a **membership tier** with a yearly request allowance. Every organisation starts on the free tier (10 requests a year). Paid tiers raise the cap. The dashboard needs to:

- show and edit each organisation's tier and membership period;
- flag organisations close to or at their limit;
- let staff mark referees as **membership contacts**;
- warn referees and staff when a request is the organisation's last one in its allowance, and handle requests over the limit.

Stakeholder: Cat. The designs were reviewed in the "Membership support" deck, `CTA-Membership-Design.pdf` (3.5 MB). It is gitignored to keep the repo small; ask a maintainer for a copy.

## About the design files
> The `mockups/` folder (HTML + PNG) is **not committed**: it was built from real organisation contact details and this repo is public. Ask a maintainer for a local copy.

`mockups/*.html` are a **design reference**, not shippable code. Each is a static page built with this app's own Bootstrap 5 / SB Admin 2 class names (`card`, `card-header`, `btn btn-primary`, `badge badge-primary`, `table table-striped`, `device-request-status`). Fonts load from `src/assets/fonts/`, so open them straight from this folder in a browser. `mockups/*.png` are screenshots of the same pages.

- **Dashed blue outline = new.** Everything without it already exists in the app.
- `mockups/cta.css` holds the only new styles: membership badges, alerts and the usage meter. Port them into `src/styles.css` (or component styles), mapping the colours onto the existing CSS variables. Ignore its `:root` token block and the `.cta-shell` / `.cta-quicklinks` / `.cta-public*` layout rules. Those only recreate the app shell for the static pages.
- The sidebar logo is a text stand-in, and icons in alerts are inline SVG. In the app, use the real logo and Font Awesome (`fas fa-exclamation-triangle`, `fas fa-ban`).
- The usage numbers (14 of 20, 9 of 10 and so on) are illustrative.

## Fidelity
High-fidelity for layout, copy and the badge/alert vocabulary. Prefer the app's existing component patterns over the mockups' literal pixel values. Copy is British English. Use the mockup wording unless Cat changes it.

## Rules (agreed with Cat)

| Tier | Requests per membership year | Fee | Cap |
|---|---|---|---|
| `FREE` (default) | 1–10 | Free | 10 |
| `TIER_1` | 11–20 | £175 | 20 |
| `TIER_2` | 21–40 | £300 | 40 |
| `TIER_3` | 41+ | £750 | none |

- **Default tier.** Every organisation defaults to `FREE`. This is a system default and covers existing organisations too.
- **Period dates.** The membership year starts on **1 February** by default. The start date can be edited per organisation. The end date is computed as start + 1 year − 1 day and is read-only.
- **Renewal.** Periods roll forward automatically and the allowance resets on renewal; the next renewal is 1 Feb 2027.
- **What counts as usage.** Requests created in the current period, across all of the organisation's referees, excluding `REQUEST_DECLINED` and `REQUEST_CANCELLED`.
- **Boroughs.** Applies to **all boroughs**, Tower Hamlets included.
- **Which tiers warn.** `FREE`, `TIER_1` and `TIER_2` share the same warning and limit behaviour at their caps. `TIER_3` never warns.
- **States.**
  - `LAST_REQUEST`: remaining == 1, so the request being made now uses the last slot.
  - `LIMIT_REACHED`: remaining <= 0.
- **Separate from the existing cap.** The per-borough "3 open requests per referee" cap (`RefereeRequestLimitService` on the server) still applies. The two checks are separate.

## Open decision (Cat): what happens over the limit
Build both options behind server config (proposed: `AdminConfig.membershipOverLimitMode` = `GRACE` | `BLOCK`), so either can ship without a frontend change:

- **Option A, grace period** (`PublicOverSoft.html`): submission is allowed. The request becomes "grace request N of M", where M is a placeholder set to 2. When the grace requests run out, it behaves like Option B. Staff see a **Grace** badge on those requests (`RequestTable.html`).
- **Option B, hard block** (`PublicOverHard.html`): a danger alert, the form fieldset disabled and Submit disabled.

Also unconfirmed: whether staff can override the limit on the admin form. Leave a seam; don't build it.

## Backend dependency
The API contract is in **`BACKEND_ISSUE.md`** (destined for a `techaid-server` issue). Agree any change to it there first. Until it lands on UAT, build against stubbed data in the shape it describes.

## Screens

Component folders are under `src/app/views/corewidgets/components/`. The mapping below is a best guess from folder names, so **confirm each one before editing**.

| # | Mockup | Likely component | Change |
|---|---|---|---|
| 1 | `OrgDetail.html` | `referring-organisation-info` | New **Membership** section between Phone and Archived: tier select, start date (editable), end date (read-only), usage meter with the "Counts every request…" helper, membership contact(s) or "None set" with a link to the Referees tab. Tier badge beside the name in the card header. |
| 2 | `OrgTable.html` | `referring-organisation-index` | New **Membership** column after Name: tier badge plus a state badge (`Last request` / `Limit reached`) and a "used / cap" line. Badge key above the table. Consider a tier filter in the existing Filter panel. |
| 3 | `RefereeDetail.html` | `referring-organisation-contact-info` | **Is membership contact?** radio pair, styled like Archived. "Membership contact" badge in the header. Organisation tier and usage badges under the Referring Organisation picker. |
| 4 | `RefereeTable.html` | `referring-organisation-contact-index` | "Membership contact" badge under the name. Tier and state badges under the organisation. "Membership contacts only" filter. |
| 5 | `PublicLastRequest.html` | public request form (`org-request`?) | Warning alert shown **once the organisation and referee email are known**, above "Your client's needs". Rewrite the membership note so it covers all boroughs. |
| 6 | `PublicOverSoft.html` / `PublicOverHard.html` | same | Over-limit variants A and B, driven by the server mode. |
| 7 | `AdminRequest.html` | Request Devices (Admin) form | Same check when an organisation is picked: badges under the organisation and referee pickers, plus the staff-worded warning. |
| 8 | `RequestTable.html` | `device-request-index` | **Grace** badge on over-limit requests (Option A only). Tier and state badges under the organisation. |

### Badge and alert vocabulary (`mockups/cta.css`)
- Tier: `badge-tier-free` (light, outlined) for Free; `badge-tier-paid` (brand blue pill) for Tier 1, 2 and 3.
- State: `badge-last` (warning yellow, dark text) for "Last request"; `badge-limit` (salmon, dark red text, red border) for "Limit reached".
- Other: `badge-contact` (outlined blue) for "Membership contact"; `badge-grace` for "Grace N of M".
- Alerts: `cta-alert cta-alert-warning` for the last request and Option A; `cta-alert-danger` for Option B.
- Meter: `cta-meter`, which turns amber at the last request and red at the limit.

These colours are chosen to pass AA with dark text. Don't switch them to white text on `success`, `info` or `danger`, which fails contrast.

## Suggested order
1. Agree the API contract (`BACKEND_ISSUE.md`). The server work lands first: migrations, the computed `membership` object, the public lookup and enforcement.
2. Port the badge, alert and meter styles. Build a small shared membership-badges component used by every table and detail page.
3. Organisation detail, then the organisation table.
4. The referee flag, detail and table.
5. The admin, then the public request warnings: last request first, then the over-limit options behind the server mode.
6. E2E: `@mocked` specs for each badge state and both over-limit modes, plus a live-UAT pass once the server is on api-testing.
