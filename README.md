# Community TechAid Dashboard

This repo is the source for the UI provided at https://app.communitytechaid.org.uk/

Angular admin dashboard for the charity's device pipeline. See [`CLAUDE.md`](CLAUDE.md) for the
release workflow, e2e testing, and issue-triage process.

## Run locally

Requires a current **Node LTS** (22 or newer) for Angular **22** — the CLI is a devDependency, so
use `npx ng` (no global install needed).

```bash
npm install        # NOT `npm ci` — the lockfile is Windows-maintained; `npm ci` fails on Linux
```

There are two ways to run the dashboard locally. Both need `http://localhost:4200` registered on
the Auth0 SPA application (Allowed Callback URLs, Logout URLs and Web Origins), and an Auth0 user
with the roles you need. Login uses the shared `techaid-auth.eu.auth0.com` tenant in both.

### Option B — against UAT (quickest, front-end work)

```bash
npm run start:uat  # = npx ng serve --configuration uat-local → http://localhost:4200
```

`src/proxy.conf.uat.json` forwards `/graphql` and `/auth` to `https://api-testing.communitytechaid.org.uk`.
You are reading and writing the **shared UAT data** — treat it as such.

### Option A — against a local API and database (back-end or risky work)

1. Start the API and Postgres from `techaid-server` — follow "Local development" in its README
   (`docker compose up -d`, then `bootRun` inside the `techaid-server-web-1` container).
2. Check it is up: `curl -s localhost:8080/actuator/health`.
3. `npx ng serve` → http://localhost:4200. `src/proxy.conf.json` forwards `/api` to
   `http://localhost:8080` and strips the prefix.

The local database starts empty (schema only), so lists are empty until you add test data. Never
load a production or UAT dump onto a laptop — it contains personal data.

Without the API running, Auth0 login still works but all GraphQL queries error and tables show
empty.

## If the dashboard shows no data

The dashboard is static (Azure Static Web Apps) and rarely "down" itself. Empty or errored tables
almost always mean **the API is down or cold-starting** — check
[`techaid-server/SITE-IS-DOWN.md`](https://github.com/CommunityTechaid/techaid-server/blob/dev/SITE-IS-DOWN.md)
first, not the frontend.

## Build

`npm run build` produces a production build in `dist/`. `npx ng build --configuration production`
is the primary structural signal — if it compiles cleanly, the code is sound.

## Upgrading Angular

Follow https://update.angular.io/ for the current major-to-major steps, then run `npx ng update`
to see available updates and `npx ng update <package>` to apply them. (Do **not** globally
uninstall/reinstall the CLI — it is a project devDependency.) Update this README's version numbers
when you bump a major.

## Code scaffolding

Run `npx ng generate component component-name` to generate a new component. You can also use
`ng generate directive|pipe|service|class|guard|interface|enum|module`.
