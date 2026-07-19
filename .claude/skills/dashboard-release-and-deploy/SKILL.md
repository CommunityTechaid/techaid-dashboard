---
name: dashboard-release-and-deploy
description: >
  How techaid-dashboard ships: the CI gate, the dev→UAT auto-deploy, the manual prod deploy
  (workflow_dispatch → master auto-fast-forward), release-please mechanics, the cross-repo
  release-cut order with techaid-server, and — the part CLAUDE.md doesn't cover — what to do
  when the master fast-forward fails, what rollback actually is (and isn't) on this repo, why
  "Fixes #N" doesn't auto-close on a dev merge, how to verify what's live, and the
  out-of-band Cloudflare Worker deploy. Load this for anything about release-please PRs,
  deploy-dev.yml, deploy-prod.yml, the master fast-forward, version.ts, rollback, or "is the
  right build live".
---

# TechAid Dashboard — Release and Deploy

This skill goes deeper than `CLAUDE.md`'s **Release Workflow** and **Release cut runbook**
sections, which remain the canonical, authoritative steps — read those first. This skill adds
the failure branches, the operational history behind the safety rails, and how to verify a
deploy actually landed. Written 2026-07-19; facts below are cited to the workflow files or
marked with an as-of date where they're operational history rather than something re-derivable
from the repo.

**When NOT to use this skill:**
- The step-by-step happy path itself → `CLAUDE.md` **Release Workflow** / **Release cut
  runbook** sections are canonical; this skill assumes you've read them.
- Whether a diff is architecturally safe to ship → **dashboard-architecture-contract**.
- Diagnosing a bug in a deployed build → **dashboard-debugging-playbook** (has its own "is the
  right build deployed?" entry; this skill covers the *pipeline*, that one covers *symptoms*).
- What evidence a change needs before it's release-worthy → **dashboard-testing-and-e2e**.
- Working an open GitHub issue end-to-end → **triage-issues**.
- The API side of a release cut (techaid-server) → that repo's
  **techaid-prod-promotion-campaign** (gated promote runbook) and **techaid-deploy-and-operate**
  (Container Apps machinery). This skill is the dashboard's analogue of both, merged into one
  file because the dashboard's deploy surface (a static web app, no runtime to operate) is much
  smaller — no revision list, no cold starts, no container logs, nothing to restart.

## Glossary

| Term | Meaning here |
|---|---|
| SWA | Azure Static Web Apps — hosts both the UAT (`app-testing…`) and prod (`app.communitytechaid.org.uk`) dashboard as static builds |
| `deploy/dev/*`, `deploy/prod/*` | Git tags the deploy workflows push after every successful deploy (`YYYY-MM-DD-<sha7>`) — deployment markers, separate from release tags |
| `v*` tag | Release-please's tag on the release-PR merge commit (e.g. `v1.1.0`) — **never create these by hand** |
| release PR | The single open PR release-please maintains on `dev` (`chore(dev): release X.Y.Z`), auto-updated as conventional commits land |
| FF (fast-forward) | The plain, non-force `git push origin HEAD:refs/heads/master` `deploy-prod.yml` runs after a successful prod deploy |
| `version.ts` triple | `{version, build, commit}` stamped into `src/environments/version.ts` at build time — see §4 for where it's visible |
| workflow_dispatch | A workflow triggered manually from the Actions tab (or `gh workflow run`) |

## 1. Pipeline anatomy

Four workflows in `.github/workflows/` (read in full 2026-07-19):

| Trigger | Workflow | What it does |
|---|---|---|
| PR → `dev` | `ci.yml` | lint (`eslint --quiet`) + production build + `e2e-mocked` (@mocked Playwright, self-mints a fake JWT, no secrets). All three gate the PR; `e2e-mocked` also enforces a >40% skip-ratio ceiling |
| push → `dev` | `deploy-dev.yml` | `npm install` → stamp `version.ts` → inject `env.js` (App Insights conn string) → `ng build --configuration uat` → deploy to UAT SWA → sync project board ("In UAT") → tag `deploy/dev/<date>-<sha7>` |
| push → `dev` | `release-please.yml` | maintains the single open release PR (§2) |
| manual (Actions tab) | `deploy-prod.yml` | checkout `ref: dev` → `npm ci` → stamp `version.ts` → `ng build --configuration production` → deploy to prod SWA → tag `deploy/prod/<date>-<sha7>` → label linked issues "shipped" → fast-forward master (§1a) |

`ci.yml` and `deploy-dev.yml` use `npm install`, not `npm ci` — a comment in `ci.yml` explains
why: the Windows-maintained lockfile is missing platform-optional entries (`@emnapi/core`), so
`npm ci` rejects it on Linux runners. `deploy-prod.yml` is the exception and uses `npm ci` —
worth knowing if a prod deploy ever fails at install for a reason UAT didn't hit.

**version.ts stamping** (identical logic in both deploy workflows, lines ~29–35 of each): the
semver always comes from `package.json` (the *last released* version — unchanged between
releases), while `build` (`YY.MM.DD-HHMM` UTC) and `commit` (7-char SHA) are unique per build.
That's how a Tuesday UAT build and a Wednesday one are distinguishable even though
`version.version` reads the same `1.1.0` both times.

**§1a — the master fast-forward.** `deploy-prod.yml`'s last step is:

```bash
git push origin HEAD:refs/heads/master
```

`HEAD` at that point is the `dev` commit that was just built and deployed to prod. This is a
**plain push, not `--force`** — deliberately, so it only succeeds if `master` is strictly
behind `HEAD` (i.e. an ancestor). If `master` has diverged for any reason, this step fails —
see §4 for what that looks like and how to recover. Also note: **`deploy-prod.yml` has no
GitHub environment approval gate** — unlike techaid-server's `promote.yml` (which pauses for a
named reviewer), triggering this workflow deploys immediately. The "gate" here is entirely
procedural: merging the release-please PR is the deliberate go/no-go moment (§2), and running
this workflow afterward is the shipping motion. There is no machine-enforced pause between
"I clicked Run workflow" and prod traffic serving the new build.

**Deploy tags vs release tags** — do not confuse the two tag families:

- `deploy/dev/*` and `deploy/prod/*` are **deployment markers**, pushed by the deploy
  workflows on every successful run. Multiple per day is normal. Useful for "which commit was
  live when."
- `v*` (e.g. `v1.1.0`) is a **release tag**, created solely by release-please when its PR is
  merged. **Never create a `v*` tag by hand** — release-please owns the mapping between tags,
  `CHANGELOG.md`, and `package.json`'s version, and a hand-made tag will desync it.

## 2. Release-please mechanics

`release-please.yml` runs `googleapis/release-please-action@v4` against `target-branch: dev`
with `release-please-config.json` (`release-type: node`, tag includes a `v` prefix, no
component in the tag — so `v1.1.0`, not `angular-template-v1.1.0`) and
`.release-please-manifest.json` (currently `{".":"1.1.0"}` as of 2026-07-19, with an open
`chore(dev): release 1.2.0` PR #125 outstanding).

- Conventional-commit **titles** drive both the version bump and the changelog: `fix:` →
  patch, `feat:` → minor, `feat!:` or a `BREAKING CHANGE:` footer → major. `chore:`, `test:`,
  `ci:`, `refactor:` don't bump or appear in the changelog.
- Because most merges into `dev` are **squash merges**, the squash commit's title *is* the
  conventional-commit message release-please reads — get the PR title right, not just the
  commits inside it.
- **Merging the release PR is pure paperwork.** It bumps `package.json`, updates
  `CHANGELOG.md`, and (per release-please's own post-merge step) tags the merge commit
  `vX.Y.Z` and cuts a GitHub Release. It does **not** deploy anything — `deploy-dev.yml` only
  triggers on `push: branches: [dev]`, which the merge *does* satisfy, so UAT does get
  redeployed as a side effect, but that's incidental, not the point. Prod deploy still
  requires running `deploy-prod.yml` by hand.

**Gotcha (operational, as of 2026-06):** if the workflow fails with *"release-please failed:
GitHub Actions is not permitted to create or approve pull requests"*, the YAML and commits are
fine — the branch/commit gets created, it just dies at the open-PR step. The fix is the
**"Allow GitHub Actions to create and approve pull requests"** toggle, which has two layers
that both must be on: **org-level** (`github.com/organizations/CommunityTechaid/settings/
actions`, org-owner only — if off, the repo-level API call 409s) and **repo-level** (`gh api
--method PUT repos/CommunityTechaid/techaid-dashboard/actions/permissions/workflow -f
default_workflow_permissions=read -F can_approve_pull_request_reviews=true`). After fixing,
re-run the existing run (`gh run rerun <run-id>`) rather than pushing a new commit — this
isn't a YAML problem, don't chase it there.

## 3. The cross-repo release cut

`CLAUDE.md`'s **Release cut runbook** is canonical for the exact sequence — summarized here
only to anchor where this repo's steps sit in the larger picture:

1. techaid-server: merge its release PR → `dev` (tags release; CI deploys to api-testing)
2. techaid-server: run `promote.yml` with blank `image_tag` (prod API deploy — promotes
   whatever image UAT is currently running)
3. techaid-dashboard: merge its release PR → `dev` (tags release; `deploy-dev.yml` redeploys UAT)
4. techaid-dashboard: run `deploy-prod.yml` (prod UI deploy — auto-FFs master on success)
5. `node e2e/csp-probe.mjs https://app.communitytechaid.org.uk` — post-deploy CSP/Turnstile check

**Why API before UI:** the dashboard's UI features can depend on server-side GraphQL mutations
that must already exist in prod before the UI that calls them ships — shipping the UI first
risks a live user hitting a mutation prod doesn't have yet. Why paperwork (the release PR
merge) has to happen before either deploy workflow runs: deploying before the merge ships a
build stamped with the *previous* released semver (see the `version.ts` stamping logic in
§1 — it reads `package.json` at build time, before the bump lands), and the eventual `v*` tag
would land on a commit that isn't actually what got deployed.

Cross-repo detail (topology, Container Apps operations, `promote.yml`'s `image_tag` rollback
input, the `production` GitHub environment approval gate) lives in techaid-server's
**techaid-deploy-and-operate** and **techaid-prod-promotion-campaign** — read those, don't
duplicate them here.

## 4. Failure branches and recovery

### 4a. The master fast-forward fails

**By the time you see this failure, prod is already live** — the FF push is the *last* step
of `deploy-prod.yml`, after the SWA deploy and the deploy tag already succeeded. This is not
an incident; it's a bookkeeping problem. Diagnose why `master` has a commit that isn't an
ancestor of `dev` (someone committed to `master` directly, or a previous FF was worked around
some other way), then use the manual fallback from `CLAUDE.md`:

```bash
git fetch origin
git checkout master
git merge --ff-only origin/dev
git push origin master
```

If `merge --ff-only` itself refuses (genuine divergence, not just a stale local `master`),
do **not** force-push — `master` is a protected branch with force-push disabled, so
`git push --force` would fail anyway with `GH006 Protected branch update failed`, and even if
it didn't, force-pushing a shared branch is exactly the kind of history rewrite that breaks
every collaborator's local `master`.

**History (as of 2026-06-01):** this happened for real — `master` had diverged from `dev` by
15 commits, still holding the old pre-upgrade production state (legacy CircleCI/Dockerfile/
nginx deploy path that `dev`'s Angular-21 rewrite had deliberately removed). Every functional
fix on those 15 commits already existed on `dev` in updated form, so `dev` was a strict
superset — but `master` wasn't an ancestor of `dev`, so both `merge --ff-only` and the
workflow's plain push would have failed. The fix was **not** a force-push; it was
`git merge -s ours origin/master` run *on dev* (strategy `-s ours`, not option `-X ours` — the
latter would merge the legacy files back into the tree), recording `master` as a merged
ancestor while leaving `dev`'s tree byte-for-byte unchanged (verified empty `git diff
origin/dev HEAD` at the time). That made `master` an ancestor of `dev` again, so the next FF
push succeeded (`deploy/prod/2026-06-01-97a3120`). **If `master` ever diverges again, this is
the precedent to study** — but confirm *why* it diverged first; `-s ours` is a full
merge-conflict-resolution decision, not a rote command to replay blindly.

As of 2026-07-19, `origin/master` still sits at `97a3120` (that same reconcile commit) while
`origin/dev` is 64 commits ahead — no prod deploy since 2026-06-01. Expected under this model
(prod deploys are deliberate; UAT has been iterating on feature-flags/delivery-booking work in
the interim), not itself a sign of breakage — just a reminder `master` reflects a much older
build than what UAT runs.

### 4b. "I deployed the wrong thing, I need to roll back"

**Verified by reading `deploy-prod.yml` in full:** it takes `workflow_dispatch` with **no
inputs at all** — always `actions/checkout@v4` with `ref: dev`, always builds whatever is at
`dev`'s HEAD. No `image_tag`-style parameter, no ref override. This differs from
techaid-server's `promote.yml`, which accepts an `image_tag` input specifically so a promote
can pin (and roll back to) an arbitrary previously-published image — **the dashboard has no
equivalent built-in rollback lever.**

The only verified rollback path, given that constraint:

1. `git revert` the offending commit(s) on `dev` (or otherwise get `dev`'s HEAD back to a
   known-good tree — reverting preserves history and doesn't require a force-push).
2. Push the revert to `dev` — this alone auto-redeploys UAT (`deploy-dev.yml`) and gives you
   free confirmation that the reverted build is what you expect, before touching prod.
3. Run `deploy-prod.yml` again. It builds `dev`'s new HEAD (the revert) and deploys it,
   FF-ing `master` on success as normal.

This is slower than techaid-server's tag-pin rollback (minutes of CI/build time, not an
instant image swap) — no faster verified option exists. A truly instant rollback would need a
workflow change (e.g. a `ref` input on `deploy-prod.yml`) — that's not an existing capability,
don't invent one that isn't there.

### 4c. "Fixes #N" didn't close the issue

GitHub's auto-close keywords (`Fixes`/`Closes`/`Resolves #N`) only fire on a merge into the
repo's **default branch**, `master` — not `dev`. Every triage PR merges into `dev` (per
`CLAUDE.md`'s issue-triage workflow), so a `Fixes #N` PR body leaves the issue open after
merge; GitHub doesn't even post the usual "linked PR" auto-comment. **Verified 2026-05-27**
across PRs #66/#68/#69: all three merged to `dev` with `Fixes #N`, all three issues stayed
open until closed manually. Close by hand after merging: `gh issue close <num> --comment "..."
--reason completed`. The keyword *will* eventually fire once the release reaches `master` via
§4a's FF, but that can be weeks away — don't leave the issue looking unaddressed until then.

## 5. Verifying what's live

The `version.ts` triple (`version`, `build`, `commit` — see §1) is rendered in the running app:
`src/app/app.component.html` puts it in a `title` tooltip on a bottom-right corner element —
hover it (or read the DOM) to see `API: <apiVersion> / Web: <version> (<commit>) <build>`. This
is the fastest way to confirm a specific commit is actually serving traffic, since `build` and
`commit` are unique per deploy even when `version` (the semver) hasn't changed between
releases.

Independent confirmation, if you can't reach the running app:

```bash
git tag -l "deploy/prod/*" --sort=-creatordate | head -5   # deploy tags, newest first
git log -1 origin/master                                    # what the last FF landed
gh run list --workflow=deploy-prod.yml -L 5                 # recent prod-deploy runs
```

There's no `/actuator/info`-style endpoint here (that's techaid-server's mechanism) — the SWA
serves static files, so the `version.ts` tooltip and the deploy tags/workflow logs are it.

## 6. The Cloudflare Worker deploy (out-of-band)

`workers/cta-places-proxy/` (proxies Google Places for the address autocomplete fields,
including on the public booking page) is **not deployed by any GitHub workflow** — none of the
four workflows in `.github/workflows/` reference it. It ships manually:

```bash
cd workers/cta-places-proxy
npx wrangler deploy
```

The repo is the source of truth for this Worker's code, but because deploys are manual and
out-of-band, **repo and deployed state can silently drift** if someone edits without
redeploying, or deploys without committing first — always do both together. Hardened
2026-07-19 (PR #139) with an origin allowlist (dashboard prod/UAT/localhost only, else 403)
and a 60 req/min/IP rate limit. If you touch this Worker again, re-verify the deployed config
matches the repo (`npx wrangler deploy --dry-run` diffs against what's live) rather than
assuming the last `git push` shipped it.

Related but **not** part of this pipeline at all: the public booking form's open/closed toggle
lives at the Cloudflare edge (not in this repo's app code, not in any admin panel, not touched
by any deploy workflow here) — don't go looking for it in `deploy-prod.yml` or the admin UI.

## 7. Safety rails

- **Never push to `master` except the automated FF.** Every direct commit is a future §4a
  divergence — see the 2026-06-01 history above for what recovering from that actually costs.
- **Never create `v*` tags by hand** — release-please owns the tag/changelog/version mapping;
  a hand-made tag desyncs it with no clean way back.
- **UAT deploys are cheap and automatic** (any push to `dev`) — treat them as disposable.
  **Prod deploys are deliberate** (`workflow_dispatch`, no approval gate, immediate effect) —
  treat every trigger of `deploy-prod.yml` as "this goes live now," because it does.
- Don't skip §2's release-PR merge before deploying prod (§3: stale version stamp, tag lands
  on the wrong commit otherwise).

## Provenance and maintenance

Authored 2026-07-19 against `dev` HEAD `40133b2`. Pipeline mechanics read in full from
`.github/workflows/ci.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `release-please.yml`,
`release-please-config.json`, and `.release-please-manifest.json`. `version.ts` stamping and
display verified against `src/environments/version.ts`, `src/app/app.component.ts`, and
`src/app/app.component.html`. Tag history (`deploy/dev/*`, `deploy/prod/*`, `v*`) and the
master/dev divergence figure (64 commits, as of 2026-07-19) read live via `git tag` / `git log
origin/master..origin/dev`. The `deploy-prod.yml` "no rollback input" claim and "no environment
approval gate" claim are both direct readings of that file — grep it yourself if it's been
edited since. Operational history (master reconcile, release-please PR-permission toggle,
`Fixes #N` non-auto-close) is incident memory, not re-derivable from the repo alone.

Re-verify before trusting:
- Pipeline steps: `cat .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml`
- Release-please state: `gh pr list --state open` (look for `chore(dev): release …`) + `cat .release-please-manifest.json`
- Master/dev drift: `git fetch origin && git log origin/master..origin/dev --oneline | wc -l`
- Deploy tags: `git tag -l "deploy/prod/*" --sort=-creatordate | head -5`
- Approval gate / ref input on the FF: `grep -n "environment:\|inputs:" .github/workflows/deploy-prod.yml` (expect no matches, as of writing)
- Worker deploy currency: `cd workers/cta-places-proxy && npx wrangler deploy --dry-run`
