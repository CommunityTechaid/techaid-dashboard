<!-- Draft issue for CommunityTechaid/techaid-server. Post it with:
     gh issue create -R CommunityTechaid/techaid-server --title "Membership: tiers, yearly request allowance and API support" --body-file docs/design_handoff_membership/BACKEND_ISSUE.md -->

# Membership: tiers, yearly request allowance and API support

> **Status (2026-11-03): SHIPPED — historical spec, do not work from the checklist below.**
> Filed as techaid-server #311 (closed). Implemented in server #313 (tiers, allowance, GRACE/BLOCK
> enforcement, adminConfig settings, `membership-support` flag) and #315 (explicit paid end date,
> expiry/lapse); dashboard #257, #259, #260. Deployed to production 2026-11-02 with
> `membership-support` **OFF**. The unticked boxes under "Tasks" were never ticked here; the work
> is done. Remaining rollout steps (prod tier load, over-limit mode, flag flip) live in
> `_session_handoff_2026-10-28_membership.md`.

This is the backend half of **Membership** support. The dashboard half, with the screen designs, is in `techaid-dashboard` under `docs/design_handoff_membership/`. This issue is the **API contract** the frontend builds against, so agree any change to it here before the frontend depends on it.

Stakeholder: Cat.

## Rules (agreed)

| Tier | Requests per membership year | Fee | Cap |
|---|---|---|---|
| `FREE` (default) | 1–10 | Free | 10 |
| `TIER_1` | 11–20 | £175 | 20 |
| `TIER_2` | 21–40 | £300 | 40 |
| `TIER_3` | 41+ | £750 | none |

- **Default tier.** Every `ReferringOrganisation` defaults to `FREE`, including existing rows.
- **Period dates.** The membership year starts on **1 February** by default. The start date can be edited per organisation, for mid-year joiners or upgrades. The end date is start + 1 year − 1 day and is never stored.
- **Renewal.** The period rolls forward a year automatically and the allowance resets. Compute this on read; don't schedule a job.
- **What counts as usage.** Device requests created within the current period, across all of the organisation's referees, **excluding** `REQUEST_DECLINED` and `REQUEST_CANCELLED`.
  - This is a different predicate from `CLOSED_REQUEST_STATUSES`. Define it once, next to that, with a comment explaining why it differs.
- **Boroughs.** It applies to **all boroughs**.
- **Which tiers are capped.** `FREE`, `TIER_1` and `TIER_2` share the same behaviour at their caps. `TIER_3` is uncapped.
- **States.**
  - `LAST_REQUEST`: remaining == 1.
  - `LIMIT_REACHED`: remaining <= 0.

## Open decision (Cat): what happens over the limit

Build both behaviours behind config, so either can ship without a deploy. `AdminConfig` looks like the natural home for two settings:

- `membershipOverLimitMode: MembershipOverLimitMode` (`GRACE` | `BLOCK`)
- `membershipGraceRequests: Int`, a placeholder of **2**, used only when the mode is `GRACE`

The two modes:

- **`GRACE`** accepts up to N requests past the cap and marks each one as a grace request (1-based index). After N it behaves like `BLOCK`.
- **`BLOCK`** rejects `createDeviceRequest` with a clear, user-facing error.

Also unconfirmed: should staff be able to override the limit on admin-created requests? Leave a seam for this; don't build it yet.

## Data (Flyway, with matching Envers audit tables)

- **`referring_organisation`:** add `membership_tier` (not null, default `'FREE'`) and `membership_start_date` (date, not null, backfilled to 1 Feb of the current membership year).
- **`referring_organisation_contacts`:** add `is_membership_contact` (not null, default false). Follow the `YesNoConverter` pattern used for `archived`. An organisation can have more than one membership contact.
- **`device_requests`:** add `membership_grace_index` (nullable int, set only for grace requests).
- **`admin_config`:** add the two settings above.

## GraphQL contract (proposed)

```graphql
enum MembershipTier { FREE TIER_1 TIER_2 TIER_3 }
enum MembershipState { OK LAST_REQUEST LIMIT_REACHED }
enum MembershipOverLimitMode { GRACE BLOCK }

type Membership {
  tier: MembershipTier!
  periodStart: String!      # ISO date
  periodEnd: String!        # ISO date, computed
  cap: Int                  # null for TIER_3
  used: Int!
  remaining: Int            # null for TIER_3
  state: MembershipState!
  graceUsed: Int!           # 0 unless the mode is GRACE
}

extend type ReferringOrganisation {
  membershipTier: MembershipTier!
  membershipStartDate: String!
  membership: Membership!
  membershipContacts: [ReferringOrganisationContact!]!
}
# Update input gains membershipTier and membershipStartDate (staff only, @PreAuthorize as for other org edits)

extend type ReferringOrganisationContact { isMembershipContact: Boolean! }
# Create and update inputs gain isMembershipContact; the where-input gains a filter on it

extend type DeviceRequest { membershipGraceIndex: Int }
```

### Public form

`ReferringOrganisationPublic` and `ReferringOrganisationContactPublic` are deliberately minimal, because the endpoint is anonymous. The form still needs the allowance once the organisation and referee email are known. Proposed approach:

- Add a small public type, for example `MembershipPublic { state, cap, used, remaining, periodEnd, graceRemaining }`.
- Return it only when the email matches a referee of that organisation.
- Don't expose the membership contact's name publicly unless we explicitly decide to.

## Enforcement

Put this in a service modelled on `RefereeRequestLimitService` (for example `MembershipAllowanceService`). Call it from `createDeviceRequest`, next to the existing per-borough referee cap. Both checks apply independently.

## Tasks

- [ ] Flyway migrations and audit tables
- [ ] Entity fields and the computed period/usage logic, in one service
- [ ] Unit tests:
  - [ ] the default tier
  - [ ] the 1 Feb default
  - [ ] a mid-year start
  - [ ] roll-forward across a period boundary
  - [ ] the excluded statuses
  - [ ] `TIER_3` is uncapped
- [ ] GraphQL schema and resolvers for the contract above
- [ ] Public allowance lookup, gated on the referee/organisation match
- [ ] `AdminConfig` settings and enforcement in `createDeviceRequest` (`GRACE` and `BLOCK`)
- [ ] Tell the dashboard work when the contract is on `dev`/api-testing
