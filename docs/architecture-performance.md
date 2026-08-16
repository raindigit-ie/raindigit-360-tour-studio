# RainDigit 360 Tour Studio — architecture and performance decision

Status: accepted for the current product line. Review after the incremental build pipeline has production telemetry from at least 20 real tours.

## Product objective

An operator must be able to turn a folder of 2:1 panoramas into a verified, upload-ready tour with the fewest possible decisions and without understanding image pipelines. The studio must remain usable on a 16 GB laptop and later on a small private server.

The operating contract is:

1. import once;
2. name and order spaces;
3. connect real walking routes;
4. confirm one opening view per scene;
5. preview the exact public runtime;
6. build only changed media;
7. verify and download one immutable package.

## Evidence from the current implementation

- The former full 20-scene build took 2,763.68 seconds (46:03.68) and reached 7.41 GB maximum RSS on the reference M1/16 GB workstation.
- The optimized full cold build takes 525.88 seconds (8:45.88), a 5.25× speed-up / 81.0% wall-time reduction, and reaches 2.40 GB maximum RSS, a 67.7% reduction.
- The same 20-scene build takes 23.41 seconds when media is unchanged and cached; changing the colour recipe of one scene takes 47.13 seconds and invalidates exactly that scene.
- An unchanged release is returned by the Studio without launching the builder (`buildDurationMs: 0`).
- Node orchestration stayed near 48 MB RSS in the former pipeline. The current coordinator plus embedded Sharp worker stays around 150 MB outside native child work.
- The former 24,576×4,096 cube strip made the complete process reach 7.41 GB. Projecting one face at a time caps the measured full build at 2.40 GB.
- FFmpeg, ImageMagick and Sharp/libvips perform the expensive native pixel work; JavaScript is primarily orchestration and UI.
- A previous build regenerated every panorama derivative and every tile after route, text or title edits.
- The largest maintainability risks are the monolithic editor/runtime files, not the language runtime.

Reference measurements use the same 20 real 11,904×5,952 panoramas, 10,200 WebP tiles and 10,355 release files. They are engineering baselines, not absolute CI timing assertions.
The machine-readable record is [`docs/benchmarks/2026-08-16-m1-20-scene.json`](benchmarks/2026-08-16-m1-20-scene.json).

## Decision: do not rewrite the whole product in Rust

A full Rust rewrite is rejected for now. It would recreate stable product logic, browser integration and tests while leaving FFmpeg/ImageMagick as the dominant cost unless the complete image pipeline were also replaced.

Rust remains a valid future implementation for one isolated media-worker executable only if a benchmark proves all of the following:

- pixel parity or an approved visual improvement;
- at least 30% lower cold-build wall time;
- at least 50% lower peak RSS;
- deterministic output on macOS and Linux;
- simpler deployment than the existing native-tool bundle.

Candidate workers must use a versioned JSON/NDJSON request-response contract so Node can be replaced without changing the studio UI or project format.

The current isolated media worker is `scripts/lib/media-pyramid.mjs`: FFmpeg performs one lossless cube-face projection at a time and Sharp/libvips creates the Deep Zoom pyramid and progressive JPEG fallback. It is versioned in the cache recipe and is the only boundary a future Rust experiment would need to replace.

## Decision: migrate the editor to Svelte incrementally

Svelte is the target for editor screens, shared controls and state rendering. It improves component consistency, accessibility, testability and debugging; it does not process panorama textures.

Migration order:

1. shared buttons, fields, cards, status and progress components;
2. import and space setup;
3. route graph editor;
4. opening-view and polish tools;
5. export/readiness panel;
6. delete the corresponding legacy render functions only after parity tests pass.

During migration, business rules live in framework-independent modules. Svelte components receive typed view models and emit explicit commands; they do not edit project JSON directly.

## Target boundaries

```text
Browser editor (Svelte)
  -> typed commands / view models
Studio application service (Node)
  -> project validation + workflow state machine
Build coordinator (Node, concurrency = 1)
  -> content-addressed derivative cache
  -> media worker (FFmpeg/ImageMagick today; replaceable later)
  -> immutable release assembler
  -> verification suite
Object storage / local artifact directory
```

### Domain model

- `TourProject`: title, spaces, floors, ordered scenes and first scene.
- `Scene`: immutable source reference plus operator-authored labels and view.
- `Route`: directed source-to-target relationship with placement and arrival data.
- `ImageRecipe`: global and local adjustments that affect pixels.
- `Release`: immutable content version plus stable pointer.

Editor selection, open panels, progress and timestamps are session state and must not invalidate media or releases.

## Incremental build graph

```text
validate workspace
  -> fingerprint project + release-affecting draft
  -> derivative(scene source + ImageRecipe)
  -> multires(scene derivative + encoder settings)
  -> runtime/config/SEO assets
  -> integrity inventory and digest
  -> immutable package + current pointer
  -> zip
```

The two expensive scene nodes are content-addressed. Route, copy, ordering and metadata changes reuse all pixel outputs. One adjusted scene invalidates exactly one base derivative and one tile set. An unchanged, already-ready release returns immediately without launching a build.

Cache entries are immutable, validated before reuse, touched on access and pruned least-recently-used to 90% of an 8 GB default budget when the limit is exceeded. The budget is configurable through `INSTA360_TOUR_BUILD_CACHE_MAX_GB`.

Reference-workstation service objectives for a 20-scene 12K source set are: cold build under 10 minutes, cached rebuild under 60 seconds, one-scene media change under 90 seconds, unchanged release under one second and measured peak RSS under 3 GB. Regression tracking records these separately from browser delivery budgets.

## Resource policy for a future server

- one build job at a time;
- no public editor without authentication and TLS;
- persistent build cache on local SSD;
- workspace and artifacts outside the application checkout;
- CPU and memory limits at the service/container level;
- atomic staging then promotion; never build into the live release;
- object-storage upload is a separate resumable promotion step;
- public tours remain static files and consume no application server CPU.

Initial practical server target: 2–4 vCPU, 4 GB RAM and SSD. A 2 GB host is not accepted until the new direct-face pipeline is measured below its memory limit on real 4K/8K inputs.

The Docker image installs only production dependencies, excludes workspaces/caches/node_modules from its build context and is rebuilt automatically when Docker or lockfile inputs change. Public tours remain static and need none of the Studio dependencies.

## Reliability and observability

Every build returns machine-readable timings, per-scene cache hits/misses, payload size and immutable digest. The studio stores the last metrics with release metadata and displays reuse to the operator.

Required invariants:

- source panoramas are never modified;
- cached derivatives are keyed by source bytes, complete image recipe and encoder contract;
- identical inputs produce the same release version;
- a changed tour cannot be promoted if it changed during the build;
- output is verified before it is offered for download;
- failed staging directories are removable and never become current.

## Test strategy

1. pure unit tests for validation, naming, ordering, route graph and cache keys;
2. build contract tests for cold, warm, metadata-only and one-scene changes;
3. pixel-equivalence tests for projection changes;
4. browser tests in Chromium desktop/mobile and WebKit mobile;
5. visual evidence for opening frame, controls, navigation and overflow;
6. full testing-lab verified suite before push;
7. real-workspace benchmark on an APFS clone, never on customer originals.

No timing assertion should be based on a developer machine's absolute speed. CI asserts cache behaviour and output invariants; benchmark reports track wall time, peak RSS and bytes separately.

## Product rules

- default path is linear; advanced tools stay contextual and collapsed;
- autosave is visible but never blocks navigation unnecessarily;
- one opening view per scene;
- readiness explains the next corrective action in operator language;
- preview uses the exact public runtime;
- build has one primary action and returns a package without extra packaging decisions;
- errors identify the scene and the next action, not an internal stack trace.

## Follow-up refactoring sequence

1. extract project validation and workflow state from `tour-editor.js`;
2. extract build cache and media-worker adapters from build scripts;
3. replace status polling with server-sent events only if remote multi-user telemetry proves it necessary; the current structured progress contract is already phase-aware;
4. add a durable single-job queue before remote multi-user operation;
5. migrate screens to Svelte one at a time;
6. benchmark an optional Rust worker only if the measured FFmpeg/Sharp pipeline no longer meets the service objectives;
7. select a replacement worker only from measured parity, time, memory and deployment evidence.

## Primary technical references

- Svelte compiler and component model: <https://svelte.dev/docs/svelte/overview>
- Sharp/libvips concurrency and current ARM64 benchmarks: <https://sharp.pixelplumbing.com/performance/>
- Sharp/libvips Deep Zoom tile output contract: <https://sharp.pixelplumbing.com/api-output/#tile>
- FFmpeg `v360` projection filter: <https://www.ffmpeg.org/ffmpeg-filters.html#v360>
- FFmpeg `v360` implementation and slice-thread support: <https://www.ffmpeg.org/doxygen/trunk/vf__v360_8c.html>
