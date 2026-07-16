# Community TechAid Dashboard

This repo is the source for the UI provided at https://app.communitytechaid.org.uk/

Angular admin dashboard for the charity's device pipeline. See [`CLAUDE.md`](CLAUDE.md) for the
release workflow, e2e testing, and issue-triage process.

## Run locally

Requires **Node 20**. Angular **21** — the CLI is a devDependency, so use `npx ng` (no global
install needed).

```bash
npm install        # NOT `npm ci` — the lockfile is Windows-maintained; `npm ci` fails on Linux
npx ng serve       # http://localhost:4200
```

`/api` is proxied to the backend Docker container (`techaid-server-web-1:8080`) — see "Setting up
the Dev environment" below. Without the API running, Auth0 login still works (real
`techaid-auth.eu.auth0.com` tenant, no API needed) but all GraphQL queries error and tables show
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

## Setting up the Dev environment

The setup branch contains the docker files and modifications necessary for setting up a local dev environment. This may be moved to a submodule later. 

Steps to follow: 

- Ensure that the `techaid-server-web-1` container is running (this is the backend. Follow the instructions on the repo to set it up). This container uses the same network as the backend container. 
- Run `docker compose up -d`

You should now be good to go. 

### Issues and Notes:
- For `ng serve` to work correctly without CORS issues, we use `proxy.conf.json` where we define the proxy for the backend api. Currently this is set to the name of the backend container. Change this if your backend url changes. 
- The way these containers are setup, the backend API is contacted using the name of the container running the backend API. This is because the containers are connected to the same virtual docker network in the docker compose file. If running on Linux, the frontend container can be started in the "host network mode" to access `localhost:8080` directly (assuming the backend container is available on 8080 on the host machine. Host network mode is not supported on Windows/Mac). On Windows/Mac, this can be achieved using `host.docker.internal:8080` domain. This might be useful when configuring nginx or to change the configuration in `proxy.conf.json` to steer clear of depending on container name.  
