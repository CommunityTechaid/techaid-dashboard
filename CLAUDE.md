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

---

