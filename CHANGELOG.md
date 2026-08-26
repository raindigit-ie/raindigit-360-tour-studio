# Changelog

All notable Studio changes are recorded here. Versions follow Semantic Versioning.

## [0.2.3] — 2026-08-26

### Improved

- Starts all four content-versioned viewer runtime requests in parallel while preserving their deterministic execution order.
- Defers low-priority room-navigator thumbnails so they no longer compete with the requested panorama's first multires tiles.
- Adds a parent/iframe readiness handshake so an embed can recover a readiness message that arrived before its application listener.

### Verification

- Adds cold-load timing for direct packages and story embeds in desktop Chromium and mobile WebKit.
- Keeps the opaque requested-scene compositor and tile-health gates unchanged; performance work may not shorten first-frame safety.

## [0.2.2] — 2026-08-25

### Fixed

- Added target-scene tile health to the opaque-frame readiness contract instead of trusting Pannellum `isLoaded()` after failed multires requests.
- Kept the neutral guard opaque when any target tile fails or remains pending.
- Added bounded same-scene retries with backoff so a temporary tile outage recovers without revealing a stale, black or partial frame.

### Verification

- Added published DEV fault injection for every saved tour in real desktop Chrome and mobile WebKit.
- Recovery evidence uses real hotspot pointer input, 50 ms frame timelines and exact target-scene assertions.

## [0.2.1] — 2026-08-25

### Fixed

- Replaced the divergent desktop and mobile scene-transition runtimes with one opaque first-frame guard.
- Kept the guard above the Pannellum canvas until the requested scene, mounted canvas and compositor-settle contract all agree.
- Prevented black frames, partial multires tiles and stale source scenes from becoming visible during direct entry or hotspot navigation.

### Verification

- Added real desktop Chrome and mobile WebKit frame-sequence gates for direct scene URLs and scene changes.
- A physical iPhone Safari acceptance remains mandatory before this capability version can be promoted to production.

## [0.2.0] — 2026-08-23

### Added

- Five-axis release identity: Studio, portable format, viewer runtime, named tour and immutable package versions.
- Human and machine-readable changelogs inside every optimized tour package.
- Explicit package capability and verification profiles.
- Independent DEV channel selectors and exact-digest promotion metadata.
- Self-contained-package validation for runtime, styles, configuration, thumbnails and panorama media.

### Fixed

- Restored the Gold Pulse scene-transition stylesheet in generated releases.
- Preserved every saved hotspot arrival pitch, yaw and field of view.
- Made legacy-runtime normalization idempotent so an existing first-frame readiness guard cannot lose its `is-tour-ready` signal.
- Removed iPhone runtime dependencies on retained WebGL buffers, Resource Timing visibility and off-screen animation frames.

### Migration

- Existing `raindigit-tour-multires-release/v1` packages must be normalized to the v2 portable contract before they can be selected by a new DEV or PROD channel.
- Thin packages with `mediaDependency` are no longer release-compatible.

## [0.1.1] — 2026-08-21

- Established generated-release readiness and cross-origin embed checks.
