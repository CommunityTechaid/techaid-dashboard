# Native equalities form: project plan

Replaces the **Recipient Equalities Data** Typeform (`f93D0s88`), which is embedded after a public
device request is created, with the native form prototyped in PR #265
(`/preview/equalities-491d341f15`). The **new-organisation registration Typeform (`Qz4rILeN`) is out
of scope** and stays as a plain link for now.

## Current status / next action

- **Status:** plan only. No code has been written.
- **Next action:** answer the decisions in M0 (D1 to D3 block all build work).
- Branch: `plan/native-equalities-form` (dashboard). It is held back from `dev` until after the
  2026-11-16 production deploy.

## Ground rules

- **Equalities answers never land in TaDa.** They are special category data. No DB column, no audit
  row, no log line, no App Insights trace, no browser storage. The server passes them straight
  through to the isolated Google Sheet and keeps nothing.
- **Behind a flag.** A new public flag, `native-equalities-form`. With it off, the Typeform path is
  unchanged. Code can ship to prod dark.
- **`/typeform/hook` stays live** until the soak in M6 ends, so Typeform submissions already in
  flight still complete.
- Red/green e2e for every behaviour (see the `dashboard-testing-and-e2e` skill).

## How it works today (for reference)

1. `createDeviceRequest` saves the request with a random `correlationId` and returns it.
2. The dashboard embeds Typeform `f93D0s88` with hidden `corr_id`, `borough`, `ward`
   (`org-request.ts`, `displayTypeForm`).
3. Typeform writes the answers to the isolated Sheet (Typeform's own integration) and calls
   `POST /typeform/hook` (HMAC `TYPEFORM_KEY`).
4. `TypeformService` → `markRequestStepsCompleted(corrId)` sets `PROCESSING_EQUALITIES_DATA_COMPLETE`
   and clears `correlationId`, then `acknowledgeSubmission` sends the confirmation email.
5. Any request still holding a `correlationId` after 20 minutes is declined by
   `DeclineIncompleteDeviceRequests` (cron every 20 minutes).

Target: step 2 becomes the native form. Steps 3 and 4 become one public mutation that forwards the
answers to the Sheet and then runs the same completion code.

## Legend

Model = recommended subagent strength. Size: S < 1h, M 1–3h, L > 3h. Times are hands-on estimates
and exclude review and CI waits.

---

## M0: Decisions (human, before any build)

- [ ] **D1. Confirm the approval and the owner.** Get the CEO's approval in writing, and agree with
      the owner of the equalities Sheet (Cat) that the Sheet stays the system of record. *Blocks
      everything.*
- [ ] **D2. How the server writes to the Sheet.** *Blocks M1/M2.*
  - **Recommended: an Apps Script web app** bound to the Sheet (`doPost`, shared-secret header,
    appends one row). There's no GCP service-account key to manage, and the Sheet owner keeps
    control. Trap: Apps Script copies are hand-pasted (see the delivery-schedule export), so the
    script needs a version endpoint.
  - Alternative: the Sheets API with a service account shared on the Sheet. That puts a JSON key
    secret in Azure.
- [ ] **D3. Sheet layout.** Same Sheet and same columns as the Typeform integration, so existing
      reports keep working? Recommended: yes, plus a `source` column (`typeform`/`tada`). We also
      need a **separate test Sheet for UAT**.
- [ ] **D4. Question set.** The form is titled "2025/2026". Confirm that the 11 questions and their
      choices carry over unchanged (they were transcribed 2026-11-02).
- [ ] **D5. Failure policy.** Recommended: the write is synchronous. The request is marked complete
      and the email sent **only after** the Sheet accepts the row. If the write fails, the user
      sees a retryable error with their answers still on screen. Queueing for a later retry would
      mean storing the answers in TaDa, which breaks the ground rule.
- [ ] **D6. Privacy notice / DPIA.** Typeform stops being a processor for this data and TaDa
      becomes a pass-through. Does the privacy notice or DPIA need an edit? (For the CEO or data
      lead.)

**Pause point:** decisions recorded in this file.

## M1: Server (techaid-server, own branch)

| # | Task | Model | Size | Time |
|---|------|-------|------|------|
| [ ] S1 | Public mutation `submitEqualities(correlationId, answers)`. Allowed anonymously like `createDeviceRequest` (`RequestFilterConfig`). Rejects an unknown or already-cleared `correlationId`. Validates every answer against a server-side copy of the question refs and allowed choices, including the benefits=Yes → no-NRPF rule. | Opus | M | 3h |
| [ ] S2 | `EqualitiesSheetClient`: POST to the D2 endpoint with a secret header and a timeout. Never logs the body. Env vars `EQUALITIES_SHEET_URL` / `EQUALITIES_SHEET_SECRET`. | Sonnet | M | 2h |
| [ ] S3 | Extract the completion step from `TypeformService` (`markRequestStepsCompleted` + `acknowledgeSubmission`) so both the webhook and S1 call it. | Sonnet | S | 1h |
| [ ] S4 | **Redaction.** Exclude `submitEqualities` variables from `GraphQlTelemetryInterceptor`'s "input variables" logging and from any debug or request logging. Add a test that fails if an answer string appears in captured logs. | Opus | M | 2h |
| [ ] S5 | Per-IP rate limit on the mutation, same pattern as the booking submit. | Sonnet | S | 1h |
| [ ] S6 | Add the `native-equalities-form` flag to `featureFlagsPublic`, default OFF. | Haiku | S | 0.5h |
| [ ] S7 | Tests: `SchemaAssemblyTest`, service tests with a fake sheet client (happy path, Sheet down → nothing completed, bad corr_id, invalid answer, replay). Run `ktlintFormat` + `ktlintCheck`. | Sonnet | M | 2h |
| [ ] S8 | Set the secrets on UAT (pointing at the test Sheet) and the prod Container Apps. | Human | S | 0.5h |

**Pause point:** server PR merged to `dev`, deployed to api-testing, flag OFF.

## M2: Sheet receiver (Apps Script, if D2 = Apps Script)

| # | Task | Model | Size | Time |
|---|------|-------|------|------|
| [ ] A1 | `doPost`: checks the secret, maps question refs to the existing column order, appends a row. Duplicate `corr_id` returns OK without a second row (idempotent retry). Add a `?version` endpoint. Source lives in the repo (e.g. `tools/equalities-sheet/Code.gs`). | Sonnet | M | 2h |
| [ ] A2 | Deploy as a web app on the **test** Sheet (UAT) and, later, on the real Sheet (prod). Must be deployed by the Sheet owner's account. | Human | S | 0.5h |

**Pause point:** a curl with the secret appends a row to the test Sheet.

## M3: Dashboard (this repo)

| # | Task | Model | Size | Time |
|---|------|-------|------|------|
| [ ] F1 | Promote `equalities-preview` into a real step of `org-request`. With the flag ON it renders in place of the Typeform widget, given corr_id, borough and ward in memory. With the flag OFF, Typeform is unchanged. | Sonnet | M | 3h |
| [ ] F2 | Submit through `submitEqualities` with the network retry from #403 and an inline friendly error with a ref (#402). The thank-you and "request saved" screens match today's. | Sonnet | M | 2h |
| [ ] F3 | Accessibility and mobile pass on the Typeform-style UX: focus moves per question, Back, screen-reader labels, auto-advance not trapping keyboard users. | Opus | M | 2h |
| [ ] F4 | Privacy guard: answers never go to storage, App Insights (including the error-toast/exception path) or the URL. Extend the #265 spec assertions to the real flow. | Sonnet | S | 1h |
| [ ] F5 | Remove the `/preview/equalities-…` route. Keep `nonProductionGuard` only if something else uses it. | Haiku | S | 0.5h |
| [ ] F6 | `@mocked` specs: flag ON full journey (both benefits branches, error + retry, mutation payload shape); flag OFF still gets Typeform (`typeform-on-demand` keeps passing). | Sonnet | M | 2h |
| [ ] F7 | Live UAT spec: create request → submit equalities → status is `PROCESSING_EQUALITIES_DATA_COMPLETE`. Uses `E2E Sample` naming + cleanup, and writes to the **test** Sheet only. | Sonnet | M | 2h |

**Pause point:** dashboard PR merged to `dev`, on UAT, flag OFF in both environments.

## M4: UAT acceptance

- [ ] U1. Flag ON in UAT. Run the live spec. Check that the test Sheet row lines up column-for-column
      with a Typeform-era row. *(Sonnet, S)*
- [ ] U2. Search UAT App Insights for an answer string from the test submission. Expect zero hits.
      *(Sonnet, S)*
- [ ] U3. Cat walks through on phone and desktop and signs off the wording and Sheet output. *(Human)*

## M5: Production

- [ ] P1. Ship through the normal release cut (server first, then dashboard). The flag is still OFF.
- [ ] P2. Point the prod secret at the real Sheet's web app. Turn the flag ON in prod.
- [ ] P3. Watch the first few real submissions: a Sheet row appears, the status moves, the email is
      sent, nothing turns up in App Insights. Rollback = flag OFF, which brings back Typeform with
      no deploy.

## M6: Clean-up (after about 2 weeks' soak)

| # | Task | Model | Size | Time |
|---|------|-------|------|------|
| [ ] C1 | Dashboard: remove the Typeform embed loader and widget code from `org-request.ts`, the `typeform-on-demand` spec, `e2e/typeform-probe.mjs` and its runbook step. Drop the `embed.typeform.com` / `api.typeform.com` / `*.typeform.com` CSP entries. The `Qz4rILeN` link-out needs none of them. | Sonnet | M | 1.5h |
| [ ] C2 | Server: retire `/typeform/hook`, `TypeformService`, `TypeFormPayload` and `TYPEFORM_KEY`. Then retire the flag. | Sonnet | S | 1h |
| [ ] C3 | Typeform: close form `f93D0s88` and remove its webhook and Sheet integration. **The subscription can't be cancelled yet**, because `Qz4rILeN` still lives there. Check whether a free plan covers that one form. | Human | S | 0.5h |

---

## Rough total

About 30 hours of hands-on build and test time (server ~12h, Sheet ~2.5h, dashboard ~12.5h, rollout
and clean-up ~4h), plus reviews, the UAT sign-off and the soak.
