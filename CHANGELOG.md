# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`master` tracks the latest state deployed to production. A new versioned
section is cut from `[Unreleased]` each time `master` advances after a
successful production deploy (see "Release Workflow" in `CLAUDE.md`).

## [1.3.2](https://github.com/CommunityTechaid/techaid-dashboard/compare/v1.3.1...v1.3.2) (2026-07-22)


### Bug Fixes

* stop the landing page firing findAll before a token exists ([#153](https://github.com/CommunityTechaid/techaid-dashboard/issues/153)) ([590c630](https://github.com/CommunityTechaid/techaid-dashboard/commit/590c630aa476b69b4913cd4a305e15e63b7a296e))

## [1.3.1](https://github.com/CommunityTechaid/techaid-dashboard/compare/v1.3.0...v1.3.1) (2026-07-21)


### Bug Fixes

* DEVREQ-B1 toggle crash + device-intake search-index flake ([#150](https://github.com/CommunityTechaid/techaid-dashboard/issues/150)) ([dde9856](https://github.com/CommunityTechaid/techaid-dashboard/commit/dde985615ce88c7543275460043ef92faf0211da))
* **e2e:** drop inferrable type annotation on sampleEmail domain param ([#149](https://github.com/CommunityTechaid/techaid-dashboard/issues/149)) ([08923a3](https://github.com/CommunityTechaid/techaid-dashboard/commit/08923a3da39e9f2daa33814b5f185c5c48a1b8e6))
* **e2e:** force the index search to re-run when retrying after create ([#152](https://github.com/CommunityTechaid/techaid-dashboard/issues/152)) ([b62e7cd](https://github.com/CommunityTechaid/techaid-dashboard/commit/b62e7cdfcd5b6025672d0062f2b18ecdfb561b55))

## [1.3.0](https://github.com/CommunityTechaid/techaid-dashboard/compare/v1.2.0...v1.3.0) (2026-07-21)


### Features

* bench Update Scanner for scan-driven device status updates ([#145](https://github.com/CommunityTechaid/techaid-dashboard/issues/145)) ([ffcb7c4](https://github.com/CommunityTechaid/techaid-dashboard/commit/ffcb7c460a1897a2aacc9cfad05fd64aaceac672))


### Bug Fixes

* **e2e:** generate valid referee emails for device-request fixtures ([#147](https://github.com/CommunityTechaid/techaid-dashboard/issues/147)) ([0c497b9](https://github.com/CommunityTechaid/techaid-dashboard/commit/0c497b97a88bef6314d1268e82d7a02582f5d660))

## [1.2.0](https://github.com/CommunityTechaid/techaid-dashboard/compare/v1.1.0...v1.2.0) (2026-07-21)


### Features

* admin delete button for delivery bookings ([0487b1f](https://github.com/CommunityTechaid/techaid-dashboard/commit/0487b1fbb0358a8dc43ac615e9f9ddacd0646395))
* admin delete button for delivery bookings ([c9ad0a2](https://github.com/CommunityTechaid/techaid-dashboard/commit/c9ad0a2b0500e7306e3c505d0cbaa89600b11f61))
* Feature Flags as an Admin Panel tab + preserve delivery-booking design refs ([#127](https://github.com/CommunityTechaid/techaid-dashboard/issues/127)) ([d60f82e](https://github.com/CommunityTechaid/techaid-dashboard/commit/d60f82e26bcb6cc36358a539515c2b30abe08196))
* feature-flag gating, delivery-slots admin tab, UAT banner & clean public link ([#126](https://github.com/CommunityTechaid/techaid-dashboard/issues/126)) ([8c1ad5d](https://github.com/CommunityTechaid/techaid-dashboard/commit/8c1ad5d96d95441e63a6eae98e1d01f090023bcb))
* host public device-delivery booking page ([#124](https://github.com/CommunityTechaid/techaid-dashboard/issues/124)) ([31d5bba](https://github.com/CommunityTechaid/techaid-dashboard/commit/31d5bba44c286fcf9c62b14378dcac829df3f1f2))
* loading spinner + retry on delivery-booking availability ([a5aa9cb](https://github.com/CommunityTechaid/techaid-dashboard/commit/a5aa9cb6aba1ed722f1a368e25a77bbc4604449f))
* loading spinner + retry on delivery-booking availability ([#130](https://github.com/CommunityTechaid/techaid-dashboard/issues/130)) ([8dcee83](https://github.com/CommunityTechaid/techaid-dashboard/commit/8dcee8383e24462812174dda981d2e1e8706b43b))
* Places autocomplete on the delivery booking address ([7b29f8b](https://github.com/CommunityTechaid/techaid-dashboard/commit/7b29f8b38fd327296284c1991991f69e4720668a))
* Places autocomplete on the delivery booking address ([1916469](https://github.com/CommunityTechaid/techaid-dashboard/commit/19164697f01f27898ebf9e3cb88fd47e64dbf474))
* promote Delivery Booking to a top-level "(Public-facing)" header link ([#128](https://github.com/CommunityTechaid/techaid-dashboard/issues/128)) ([e134f28](https://github.com/CommunityTechaid/techaid-dashboard/commit/e134f28ceee1cfdfdb3b9a66aa529b0e0ae6224e))
* scan-driven device prep mode prototype (behind feature flag) ([#143](https://github.com/CommunityTechaid/techaid-dashboard/issues/143)) ([e966446](https://github.com/CommunityTechaid/techaid-dashboard/commit/e966446b3f4fd89cb8f2f8a61a683d48e016e6f3))
* search devices by a pasted list of CTA IDs and guard bulk updates ([#144](https://github.com/CommunityTechaid/techaid-dashboard/issues/144)) ([69cb221](https://github.com/CommunityTechaid/techaid-dashboard/commit/69cb22179e1975b6fd06a4a3494ff2a287703edf))
* set production Turnstile site key ([21f5760](https://github.com/CommunityTechaid/techaid-dashboard/commit/21f57603346fa62a525afeb49983ef38d082bf9f))
* set production Turnstile site key ([1e10074](https://github.com/CommunityTechaid/techaid-dashboard/commit/1e100749e905eb3847d0af6d7f25f87be9059343))
* Turnstile widget on the delivery booking form ([96dcf73](https://github.com/CommunityTechaid/techaid-dashboard/commit/96dcf73a31346b363cc58710fc130260f972c680))
* Turnstile widget on the delivery booking form ([e305675](https://github.com/CommunityTechaid/techaid-dashboard/commit/e305675c771cebbb98e22fd8c48e05e1c96b4a56))
* unmatched CTA reference badge on Delivery Slots ([2793009](https://github.com/CommunityTechaid/techaid-dashboard/commit/27930098d5af346271782f72fedf3cc85095a35d))
* unmatched CTA reference badge on Delivery Slots ([02f3264](https://github.com/CommunityTechaid/techaid-dashboard/commit/02f326402e04f6cb4438133bf2f00b0e6cc63ba3))


### Bug Fixes

* surface real booking errors for expected failures ([7d169af](https://github.com/CommunityTechaid/techaid-dashboard/commit/7d169af64b6e18ec93ca294d65cabf915181466e))
* surface real booking errors for expected failures ([1dfdf1d](https://github.com/CommunityTechaid/techaid-dashboard/commit/1dfdf1d13e8aa5a8853c11d0ff59251604ef0d2d))

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
