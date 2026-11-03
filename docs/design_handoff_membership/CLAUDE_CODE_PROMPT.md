# Prompt for your Claude Code session (techaid-dashboard repo)

> Tony: start the session with *"Follow docs/design_handoff_membership/CLAUDE_CODE_PROMPT.md"*.

I'm adding **Membership** support (tiers, a yearly request allowance and membership contacts) to the dashboard. A design handoff is in `docs/design_handoff_membership/`.

## Read first
1. Read `docs/design_handoff_membership/README.md` in full. It holds the agreed rules, the open decision, and a screen-by-screen spec.
2. Read `BACKEND_ISSUE.md`. It is the proposed API contract with `techaid-server`.
3. Open the `mockups/*.html` pages in a browser, or view the `.png` screenshots. A dashed blue outline marks new UI.
4. Load the `dashboard-architecture-contract` skill before designing anything, and the `dashboard-testing-and-e2e` skill before writing tests.

## Framing
- The mockups are a **design reference only**. Don't ship or commit them as app code.
- Build with the app's existing patterns: standalone components, Apollo, Formly, ng-bootstrap, DataTables, NGXS and Bootstrap 5 classes.
- Port only the new styles from `mockups/cta.css`: badges, alerts and the meter.
- The README's component mapping is a guess from folder names. Confirm each target component before touching it.
- Treat the over-limit behaviour (grace vs block) as a server-driven mode. Don't hardcode either option.

## Do this, in order
1. **Backend contract first.**
   - Post `BACKEND_ISSUE.md` as an issue on `CommunityTechaid/techaid-server` (the command is at the top of that file) and give me the link.
   - Check the contract against how the dashboard already queries organisations, referees and device requests, including the public request form. Comment on that issue with any changes the frontend needs.
   - Don't start the server work in this repo. I'll run that in a `techaid-server` session.
2. **Frontend plan.** Before writing code, give me a short plan and the list of files you'll touch, then wait for my go-ahead. Include how you'll stub the new GraphQL fields until the server lands on api-testing.
3. Build in the README's suggested order. Start with a shared membership-badges component and the organisation detail page.
4. **Tests.** Add `@mocked` Playwright specs for each badge state (Free, paid tier, Last request, Limit reached, Membership contact, Grace) and for both over-limit modes on the public form. `ng build --configuration production` must pass.
5. **Branching.** Use `claude/membership-<slug>` branches, conventional commits (`feat: …`), and PRs into `dev`. Never push to `master` or `dev` and never merge; follow `CLAUDE.md`.

## Out of scope for v1
- A staff override of the limit (unconfirmed).
- Emailing membership contacts.
- Any Superset reporting.
