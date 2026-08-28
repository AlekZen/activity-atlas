# Changelog

All notable changes to Activity Atlas are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-08-28

### Fixed

- Use Obsidian's dedicated `createSpan` helper for empty-state details.

## [0.1.1] - 2026-08-28

### Changed

- Adopted Obsidian 1.13 declarative settings so every option is searchable and uses the current settings API.
- Raised the minimum Obsidian version to 1.13.0 to match the APIs used by the plugin.
- Added GitHub artifact attestations for release assets.

### Fixed

- Normalized read-only Git command failures to proper `Error` rejections.

## [0.1.0] - 2026-08-28

### Added

- Live tracking for create, modify, rename, and delete operations across the vault.
- Startup reconciliation for changes made while Obsidian was closed.
- Burst-based activity timeline with path, day, operation, extension, and Git-state filters.
- Six-week activity calendar with complete keyboard navigation and focus restoration.
- Optional read-only Git status and latest-commit overlay for desktop Obsidian.
- Bounded compressed baseline and activity-log retention.
- Multi-instance writer-lock coordination and stale-lock takeover.
- Light-theme, dark-theme, narrow-pane, and Obsidian mobile-emulation layouts.
- Local-only operation with no network requests or telemetry.

### Changed

- Reworked the upstream Vault Change Feed foundation into the Activity Atlas product and storage contract.
- Declared the initial Community release desktop-only because the Git overlay uses Node.js process APIs.

[0.1.0]: https://github.com/AlekZen/activity-atlas/releases/tag/0.1.0
[0.1.1]: https://github.com/AlekZen/activity-atlas/releases/tag/0.1.1
[0.1.2]: https://github.com/AlekZen/activity-atlas/releases/tag/0.1.2
