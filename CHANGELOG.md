# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`master` tracks the latest state deployed to production. A new versioned
section is cut from `[Unreleased]` each time `master` advances after a
successful production deploy (see "Release Workflow" in `CLAUDE.md`).

## [1.1.0](https://github.com/CommunityTechaid/techaid-dashboard/compare/v1.0.28...v1.1.0) (2026-07-07)


### Features

* add notes section to referee details ([#65](https://github.com/CommunityTechaid/techaid-dashboard/issues/65)) ([2e4c175](https://github.com/CommunityTechaid/techaid-dashboard/commit/2e4c175daa2b561ef904dca94ed77a8e2c6e328d))
* exclude statuses in device filter ([#64](https://github.com/CommunityTechaid/techaid-dashboard/issues/64)) ([4b550e8](https://github.com/CommunityTechaid/techaid-dashboard/commit/4b550e88eadd96124c70bb33e31e772b89f18062))


### Bug Fixes

* add CSP and security headers (digital-hygiene batch 2) ([#90](https://github.com/CommunityTechaid/techaid-dashboard/issues/90)) ([995fc92](https://github.com/CommunityTechaid/techaid-dashboard/commit/995fc92c4ed3a6438991cdc2edcc43e35a79c698))
* allow operators to clear a collection/delivery booking on device requests ([#42](https://github.com/CommunityTechaid/techaid-dashboard/issues/42)) ([1a6e753](https://github.com/CommunityTechaid/techaid-dashboard/commit/1a6e75396ccbff031100c2e8f591a90c9e2b4667))
* Assign Roles modal typeahead was broken — duplicate $term variable (hygiene 5.6 spec) ([#107](https://github.com/CommunityTechaid/techaid-dashboard/issues/107)) ([d69743f](https://github.com/CommunityTechaid/techaid-dashboard/commit/d69743f2f1fcaed0ed63a41e801173814619f5b2))
* convert formly string expressions to CSP-safe functions ([#92](https://github.com/CommunityTechaid/techaid-dashboard/issues/92)) ([73ba160](https://github.com/CommunityTechaid/techaid-dashboard/commit/73ba16067d1c642e9516b9b66c015e075594153f))
* keep submit buttons clickable and explain invalid forms via toast (hygiene 3.2) ([#97](https://github.com/CommunityTechaid/techaid-dashboard/issues/97)) ([26620c4](https://github.com/CommunityTechaid/techaid-dashboard/commit/26620c4f48f445a8af8aaa91075f515183de4d71))
* move clear-date button inline with field and auto-save on click ([#42](https://github.com/CommunityTechaid/techaid-dashboard/issues/42)) ([fe3629f](https://github.com/CommunityTechaid/techaid-dashboard/commit/fe3629ff5d01badba21ed8862562a7b6e3947dc2))
* redirect to login on expired session instead of Access Denied popup ([#78](https://github.com/CommunityTechaid/techaid-dashboard/issues/78)) ([6464f7d](https://github.com/CommunityTechaid/techaid-dashboard/commit/6464f7d71baf433469cd4739b97a9505ea6f6a31))
* refresh Devices-tab count after assigning devices (hygiene 5.3 lifecycle spec) ([#105](https://github.com/CommunityTechaid/techaid-dashboard/issues/105)) ([a70b0ef](https://github.com/CommunityTechaid/techaid-dashboard/commit/a70b0ef56d0bba8623e7190f328b49b347da3d16))
* resolve UAT CSP soak findings (digital-hygiene batch 2 follow-up) ([#91](https://github.com/CommunityTechaid/techaid-dashboard/issues/91)) ([6eeb866](https://github.com/CommunityTechaid/techaid-dashboard/commit/6eeb866eb45ae015e68972bb1a54f87b5074f85c))
* security & dependency patch (digital-hygiene batch 1) ([#89](https://github.com/CommunityTechaid/techaid-dashboard/issues/89)) ([d61c68e](https://github.com/CommunityTechaid/techaid-dashboard/commit/d61c68e20ee456911fc6b42b89308158a63a7250))
* show System for automated audit revisions ([#56](https://github.com/CommunityTechaid/techaid-dashboard/issues/56)) ([cf99dd8](https://github.com/CommunityTechaid/techaid-dashboard/commit/cf99dd8c9944362bd4f29c3eb20b253f2ca367e8))
* stop formly scrubbing conditional device fields on type toggle (hygiene 3.1) ([#96](https://github.com/CommunityTechaid/techaid-dashboard/issues/96)) ([e2f9fce](https://github.com/CommunityTechaid/techaid-dashboard/commit/e2f9fcee14fc0fbc53e6ddbae8d86327ec1d2db6))
* surface lookup failures, config-drive PDF URL, unify dates and delete confirms (hygiene 3.4) ([#98](https://github.com/CommunityTechaid/techaid-dashboard/issues/98)) ([5a2b203](https://github.com/CommunityTechaid/techaid-dashboard/commit/5a2b20350e976a7580dc8e9211b0da7f53385c7c))


### Performance Improvements

* bundle budgets + minified UAT builds (hygiene 6.1) ([#110](https://github.com/CommunityTechaid/techaid-dashboard/issues/110)) ([23406af](https://github.com/CommunityTechaid/techaid-dashboard/commit/23406af4dda6e31c3534ed0dc3389de05b4fbc45))
* OnPush change-detection pilot on donor-index (hygiene 6.5) ([#111](https://github.com/CommunityTechaid/techaid-dashboard/issues/111)) ([d24f864](https://github.com/CommunityTechaid/techaid-dashboard/commit/d24f864e14d425524d0c69b43df029b4e7d1e225))
* route-level code splitting via loadComponent (hygiene 6.2) ([#109](https://github.com/CommunityTechaid/techaid-dashboard/issues/109)) ([016b941](https://github.com/CommunityTechaid/techaid-dashboard/commit/016b941732056b3d09a46406d222a5d004aa70ab))

## [1.0.28](https://github.com/CommunityTechaid/techaid-dashboard/compare/v1.0.27...v1.0.28) (2026-06-01)


### Bug Fixes

* clone Apollo response nested objects in device-request-info ([#71](https://github.com/CommunityTechaid/techaid-dashboard/issues/71)) ([8ca276b](https://github.com/CommunityTechaid/techaid-dashboard/commit/8ca276b1fafe3cfe47c7b605481e7c5c5021906f))
* guard user/role detail tabs against null nested relationships ([#75](https://github.com/CommunityTechaid/techaid-dashboard/issues/75)) ([2f6a0d7](https://github.com/CommunityTechaid/techaid-dashboard/commit/2f6a0d7350660063707be521ef42641400c7ba17))
* replace Apollo v4 response mutations in reports and user-permissions ([#39](https://github.com/CommunityTechaid/techaid-dashboard/issues/39)) ([#69](https://github.com/CommunityTechaid/techaid-dashboard/issues/69)) ([89a441e](https://github.com/CommunityTechaid/techaid-dashboard/commit/89a441e8c013466a4f3c423317ce5c2d71fadc3a))
* send pagination sort direction as String in user tables ([#72](https://github.com/CommunityTechaid/techaid-dashboard/issues/72)) ([#73](https://github.com/CommunityTechaid/techaid-dashboard/issues/73)) ([aa22a14](https://github.com/CommunityTechaid/techaid-dashboard/commit/aa22a14118b54d9f89ba150cc4890e22819da3c2))
* truncate long GraphQL error toasts in device-request-info ([#38](https://github.com/CommunityTechaid/techaid-dashboard/issues/38)) ([#66](https://github.com/CommunityTechaid/techaid-dashboard/issues/66)) ([9e6085c](https://github.com/CommunityTechaid/techaid-dashboard/commit/9e6085c5fccdbf6f3336302abbf967330adf3eb8))

## [Unreleased]

### Added
- Issue Triage Workflow documented in `CLAUDE.md` for automated bug-issue handling
- E2E regression test `DEVREQ-B1` for device-type toggle Formly flush
- E2E regression tests for the May bug batch
- Week-button calendar on D&D now shows current week + 3 upcoming

### Changed
- Sweep edit forms to use the same required-field feedback pattern as kit-info
- Production SWA deploy is now triggered manually and built from `dev`
- Loading bar and spinner recoloured from amber to sidebar blue
- Age column hidden from device tables
- Inline-critical CSS optimisation disabled in production build
- D&D week filter now shows all statuses

### Fixed
- kit-info surfaces required-field feedback when Save clicked on an invalid form
- Public device-request form: silent submit failure when 3-request limit hit; error toast cleanup
- Numeric inline-edit values coerced to `Int` before save
- kit-info: untick stays disabled and Save sends `type=null` (#48)
- kit-status radio buttons: missing left padding (#45)
- `subStatus` flags no longer scrubbed on hide-state transitions
- Startup interstitial delayed by 1s grace window to avoid flicker
- kit form render deferred until kit data has loaded; patched after load so stored flags survive Formly's stale controls
- Nested kit fields deep-copied so Formly can write defaults
- Show/hide toggle preserves `id` through safeHtml sanitisation
- Three latent `hideExpression` bugs found in the sweep
- `hideExpression` toggles that never flushed
- Find Email: not-found prompt now appears for unknown emails
- Four bugs fixed in the public device-request form
- Swapped totals in the device-request filter info label
- Devices/requests not loading inside related records
- UAT website bug XMAB-B (#46)

[Unreleased]: https://github.com/CommunityTechaid/techaid-dashboard/compare/master...dev
