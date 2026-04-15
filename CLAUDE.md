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

<!-- UPGRADE IN PROGRESS — DELETE EVERYTHING BELOW THIS LINE BEFORE MERGING TO MAIN -->

## Angular Upgrade: v11 → v20 ✓ Complete

Angular is now on **v20.3.18**. All four Angular upgrade checkpoints are done.

---

## Library Upgrade: Post-Angular-20

With Angular at v20 the bundled third-party libraries need to catch up.
Work through the checkpoints below in order — each checkpoint must pass
`ng build --configuration production` and `npx playwright test` before proceeding.

### Checkpoint Status

| # | Libraries | Status |
|---|---|---|
| L1 | Playwright e2e test suite (smoke, navigation, tab-regression) | ✓ Complete |
| L2 | `ng-bootstrap` v15 → v19 · `@ng-select/ng-select` v11 → v20 | ✓ Complete |
| L3 | `@ngxs/store` + plugins v3 → v20 | ✓ Complete |
| L4 | `bootstrap` v4 → v5 · `@ngx-formly` v6 → v7 · `datatables.net-bs4` → `datatables.net-bs5` | ✓ Complete |
| L5 | `ngx-toastr` v15→v19 · `moment` v2.27→v2.30 · `datatables.net` v1→v2 · `datatables.net-bs4` removed | ✓ Complete |

### Before Merging to Main

Delete everything from the `<!-- UPGRADE IN PROGRESS -->` marker to the end of this file.

---

## Post-Upgrade Roadmap

Each checkpoint below must pass `ng build --configuration production` and `npx playwright test`
before proceeding to the next.

### Checkpoint Status

| # | Task | Status |
|---|---|---|
| P1 | Remove zombie dependencies (`popper.js`, `request`, `resumablejs`, `pusher-js`, `xterm`) | ✓ Complete |
| P2 | Bump safe minor versions (`core-js`, `@types/node`, `prismjs`, `ts-node`, `applicationinsights`, etc.) | ✓ Complete |
| P3 | Auth0: migrate `@auth0/auth0-spa-js` v1 → `@auth0/auth0-angular` v2 | ✓ Complete |
| P4 | Apollo: `apollo-angular` v5 → v13 · `@apollo/client` v3 → v4 | ✓ Complete |
| P5 | Replace `moment` with `date-fns` (moment is in maintenance mode) | ✓ Complete |
| P6 | CKEditor 4 → `ngx-quill` — replaced the single `richtext` formly field; CK4 removed | ✓ Complete |
| P7 | Standalone component migration (`ng generate @angular/core:standalone`) | ✓ Complete |
| P8 | Angular v20 → v21 (unlocks ngx-toastr v20, NGXS v21, ng-bootstrap v20) | ✓ Complete |
| P9 | Remove zombie devDependencies (`wait-on`, `webdriver-manager`) — clears 11 audit findings | ✓ Complete |
| P10 | Migrate to the new esbuild build system (`use-application-builder`) | ✓ Complete |
| P11 | Convert remaining NgModules to standalone providers (`provideStore()`, `provideFormlyConfig()`, etc.) | ✓ Complete |

### P1 — Remove zombie dependencies

Packages in `package.json` with no `import` anywhere in `src/`:

- `popper.js` v1 — Bootstrap 4 era; Bootstrap 5 uses `@popperjs/core` v2 (already present)
- `request` — deprecated Node HTTP library; not imported in any source file
- `resumablejs` — not imported in any source file
- `pusher-js` — not imported in any source file
- `xterm` — not imported in any source file

Steps: `npm uninstall <packages>` then verify build + tests pass.

### P2 — Minor version bumps (safe)

Bump these together — no breaking changes expected:

```
@auth0/angular-jwt          5.0.1  → 5.2.0
@types/googlemaps           3.39   → 3.43
@types/jasminewd2           2.0.8  → 2.0.13
@types/node                 14     → 18  (avoid v20+ until other deps catch up)
@microsoft/applicationinsights-web  2  → 3
core-js                     3.20   → 3.49
prismjs                     1.20   → 1.30
ts-node                     8      → 10
```

### P3 — Auth0: `@auth0/auth0-spa-js` v1 → `@auth0/auth0-angular` v2

`@auth0/auth0-angular` is the first-party Angular SDK that supersedes the hand-rolled
`authentication.service.ts`. It handles token refresh, HTTP interceptors, and route guards
out of the box.

Key files:
- `src/app/shared/services/authentication.service.ts` — replace entirely with `AuthService` from `@auth0/auth0-angular`
- `src/app/graphql.module.ts` — update `asyncAuthLink` to use the new `AuthService.getAccessTokenSilently$()`
- `src/app/app.module.ts` — add `AuthModule.forRoot({ domain, clientId, ... })`
- Remove private deep import: `@auth0/auth0-spa-js/dist/typings/Auth0Client`

Watch for: `auth0-spa-js` v1 used `client_id`; v2 / auth0-angular uses `clientId` (camelCase).

### P4 — Apollo: `apollo-angular` v5 → v13 + `@apollo/client` v3 → v4

Apollo Angular adopted Angular's version numbering (so v13 = Angular 20 compatible).
`@apollo/client` v4 is a native ESM rewrite — smaller bundle, no `__DEV__` global.

Key changes:
- `APOLLO_OPTIONS` factory pattern in `graphql.module.ts` still works in v13
- `canonizeResults: false` workaround in `InMemoryCache` may no longer be needed (v4 changed freeze behaviour)
- Install: `npm install apollo-angular@13 @apollo/client@4`

### P5 — Replace `moment` with `date-fns`

`moment` is in maintenance-only mode and adds ~67 KB to the bundle (CommonJS, no tree-shaking).
`date-fns` is tree-shakeable and covers all the same use cases.

Files using moment:
- `src/app/shared/modules/formly/components/date.component.ts`
- `src/app/shared/modules/formly/components/datetime.component.ts`
- `src/app/shared/utils/date_utils.ts`
- `src/app/shared/utils/hash_utils.ts`

### P6 — CKEditor 4 removal

CKEditor 4 reaches end-of-life **June 2026**. It's used in exactly one field: the `content`
field in `post-info.component.ts`.

Decision point before implementing:
- If post content is rendered as HTML elsewhere in the app → replace with `ngx-quill` (Quill.js),
  a lightweight WYSIWYG (~180 KB gzipped) with a simple Angular wrapper
- If post content is admin-only / never rendered as HTML → change `type: 'richtext'` to
  `type: 'textarea'` and remove `ckeditor4-angular`, `@ckeditor/ckeditor5-editor-inline`,
  `richtext.component.ts`, and the `CKEditorModule` import from `AppFormModule`

Files to change:
- `src/app/shared/modules/formly/components/richtext.component.ts` — replace or delete
- `src/app/shared/modules/formly/index.ts` — remove `richtext` type registration and `CKEditorModule`
- `src/app/views/corewidgets/components/post-info/post-info.component.ts:130` — change type

### P7 — Standalone component migration

Use the official Angular schematic:
```bash
ng generate @angular/core:standalone
```
Run in three passes as the schematic recommends:
1. Convert all components/directives/pipes to standalone
2. Remove unnecessary NgModules
3. Bootstrap with `bootstrapApplication()`

~40 NgModule-based components across `src/app/views/corewidgets/`.

### P8 — Angular v20 → v21

Once P7 is done, upgrade Angular itself. This unlocks:
- `ngx-toastr` v20 (requires Angular ^21)
- `@ngxs/store` v21
- `@ng-bootstrap/ng-bootstrap` v20

Follow the standard `ng update @angular/core @angular/cli` migration path.

### P9 — Remove zombie devDependencies

`wait-on` and `webdriver-manager` are listed in `devDependencies` but not used anywhere in `e2e/`
or `playwright.config.ts`. They are the source of 11 of the 17 `npm audit` findings:

- `webdriver-manager@12` → pulls in `request` (SSRF criticals), `jsprim`, `json-schema`, `form-data`
- `wait-on@5` → pulls in `axios` (SSRF/CSRF criticals), `follow-redirects`

Steps: `npm uninstall wait-on webdriver-manager` then verify build + tests pass.

### P10 — Migrate to the new esbuild build system

During the Angular 21 upgrade, the CLI flagged an optional migration:
```bash
ng update @angular/cli --name use-application-builder
```
This switches from the legacy webpack builder (`@angular-devkit/build-angular:browser`) to the
new esbuild/Vite-based builder (`@angular/build:application`). Expected outcome: production builds
drop from ~50 s to under 10 s; `ng serve` rebuilds become near-instant.

Key changes the migration makes:
- Updates `angular.json` builder targets from `browser` → `application`
- Switches dev server from `dev-server` → `application-dev-server`
- Removes webpack-specific options (none are used in this project — clean migration expected)

Run `ng update @angular/cli --name use-application-builder`, then verify build + tests pass.

### P11 — Convert remaining NgModules to standalone providers

The standalone component migration (P7) left these NgModule files intact because they contain
`forRoot()` provider configuration that cannot be auto-migrated:

| File | Current pattern | Target pattern |
|---|---|---|
| `src/app/state/state.module.ts` | `NgxsModule.forRoot([UserState])` | `provideStore([UserState])` + `withNgxsRouterPlugin()` etc. |
| `src/app/shared/modules/formly/index.ts` | `FormlyModule.forRoot(config)` | `provideFormlyConfig(config)` |
| `src/app/graphql.module.ts` | `@NgModule` with `APOLLO_OPTIONS` provider | `provideApollo(...)` factory |
| `src/app/app.routing.module.ts` | `RouterModule.forRoot(routes)` | `provideRouter(routes, ...)` |
| `src/app/shared/index.ts` | `AppSharedModule` with service providers | inline `providers: []` in `main.ts` |
| `src/app/shared/modules/auth/index.ts` | empty shell NgModule | delete |

Once all providers are inlined into `bootstrapApplication(AppComponent, appConfig)` in
`src/main.ts`, the remaining NgModule files can be deleted and `CoreWidgetsModule` can be
replaced with a plain route array.
