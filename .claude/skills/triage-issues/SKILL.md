---
name: triage-issues
description: Triage open GitHub issues for techaid-dashboard. Sweeps open issues, replicates against UAT where possible, and posts a structured "🤖 Triage" comment per issue (cannot-reproduce / more-info-needed / product-decision / root-cause-or-fix), flagging adjacent patterns without fanning out. Use when the user asks to triage issues, do an issue pass, or run the weekly triage. Repo is CommunityTechaid/techaid-dashboard.
---

# Triage GitHub Issues

Run a triage pass over open issues in `CommunityTechaid/techaid-dashboard`, posting one
structured `🤖 Triage` comment per issue in the house style. This skill captures the pattern
already in use on the repo (see issues #42, #49, #52, #70). It is the lightweight
*triage-and-suggest* layer on top of the full bug→PR workflow documented in
[CLAUDE.md](../../../CLAUDE.md) → "Issue Triage Workflow"; read that section before fixing.

## Scope of a run

By default triage **only untriaged open issues**. An issue is already triaged if a comment
contains the `🤖 Triage` header — skip those (don't re-triage). Confirm scope with the user
first if unclear: new bugs only / bugs + enhancements / everything. Don't post outward-facing
comments without the user having agreed to the scope and output mode (post directly vs. draft
for review first).

## Per-issue loop

1. **Read it fully.** `gh issue view <n> --repo CommunityTechaid/techaid-dashboard --json number,title,body,author,labels,comments`.
   (`--comments` alone sometimes prints nothing — fetch the JSON `body` explicitly.) Bail if a
   `🤖 Triage` comment already exists.

2. **Classify.** Bug vs. enhancement vs. product/UX question. Enhancements (e.g. the D-/T-/B-
   series) get *initial implementation suggestion + open questions*, not a repro attempt.

3. **Replicate (bugs).** Prefer code inspection first — many bugs are conclusive from the source
   (compare the named component against its siblings; the codebase has ~20 near-identical
   server-side paginated tables, so "what does every other one do differently" is a fast oracle).
   For a live repro, drive a Playwright spec under `e2e/tests/` against UAT
   (`ng serve --configuration uat-local` → `api-testing.communitytechaid.org.uk`). This needs a
   **fresh** bearer token in `e2e/.auth/user.json` (`E2E_BEARER_TOKEN=<tok> node e2e/save-token.mjs`);
   tokens expire within ~a day, so check `LastWriteTime` first and, if stale, either ask the user
   for a fresh token or fall back to code inspection — and **say which method you used** in the
   comment. Never commit the token.

4. **Post a `🤖 Triage` comment.** Use one of the verdict variants below. Write the body to a
   temp `.md` file and post with `gh issue comment <n> --body-file`, then delete the temp file
   (keeps markdown/backticks intact). Pick the matching label action.

5. **Flag adjacent patterns — don't fix them.** If the same root cause exists in files the issue
   doesn't name, append the `⚠️ Adjacent-pattern findings` section (exact header below) with
   concrete `file:line — one-line reason` entries. Do **not** open extra PRs or sweep.

## Verdict variants (header + what goes in the body)

- **`🤖 Triage — cannot reproduce`** — what was tested + evidence (DOM, GraphQL req/resp),
  most likely cause, tangential findings, closing note. Close the issue if confident; invite
  reopen with a record ID + screenshot. _(model: #70)_
- **`🤖 Triage — more info needed`** — a concrete numbered checklist of exactly what to capture
  (role, browser, the failing GraphQL request, console, localStorage/Auth0 entry), and *why each
  matters* (e.g. missing `Authorization` header = our bug vs. backend Access Denied = permissions).
  Add the `needs-info` label (`gh label create needs-info` if absent). _(model: #52)_
- **`🤖 Triage — product decision needed`** — context, numbered options with a recommended one,
  @-mention the relevant maintainer with the open question. Leave open; keep `question` label.
  _(model: #42)_
- **`🤖 Triage — root cause identified` / `— potential fix available for review`** — replication,
  root cause with the offending `file:line` snippet, the minimal proposed fix scoped to the named
  file, a scope note, then the adjacent-pattern section. If you actually open the fix PR, follow
  the full CLAUDE.md red/green-test workflow and link the PR. _(model: #49)_

## Adjacent-pattern section (exact header)

```markdown
---

## ⚠️ Adjacent-pattern findings — not addressed here

- `path/to/file.ts:<line>` — short note on why it's the same root cause
```

## Safety rails (from CLAUDE.md)

- One PR per issue; never fan out into sweep/refactor PRs autonomously.
- Base fix PRs on `dev`, never `master`/`dev` direct pushes, never merge a PR yourself.
- `Fixes #N` does **not** auto-close from a `dev` merge (default branch is `master`) — note that
  human review + manual close is expected.
- Never commit a bearer token or anything under `e2e/.auth/`.
- If `dev` build is already broken before you start, stop and say so — don't pile on.

## End of run

Summarise: issues triaged, verdict per issue, any `needs-info`/labels added, adjacent findings
worth a follow-up ticket, and anything that needs a human decision.
