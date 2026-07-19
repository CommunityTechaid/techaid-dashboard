# techaid-dashboard skill library

Five skills carrying this repo's operational knowledge — how to design, debug,
test, and ship the dashboard. AI sessions load them automatically by
description; humans: start with the routing table below. Each skill ends with a
**Provenance and maintenance** section — re-verify volatile facts there before
relying on them.

This library mirrors the (larger) library in
[`techaid-server/.claude/skills/`](https://github.com/CommunityTechaid/techaid-server),
which remains the authority for everything API-side: domain meaning (kits,
device requests, statuses, Auth0 scopes → `techaid-domain-reference`), server
invariants (→ `techaid-architecture-contract`), API debugging and Azure
operations. `CLAUDE.md` at this repo's root stays the always-loaded contract;
these skills add depth — if a skill and CLAUDE.md ever disagree, CLAUDE.md wins
and the skill needs fixing.

## Your situation → load this skill

| Situation | Skill |
|---|---|
| Designing a change; will it break an invariant? (Apollo, Formly, CSP, Worker…) | `dashboard-architecture-contract` |
| Something is broken / investigating a bug or weird behaviour | `dashboard-debugging-playbook` |
| Writing/changing code or tests; what evidence is needed; a spec failed | `dashboard-testing-and-e2e` |
| Releasing, deploying, rolling back, "is the right build live?" | `dashboard-release-and-deploy` |
| Sweeping open GitHub issues (the weekly triage loop) | `triage-issues` |

## Inventory

| Skill | One line |
|---|---|
| `dashboard-architecture-contract` | Load-bearing design decisions (standalone Angular 21 + esbuild, Apollo v4 frozen responses, Formly resetOnHide, users-sort quirk, OnPush pilot, CSP-constrained NGXS, manually-deployed Places Worker), the invariants a diff must not break, known weak points |
| `dashboard-debugging-playbook` | Symptom → first check → trap → discriminating experiment for every known dashboard failure mode |
| `dashboard-testing-and-e2e` | Red/green rule, the @mocked/live-UAT Playwright split, the certified 30-spec inventory, hygiene tooling, known flakes, acceptance ladder |
| `dashboard-release-and-deploy` | Pipeline anatomy, release-please, the cross-repo release cut, master fast-forward failure branches, rollback reality, the out-of-band Worker deploy |
| `triage-issues` | The structured GitHub issue-triage loop (replicate on UAT, red/green fix or needs-info, adjacent-pattern flagging) |

## Suggested onboarding order (humans, new to the project)

1. Repo `CLAUDE.md` — the contract: build, release workflow, triage rules.
2. `dashboard-architecture-contract` — how the app is built and why.
3. `dashboard-testing-and-e2e` — how changes are proven here.
4. Skim `dashboard-debugging-playbook` — the battles already fought.
5. techaid-server's `techaid-domain-reference` — what the data means.

Maintenance: this README is an index only — facts live in the skills. When
adding a skill, add its row to both tables. A PR that changes a process a
skill documents updates that skill in the same PR. Authored 2026-07-19.
