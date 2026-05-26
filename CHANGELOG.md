# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`master` tracks the latest state deployed to production. A new versioned
section is cut from `[Unreleased]` each time `master` advances after a
successful production deploy (see "Release Workflow" in `CLAUDE.md`).

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
