# RainDigit 360 Tour Studio

## Starter
- Purpose: local RainDigit application for turning stitched 360 panoramas into a reviewed, self-hosted property tour.
- Contains: the original Killarney tour, a linear local studio, editable project backup, single-file release builder and Docker delivery files.
- Read full when: importing the next room set, reviewing a tour, producing a customer package or deploying it.
- Last update: 2026-08-16

## Current Killarney Source
- Media card: `/Volumes/Untitled/DCIM/Camera01`.
- Camera: Insta360 X4.
- Captured files: 4 equirectangular JPG panoramas plus 4 DNG originals retained only as archive evidence.
- Old DJI media present elsewhere on the card was not copied for this tour.

## Current Killarney Output
- Tour folder: `web-tour/`.
- Entry point: `web-tour/index.html`.
- Clean publishing archive: `Killarney-Interior-360-web-tour-verified.zip`.
- QA contact sheets:
  - `qa/contact-sheet.jpg`
  - `qa/enhanced-contact-sheet.jpg`

## Processing
- Original files were copied unchanged into `originals/Camera01`.
- Camera originals remain 11904x5952. Browser derivatives use a natural interior grade, high-quality JPEG encoding, no EXIF/GPS metadata and a maximum release width of 8192 pixels.
- Scene labels are: Kitchen, Passage, Hall and Living Room.
- Each physical transition is checked in the browser from its source doorway and on arrival. The route matrix is `qa/route-matrix.md`.

## Start The Studio

### MacBook with M1, M2, M3 or M4

Clone or [download this public repository](https://github.com/raindigit-ie/raindigit-360-tour-studio) to the Mac, install Docker Desktop for Apple
Silicon, then double-click `Start RainDigit 360 Studio.command`. This is the
canonical staff installation path: the first start builds the Studio locally as
a native `arm64` container from the checked-out source code. It does not emulate
an Intel image and does not require a local Node.js, ImageMagick or FFmpeg installation.

The launcher checks the Mac architecture and Docker installation, starts Docker
Desktop when needed, waits for the Studio health check and opens
`http://127.0.0.1:8767/?edit=1`. Later starts reuse the existing local runtime and
do not rebuild it unless the runtime dependencies changed.

If macOS blocks the first double-click because the file came from the internet,
right-click the launcher once and choose **Open**. This approves only the local
repository launcher; the Studio remains bound to this Mac at `127.0.0.1`.

The Git route is:

```bash
git clone https://github.com/raindigit-ie/raindigit-360-tour-studio.git
cd raindigit-360-tour-studio
open "Start RainDigit 360 Studio.command"
```

On macOS, double-click `Start RainDigit 360 Studio.command`. The launcher starts
Docker Desktop when needed, prepares the private local service on first use, waits for its health
check and opens `http://127.0.0.1:8767/?edit=1`.
Double-click `Stop RainDigit 360 Studio.command` when
finished; the editable workspace remains on disk.

The equivalent terminal commands are:

```bash
npm run app:start
npm run app:stop
```

The explicit macOS bootstrap command is:

```bash
npm run app:start:mac
```

Port `8767` is the default. For an isolated support or QA copy, use a different
loopback port without editing the project:

```bash
RAINDIGIT_STUDIO_PORT=18767 npm run app:start:mac
```

After **Build the tour**, assemble and test the candidate inside the complete
Rain Digit website before production:

```bash
npm run review:site
```

This prepares the full-site and standalone-tour review at
`http://127.0.0.1:4173/__review/`. To create a non-indexable Cloudflare Pages
preview after local QA:

```bash
npm run review:site -- --deploy --branch review-<short-name>
```

Neither command publishes R2 media or promotes a production tour pointer.

Engineers can force a runtime rebuild after changing the Docker image or system
dependencies with `RAINDIGIT_REBUILD=1 npm run app:start`. Ordinary source edits
are bind-mounted and do not require rebuilding the image.

Build a clean operator package for another Mac with:

```bash
npm run build:studio-kit
```

It creates `dist/raindigit-360-tour-studio.zip` containing the local application
and launchers, while excluding every workspace, panorama, draft, release and Git file.

## Product Workflow

Start the local studio:

```bash
npm run studio
```

Open `http://127.0.0.1:8767/?edit=1` and follow the screen sequence:

1. **Start**: continue the clearly identified unfinished local tour, create a new tour, open an editable `.rdtour` file, or reopen a recent local archive. Starting over always requires confirmation; nothing is silently replaced.
2. **Photos**: add all ready stitched 2:1 JPG photos without making room decisions. DNG/RAW import is not part of the operator workflow because local tests did not show a reliable visible quality gain over the camera JPG.
3. **Rooms and walking routes**: set the room count and names, then arrange every visible photo card into a room by dragging it or using its Room menu. Generic `View 1` names are automatically replaced with room-based camera-point names, while manually typed photo names are preserved. Use **Preview** to open any 360 photo large, then select a source photo and mark every destination photo people can reach from it; this creates the required walking buttons.
4. **Look**: choose Natural, Bright or Warm. Professional controls and local light areas stay under **Fine tune picture**.
5. **Walking buttons**: the studio opens every planned walking button in order. Rotate until its real position is under the centre target, then press **Save point here**. All destinations use the same person marker, including another camera position in the same room.
6. **First views**: open one destination at a time, rotate to its useful first frame and save it. Buttons remain disabled while a photo or cross-fade is loading.
7. **Publish**: check six blocking readiness rules, confirm the permanent web name, build and download the optimized versioned website package. Preview it before promotion. The normal build processes panoramas once; optional one-file HTML, paste-in code and folder package are prepared separately only when needed. Editable backup and debug export stay available without rebuilding.

Every movement placement, removal, arrival view and picture adjustment is saved
automatically. Scene arrows wait for that save and ignore overlapping clicks, so
cycling between photos cannot replace a newer point with stale state. Each
**Continue** also validates and saves the current step. The Publish screen opens a
read-only same-origin preview, normally `http://127.0.0.1:8767/?preview=1&workspace=1`.
The separate preview container remains available at `http://127.0.0.1:8768/?preview=1&workspace=1`.

Create the optimized Rain Digit website package only after review approval:

```bash
npm run build:multires -- --slug my-tour --tour-version 0.2.0 --change-summary "Initial complete portable tour release"
```

The studio blocks publishing when a planned walking button has not been explicitly
positioned or its destination view has not been saved. This prevents a technically
valid but unfinished navigation graph from reaching a customer.

The Publish screen builds the normal delivery form first. Its primary `raindigit-360-tour-web-package.zip`
mirrors the R2 object layout: immutable `tours/<slug>/multires-<digest>/` assets plus
an independent `channels/dev/<slug>/current.json` selector. Every immutable release records
the Studio, portable-format, runtime, named-tour and content-addressed package versions,
its capability changelog, hashes, scene views and transition graph. A future PROD selector
can only select the exact already-verified DEV digest; promotion never rebuilds. The portable one-file HTML, paste-in
block and legacy folder ZIP are a separate optional build so ordinary publishing never
re-encodes the panoramas twice. Generated output is not committed;
it is generated from the private workspace.

Expensive image derivatives and multires tile sets use a persistent content-addressed
cache in `dist/build-cache`. A text, route or ordering change reuses every unchanged
scene; a picture adjustment invalidates only that scene. An unchanged ready release
returns immediately. Cache entries are least-recently-used and the Studio prunes them
automatically after the default 8 GB limit; run `npm run cache:prune` manually when
needed. Override the location and budget with `INSTA360_TOUR_BUILD_CACHE` and
`INSTA360_TOUR_BUILD_CACHE_MAX_GB`.

The build coordinator derives bounded face and scene concurrency from the CPU and
memory visible to the process. FFmpeg projects up to six cube faces per scene while
the runner profile can process up to three independent scenes; smaller machines
automatically select a lower topology. Docker also bounds the native queues with
`UV_THREADPOOL_SIZE=12` and `VIPS_CONCURRENCY=3`, avoiding both idle cores and
libvips oversubscription. This removes the former 24K-wide intermediate image while
preserving deterministic media bytes. On the 30-vCPU runner, two verified 21-scene
12K cold builds took 71.69–83.07 seconds and a fully cached rebuild took 9.55 seconds.
The Publish screen reports the current phase, scene progress, cache reuse and
measured build duration instead of leaving the operator waiting. Operators may use
`--face-concurrency` and `--scene-concurrency` for a measured fixed override; `auto`
is the supported default.

See [the product workflow](docs/product-workflow.md),
[operator playbook](docs/operator-playbook.md), [product readiness contract](docs/product-readiness.md),
[architecture and performance decision](docs/architecture-performance.md)
and [client handoff](docs/client-handoff.md) for the exact operator, recovery and installation paths.

## Docker

### Public image: any computer

The public image is multi-platform (`linux/amd64` and `linux/arm64`) and does not
need this repository, Node.js, ImageMagick or FFmpeg on the host. It contains no
customer media or editable project data. Start it with a persistent named volume:

```bash
docker volume create raindigit-360-tour-studio-data
docker run -d \
  --name raindigit-360-tour-studio \
  --restart unless-stopped \
  -p 127.0.0.1:8767:8767 \
  -v raindigit-360-tour-studio-data:/data \
  stekolshchykov/raindigit-360-tour-studio:latest
```

Open `http://127.0.0.1:8767/?edit=1`. The `/data` volume retains the
active workspace, recent archives, generated packages and content-addressed build
cache through container replacement and image upgrades. Export an editable `.rdtour`
backup from the Studio before moving the project to another computer.

The equivalent Compose launch is:

```bash
docker compose -f docker-compose.hub.yml up -d
docker compose -f docker-compose.hub.yml down
```

`down` keeps the named volume. Removing `raindigit-360-tour-studio-data` deletes the
local Studio state, so it must never be removed as part of an ordinary update.

To update without changing the data volume:

```bash
docker pull stekolshchykov/raindigit-360-tour-studio:latest
docker compose -f docker-compose.hub.yml up -d --force-recreate
```

The image runs as the non-root `node` user, declares its own healthcheck and supports
a read-only root filesystem with a writable `/data` volume and `/tmp` tmpfs. The port
is bound to loopback by default; do not expose the private Studio directly to the internet.

### Repository development

```bash
docker compose up -d --build studio
```

The studio binds only to localhost and mounts the local project directory. The
release service serves only the built static output at `http://127.0.0.1:8080`.
The launcher fingerprints `Dockerfile`, `package.json` and `package-lock.json`, so it
rebuilds the runtime automatically after a dependency change and otherwise reuses
the existing image. Docker build context excludes local media, caches, test output
and host `node_modules`; an isolated container volume supplies Linux dependencies.

Build and verify the standalone runtime locally with:

```bash
npm run docker:build
npm run test:docker-runtime -- raindigit-360-tour-studio:local
```

Publishing is deliberately explicit and requires an authenticated Docker CLI plus a
clean reviewed Git revision:

```bash
npm run publish:docker
```

Run `npm run test:all` for the complete server, browser and mobile matrix. The
studio journey covers create, upload, visual room-count/name setup, drag-and-drop photo assignment, multi-place selection, look, centre-target walking-button placement, first views, preview,
downloads, local release, editable-tour restore, direct offline opening of
the downloaded HTML, iframe installation and every wizard screen at a short mobile width. It also verifies that the footer stays visible, two points from one source keep independent coordinates through Back navigation, every selected place must be positioned, and panorama loading cannot be skipped by rapid clicks.
It also enforces a novice-default action budget and checks that technical terms do
not leak into the visible task surface.

Run `npm run setup:hooks` once after cloning. It installs the repository-owned
pre-push gate, which runs the complete local suite before Git sends changes. This
keeps verification on the workstation and consumes no GitHub Actions minutes.

Studio mode writes bounded local diagnostics to
`studio-workspace/studio-debug.ndjson`. Each event records the stage, scene,
selected marker, viewer pose and marker IDs in the data model, Pannellum config and
DOM. The log rotates at 5 MB, redacts secret-like fields, omits embedded image data
and is included in editable archives for support evidence while remaining excluded from public releases.

## Boundaries

- Source camera files, QA evidence, working drafts, local workspaces and generated releases are deliberately ignored by Git.
- The public build keeps a permanent linked RainDigit mark in the tour header, strips source metadata, uses generated asset names and contains no editor or draft endpoint.
- A browser must receive pixels to show a panorama, so no web delivery can make a displayed photo impossible to copy. Access control belongs at the host/domain layer; see the protection note before making a commercial promise.
