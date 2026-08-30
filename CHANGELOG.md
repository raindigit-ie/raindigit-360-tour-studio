# Changelog

All notable Studio changes are recorded here. Versions follow Semantic Versioning.

## [0.2.9] — 2026-08-30

### Fixed

- Makes the production-only monitoring runtime a new explicit Studio/tour
  capability (`0.2.9` / runtime `2.0.9`) so every active package must be
  regenerated from the canonical template before it can be selected.
- Rejects legacy or AWS-labelled physical-device summaries when deciding
  whether a historic PROD selection can remain accepted. Only a complete v2
  physical iPhone Safari record for the exact release set can authorize a
  promotion.

### Migration

- Every active tour must be runtime-revised, immutable-uploaded, graph-tested
  twice and physically accepted on iPhone Safari before PROD promotion. The
  previous `0.2.8` selection remains rollback-only evidence.

## [0.2.8] — 2026-08-27

### Added

- Adds a dedicated production error boundary for immutable tour packages.
- Loads the pinned Sentry browser adapter only after an eligible terminal
  runtime failure; healthy loads and individual tile retries make no Sentry
  request.
- Separates the tour runtime project from site monitoring while tagging the
  exact tour, runtime, Studio, package and sanitized embed hostname.

### Safety and quota controls

- Requires an exact HTTPS production-origin allowlist embedded at build time;
  localhost, Pages previews, R2 DEV URLs and unknown customer hosts remain
  inert even when a public DSN is present.
- Disables default integrations, sessions, traces, logs, breadcrumbs and PII,
  removes URL queries/fragments and bounds both the queue and deduplication
  state.
- Treats only exhausted bootstrap, scene-transition and WebGL recovery plus
  uncaught errors and unhandled rejections as reportable. Tile-level failures
  remain local recovery signals.

### Migration

- This is a runtime capability change from `2.0.7` to `2.0.8`; every active
  tour must be rebuilt or runtime-revised, verified on DEV and a physical
  iPhone, then promoted by immutable digest. Existing 0.2.7 attestations are
  intentionally invalid until that fleet migration is complete.

## [0.2.5] — 2026-08-27

### Fixed

- Keeps the RainDigit brand and persistent tour controls visible above the
  animated guard while walking between scenes.
- Retains full-viewport ownership for the initial cold-start guard while the
  post-readiness guard masks only the panorama, renderer and hotspots.

### Verification

- Asserts computed stacking, hit targets and unchanged control geometry during
  real scene changes in Chromium and mobile WebKit at portrait and landscape
  target sizes.
- Requires every active tour to be rebuilt because this changes the public
  runtime capability from `2.0.4` to `2.0.5` and Studio/tour capability from
  `0.2.4` to `0.2.5`.

## [0.2.4] — 2026-08-27

### Fixed

- Treats a real WebGL context loss as a document-level renderer failure instead of repeatedly asking the already-lost Pannellum renderer to reload the same scene.
- Keeps the neutral opaque guard visible while a bounded automatic reload restores the exact scene, pitch, yaw and field of view.
- Clears the recovery marker only after stable compositor readiness and falls back to an explicit reload control rather than entering an infinite reload loop.

### Verification

- Exercises `WEBGL_lose_context` in mobile WebKit and requires recovery to the same requested scene/view without an uncovered intermediate frame or duplicate controls.
- Requires all active tours to be rebuilt because this changes the public runtime capability from `2.0.3` to `2.0.4` and Studio/tour capability from `0.2.3` to `0.2.4`.

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
