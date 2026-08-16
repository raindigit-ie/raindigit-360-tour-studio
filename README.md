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

On macOS, double-click `Start RainDigit 360 Studio.command`. The launcher starts
Docker Desktop when needed, prepares the private local service on first use, waits for its health
check and opens `http://127.0.0.1:8767/?edit=1`. No local Node.js or ImageMagick
installation is required. Later starts reuse the existing runtime and do not rebuild it.
Double-click `Stop RainDigit 360 Studio.command` when
finished; the editable workspace remains on disk.

The equivalent terminal commands are:

```bash
npm run app:start
npm run app:stop
```

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
npm run build:multires -- --slug my-tour
```

The studio blocks publishing when a planned walking button has not been explicitly
positioned or its destination view has not been saved. This prevents a technically
valid but unfinished navigation graph from reaching a customer.

The Publish screen builds the normal delivery form first. Its primary `raindigit-360-tour-web-package.zip`
mirrors the R2 object layout: immutable `tours/<slug>/multires-<digest>/` assets plus
`manifests/<slug>/current.json`. Every immutable release includes hashes, scene views,
the transition graph and an optional rollback version. The portable one-file HTML, paste-in
block and legacy folder ZIP are a separate optional build so ordinary publishing never
re-encodes the panoramas twice. Generated output is not committed;
it is generated from the private workspace. See [the product workflow](docs/product-workflow.md)
[operator playbook](docs/operator-playbook.md), [product readiness contract](docs/product-readiness.md)
and [client handoff](docs/client-handoff.md) for the exact operator, recovery and installation paths.

## Docker

```bash
docker compose up -d --build studio
```

The studio binds only to localhost and mounts the local project directory. The
release service serves only the built static output at `http://127.0.0.1:8080`.

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
