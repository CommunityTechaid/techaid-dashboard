# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`master` tracks the latest state deployed to production. A new versioned
section is cut from `[Unreleased]` each time `master` advances after a
successful production deploy (see "Release Workflow" in `CLAUDE.md`).

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
