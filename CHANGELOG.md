# Changelog

All notable Studio changes are recorded here. Versions follow Semantic Versioning.

## [0.3.6] — 2026-08-31

### Fixed

- Isolates authored person-navigation hotspots above Pannellum utility layers so
  the icon remains visible and the intended hotspot owns its touch target.
- Hides empty interaction/info panels after readiness, preventing a transparent
  or black 200×150 overlay from intercepting the centre of the panorama.
- Uses one canonical public-runtime inventory for both full builds and
  runtime-only revisions, including Pannellum CSS and tour chrome.

### Verification

- Adds computed visible-layer and real-click transition coverage for every
  active tour, plus exact public-runtime parity checks.

### Migration

- Advances Studio/tour capability to `0.3.6` and runtime to `3.0.6`; all three
  active DEV tours require new immutable packages. The accepted 0.3.5 set
  remains an immutable rollback and must not be relabelled.

## [0.3.5] — 2026-08-30

### Fixed

- Replaces speculative runtime preloads with one ordered set of parallel
  dynamically inserted scripts. This prevents mobile WebKit from leaving all
  five runtime requests pending while preserving deterministic execution order.
- Makes every portable entry document scene-neutral before runtime validation:
  the static first-frame element has no scene-specific `src`, and the opaque
  loader remains the only visible first paint until the requested scene is known.

### Verification

- Extends the package gate to reject a scene-specific static first frame and
  any duplicate preload path in the public bootstrap.

### Migration

- Advances Studio/tour capability to `0.3.5` and runtime to `3.0.5`; all active
  DEV tours require new immutable packages. The accepted 0.3.4 set remains an
  immutable rollback and must not be relabelled.

## [0.3.4] — 2026-08-30

### Fixed

- Makes runtime-only fleet revisions reproducible by binding `generatedAt` to
  the immutable Studio commit time supplied by the operator transaction.
- Prevents a retry from producing different manifest bytes beneath an existing
  `bounded-<content-digest>` prefix; immutable collisions remain fail-closed.

### Migration

- Advances Studio/tour capability to `0.3.4` and runtime to `3.0.4` so the
  deterministic manifest contract and the visible scene-marker fix receive a
  fresh immutable package identity across all active tours.

## [0.3.3] — 2026-08-30

### Fixed

- Keeps the complete Pannellum interaction surface, including the walking-person
  scene-transition marker, above the bounded-media canvas. This fixes markers
  that remained clickable but were visually covered by the panorama renderer.

### Verification

- Adds a cross-engine stacking contract and a rendered-pixel regression check
  that compares the marker region with and without the marker. DOM visibility,
  computed style and hit-testing alone can no longer produce a false pass.

### Migration

- Advances Studio/tour capability to `0.3.3` and runtime to `3.0.3`. Every
  active DEV tour must receive a new immutable runtime package while preserving
  its exact four-object-per-scene bounded media and accepted rollback package.

## [0.3.0] — 2026-08-30

### Changed

- Replaces the 516-object-per-scene multires delivery topology with a bounded
  four-object profile: 2048 WebP base, 4096 mobile/WebKit WebP detail, up to
  8192 desktop WebP detail and 1024 JPEG recovery fallback.
- Makes the checked-in Studio template the sole source of runtime and brand
  files for exports, including a same-canvas progressive detail upgrade that
  preserves scene, pitch, yaw and field of view.
- Advances the portable format and runtime to `3.0.0`; package content remains
  independently identified as `bounded-<content-digest>`.

### Safety and verification

- Binds every scene role to actual path, dimensions, bytes and SHA-256 in both
  configuration and release manifest, rejects undeclared media and enforces a
  hard maximum of five delivery objects per scene.
- Keeps the opaque transition guard until base or bounded fallback is usable;
  exhausted base and fallback recovery is terminal, while a detail failure
  leaves the already usable panorama visible and does not emit terminal
  monitoring noise.
- Adds Chromium and WebKit dynamic-canvas verification, actual bounded package
  verification, and fail-closed Studio readiness checks for the v3 schema.

### Migration

- Every active tour must be rebuilt from its exact source workspace. Relabelling
  v2 multires metadata is forbidden because it cannot change actual topology.
- A v3 package may be selected on DEV only after exact immutable upload and
  remote verification. PROD still requires the separate physical iPhone Safari
  acceptance for those exact bytes; no automated WebKit result substitutes it.

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
