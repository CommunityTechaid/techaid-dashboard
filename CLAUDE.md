# techaid-dashboard

Angular dashboard for [CommunityTechAid](https://communitytechaid.org.uk), a charity that collects, refurbishes, and distributes tech donations to people in need.

## Building

```bash
npm install
ng build
ng build --configuration production   # use this to verify correctness — it's stricter
```

## Running Locally

```bash
ng serve
```

The dev server proxies `/api` → `http://techaid-server-web-1:8080` (a Docker container). To load real data you need the API running in Docker. Without it:
- Auth0 login still works — it uses the real `techaid-auth.eu.auth0.com` tenant, no API required
- All GraphQL queries will fail with network errors — lists and tables will be empty or error

Auth is configured in `src/app/shared/services/authentication.service.ts`. The Auth0 client ID and domain are hardcoded there.

## Architecture

| Concern | Implementation | Key files |
|---|---|---|
| GraphQL client | Apollo Angular v13 (`@apollo/client@4`) | `src/app/graphql.module.ts` |
| State management | NGXS v21 | `src/app/state/` |
| UI components | ng-bootstrap v20 + Bootstrap 5 | throughout |
| Dynamic forms | ngx-formly v7 (8 custom field types) | `src/app/shared/modules/formly/` |
| Auth | `@auth0/auth0-angular` v2 (`AuthModule.forRoot`) | `src/app/shared/services/authentication.service.ts`, `src/app/app.module.ts` |
| Feature components | 36 components | `src/app/views/corewidgets/components/` |
| Shared services | 3 services | `src/app/shared/services/` |

Environment configs live in `src/environments/` (dev, prod, uat, local).

## Release Workflow

`master` represents the latest state deployed to production — it is not the
default development branch. Versioning and the changelog hang off this rule.

1. Work merges into `dev` via PR. `dev` auto-deploys to UAT and patch-bumps
   `package.json` (see `.github/workflows/deploy-dev.yml`).
2. Each PR that produces a user-visible change must add a bullet under
   `## [Unreleased]` in `CHANGELOG.md`, grouped under
   `Added` / `Changed` / `Fixed` / `Removed` / `Security`. Pure refactors,
   test-only changes, and CI tweaks don't need an entry.
3. Production deploys are manual: run the `Deploy to Production SWA`
   workflow (`workflow_dispatch`) — it builds and deploys from `dev`.
4. **After a successful production deploy**, fast-forward `master` to the
   deployed commit and push:
   ```bash
   git fetch origin
   git checkout master
   git merge --ff-only origin/dev
   git push origin master
   ```
   If a fast-forward isn't possible, stop and investigate — `master`
   should never diverge from `dev`'s history.
5. Then cut the release: read the current `package.json` version (e.g.
   `1.0.27`), rename `## [Unreleased]` in `CHANGELOG.md` to
   `## [1.0.27] — YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above
   it, commit to `master`, tag (`git tag v1.0.27 && git push origin v1.0.27`),
   and create a GitHub Release for the tag using that changelog section
   as the body.

Safety rails:
- Never push to `master` other than the fast-forward described above.
- Never tag `dev` commits — tags belong on `master` so they always point
  at production state.
- If `dev` has multiple version bumps between prod deploys, the release
  takes whatever version is on `master` after the fast-forward — that's
  the version that actually shipped.

## Testing

Run the full e2e suite against the UAT backend (requires a valid token in `e2e/.auth/user.json`):

```bash
# Save a fresh token first (obtain bearer token from DevTools → Application → localStorage)
E2E_BEARER_TOKEN=<token> node e2e/save-token.mjs

# Run all tests
npx playwright test

# Run a specific suite
npx playwright test tabs
```

The dev server is started automatically (`ng serve --configuration uat-local`). The `uat-local`
config uses a local proxy to forward `/graphql` to `api-testing.communitytechaid.org.uk`, which
avoids CORS issues. The Playwright tests additionally inject an `Authorization` header via
`page.route()` to guarantee every request is authenticated even before the Auth0 SDK initialises.

`ng build --configuration production` remains the primary structural signal — if it compiles
cleanly, the code is sound.

## Issue Triage Workflow

When asked to triage open GitHub issues (manually or via a scheduled task), follow this loop for
each open `bug`-labelled issue. The repo is `CommunityTechaid/techaid-dashboard` — use `gh` for
all GitHub interactions.

1. **Read the issue.** `gh issue view <num> --comments`. If a previous triage comment exists
   from you (look for the "🤖 Triage" header), skip — don't re-triage the same issue.

2. **Attempt to replicate against UAT.** The UAT-backed local server (`ng serve --configuration
   uat-local`, started automatically by Playwright) talks to `api-testing.communitytechaid.org.uk`,
   so reproductions exercise real UAT data. Prefer driving the repro through a Playwright spec
   under `e2e/tests/` — that doubles as the red test for step 4. A fresh bearer token in
   `e2e/.auth/user.json` is required (see the Testing section above).

3. **Branch on outcome.**
   - **Cannot replicate / not enough info:** post a comment on the issue listing the specific
     details still needed (exact steps, browser, role/permissions, screenshots, console errors,
     network traces, affected record IDs). Do not open a PR. Add label `needs-info` if it does
     not exist, create it (`gh label create needs-info`).
   - **Can replicate:** continue to step 4.

4. **Red/green test + fix.** Every fix MUST land alongside an automated E2E test that fails
   before the fix and passes after — this is non-negotiable, it's how the suite grows.
   - Write the failing Playwright spec first under `e2e/tests/` (commit it red if helpful for
     review clarity).
   - Implement the minimum fix. Verify `ng build --configuration production` and the new test
     both pass.
   - Branch name: `claude/issue-<num>-<short-slug>`. One commit per logical change; reference
     the issue in the commit body (`Refs #<num>`).
   - **Stay in scope.** Fix the file(s) the issue actually names. Do not refactor adjacent
     forms, extract shared helpers across components, or sweep "the same pattern elsewhere"
     into this PR even if you spot it — see step 7.

5. **Open the PR and update the issue.**
   - `gh pr create --base dev --title "fix: <summary> (#<num>)" --body ...`. Base is `dev`,
     not `master` — every prior `claude/*` PR has merged into `dev` and master is reserved
     for release cuts. PR body must include `Fixes #<num>`, a one-paragraph root-cause
     explanation, and a "Test plan" section pointing at the new spec.
   - Post a comment on the issue: short summary of the cause, link to the PR, note that it
     awaits human review before merge. Do NOT merge the PR yourself.

6. **Extreme cases (won't fix / by design / external).** If the issue cannot be fixed in this
   codebase (e.g. Cloudflare edge config, upstream API behaviour, an Auth0 tenant setting),
   skip the PR and instead post a comment explaining the root cause and the actionable guidance
   needed to avoid recurrence. Add label `wontfix` only if the maintainers have already agreed
   in-thread — otherwise leave it for a human.

7. **Adjacent-pattern findings — flag, don't fix.** If, while investigating, you notice the
   same root-cause pattern exists in other files that the issue does *not* name (e.g. issue
   #49 was kit-info, but `[disabled]="form.invalid"` exists across many other forms), do
   **not** fan out into them and do **not** open a second PR. Instead, append a clearly-marked
   section to your triage comment on the issue using this exact header so a human can find it:

   ```markdown
   ---

   ## ⚠️ Adjacent-pattern findings — not addressed in PR #<num>

   The same root cause appears in N other places that were **not** touched by this PR. Listed
   for a maintainer to decide whether to schedule a follow-up sweep:

   - `path/to/file.ts:<line>` — short note on why it's the same pattern
   - `path/to/other.html:<line>` — …

   _Skipped because the triage workflow keeps each PR scoped to the reported issue. To act on
   this, open a separate ticket or instruct me to do a sweep PR._
   ```

   Keep the list concrete (file + line + one-line reason). Don't include speculative finds —
   only places where the same root cause clearly applies.

Safety rails for the scheduled task:
- Never force-push, never push to `master` or `dev`, never merge a PR.
- Never commit a bearer token, `.auth/user.json`, or anything under `e2e/.auth/`.
- One PR per issue. Do not open follow-up / sweep / refactor PRs autonomously — see step 7.
- If the build is already broken on `dev` before you start, stop and post a comment on the
  oldest open issue saying triage is paused; don't pile fixes on top of a broken base.

---

