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
| GraphQL client | Apollo Angular v1 (`apollo-client@2`) | `src/app/graphql.module.ts` |
| State management | NGXS 3.x | `src/app/state/` |
| UI components | ng-bootstrap v7 + Bootstrap 4 | throughout |
| Dynamic forms | ngx-formly v5 (8 custom field types) | `src/app/shared/modules/formly/` |
| Auth | Auth0 SPA SDK | `src/app/shared/services/authentication.service.ts` |
| Feature components | 36 components | `src/app/views/corewidgets/components/` |
| Shared services | 3 services | `src/app/shared/services/` |

Environment configs live in `src/environments/` (dev, prod, uat, local).

## Testing

There is no test suite. `ng build --configuration production` is the primary signal for regressions — if it compiles cleanly, the code is structurally sound.

---

<!-- UPGRADE IN PROGRESS — DELETE EVERYTHING BELOW THIS LINE BEFORE MERGING TO MAIN -->

## Angular Upgrade: v11 → v20

### Context

Starting version: **Angular 11.2.14** (released Nov 2020, EOL May 2022 — unsupported).
Target: **Angular 20** (oldest currently supported version as of April 2026).

Angular enforces sequential major-version upgrades — you cannot skip versions. At each step:

```bash
ng update @angular/core@X @angular/cli@X
ng build --configuration production   # must pass before continuing
git commit
```

### Checkpoint Strategy

| Checkpoint | Range | Primary goal |
|---|---|---|
| 1 | v11 → v14 | Land on RxJS 7, TypeScript 4.x mid-range |
| 2 | v14 → v16 | TypeScript 5 prep, Signals introduced |
| 3 | v16 → v18 | **Migrate Apollo** to `@apollo/client` v3 |
| 4 | v18 → v20 | Finalise; optional standalone components / new control flow |

### Current Checkpoint

[UPDATE THIS AS YOU PROGRESS — e.g. "Completed checkpoint 1, on Angular 14"]

### Known Hard Problems

Work through these in order — earlier checkpoints are mostly mechanical, Checkpoint 3 is where the real effort is.

**1. Apollo GraphQL (Checkpoint 3 — biggest effort)**
- Currently: `apollo-angular@1` + `apollo-client@2` (old split-package model with `apollo-link-*`)
- Target: `apollo-angular@3+` + `@apollo/client@3` (unified package, completely different API)
- Affects: `src/app/graphql.module.ts` and all 36 components in `src/app/views/corewidgets/components/`
- The `apollo-link-context` JWT injection pattern needs rewriting using `@apollo/client` links

**2. RxJS 6 → 7 (Checkpoint 1, Angular 14 forces this)**
- `toPromise()` deprecated → use `firstValueFrom()` / `lastValueFrom()`
- Some operator renames and import path changes
- Start with `rxjs-tslint` migration tool, then review manually

**3. ng-bootstrap v7 → v17+ (tracks Angular major version)**
- Modal, datepicker, and dropdown APIs have evolved across 10 major versions
- Review all components using `NgbModal`, `NgbDatepicker`, `NgbDropdown`

**4. NGXS 3.7 → 4.x**
- Breaking changes to state decorators and action patterns
- Key files: `src/app/state/user/`, `src/app/state/state.module.ts`

**5. @ngx-formly 5 → 6+**
- `FormlyModule` import API and field configuration changed
- Key files: `src/app/shared/modules/formly/` (8 custom field components)

**6. TypeScript 4.1 → 5.x**
- Stricter template type checking will surface latent type errors — fix as you go
- Update `tsconfig.json` targets accordingly at each checkpoint

**7. Node.js version**
- Angular 20 requires Node 18.19+
- Verify with `node --version` before starting — upgrade Node if needed

### Before Merging to Main

Delete everything from the `<!-- UPGRADE IN PROGRESS -->` marker to the end of this file.
