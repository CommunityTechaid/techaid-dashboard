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
| GraphQL client | Apollo Angular v3 (`@apollo/client@3`) | `src/app/graphql.module.ts` |
| State management | NGXS 3.x | `src/app/state/` |
| UI components | ng-bootstrap v19 + Bootstrap 5 | throughout |
| Dynamic forms | ngx-formly v7 (8 custom field types) | `src/app/shared/modules/formly/` |
| Auth | Auth0 SPA SDK | `src/app/shared/services/authentication.service.ts` |
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
| L5 | All remaining secondary libraries (moment, ngx-toastr, etc.) | **Next** |

### L3 — NGXS v3 → v20

NGXS adopted Angular's version numbering from v18 onward (v3 was the last "classic" release).
Target: `@ngxs/store@20.1.0` plus matching versions of all four plugins.

Packages to upgrade together:
```
@ngxs/store  @ngxs/form-plugin  @ngxs/router-plugin
@ngxs/devtools-plugin  @ngxs/logger-plugin
```

Key breaking changes to look for:
- `@State` decorator options changed — `children` array moved inside the decorator
- `NgxsModule.forRoot()` options signature updated (`developmentMode`, `selectorOptions`)
- `StateContext` generic type constraints tightened
- Action handler return types — `void` now allowed; `Observable` still preferred
- `@ngxs/form-plugin`: `UpdateFormDirty` / `UpdateFormValue` action shapes may have changed
- Key files: `src/app/state/`, `src/app/state/state.module.ts`

### L4 — Bootstrap v4 → v5 + @ngx-formly v6 → v7

Must be done together — `@ngx-formly/bootstrap@7` requires `bootstrap@^5`.

Bootstrap 5 breaking changes affecting this codebase:
- `data-*` attributes renamed to `data-bs-*` (dropdowns, modals, tooltips)
- `.form-group` wrapper removed — use spacing utilities instead
- `.custom-select`, `.custom-checkbox` etc. renamed to `.form-select`, `.form-check`
- `float-*` utilities renamed to `float-start` / `float-end`
- jQuery no longer required or included

formly v7 breaking changes:
- `FormlyModule.forRoot()` replaced by standalone `provideFormly()` (or keep NgModule pattern with updated import)
- `templateOptions` object renamed to `props`
- Custom field types: `FieldType` base class import path changed

### L5 — Secondary libraries

Check and update after L4 passes:
- `moment` → consider replacing with date-fns or Angular's built-in date pipe
- `ngx-toastr` — verify compatible version for Angular 20
- `ngx-filesaver` — verify peer deps
- `datatables.net` + `angular-datatables` — check Angular 20 compatibility

### Before Merging to Main

Delete everything from the `<!-- UPGRADE IN PROGRESS -->` marker to the end of this file.
