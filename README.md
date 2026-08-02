# RainDigit 360 Tour Studio

## Starter
- Purpose: local RainDigit application for turning stitched 360 panoramas into a reviewed, self-hosted property tour.
- Contains: the original Killarney tour, a linear local studio, editable project backup, single-file release builder and Docker delivery files.
- Read full when: importing the next room set, reviewing a tour, producing a customer package or deploying it.
- Last update: 2026-08-02

## Current Killarney Source
- Media card: `/Volumes/Untitled/DCIM/Camera01`.
- Camera: Insta360 X4.
- Captured files: 4 equirectangular JPG panoramas plus 4 DNG originals.
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
Docker Desktop when needed, builds the private local service, waits for its health
check and opens `http://127.0.0.1:8767/?edit=1`. No local Node.js or ImageMagick
installation is required. Double-click `Stop RainDigit 360 Studio.command` when
finished; the editable workspace remains on disk.

The equivalent terminal commands are:

```bash
npm run app:start
npm run app:stop
```

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

1. **Start**: create a new tour or explicitly open an editable `.rdtour` project file. The studio does not list or silently reopen a previous local workspace.
2. **Photos**: add all ready 2:1 JPG photos without making room decisions.
3. **Rooms**: process one photo at a time. Name the view, choose an existing room, or create a different room. Choose the same room again when it contains a second camera position.
4. **Look**: choose Natural, Bright or Warm. Professional controls and local light areas stay under **Fine tune picture**.
5. **Movement**: choose one plainly labelled destination, rotate until the real doorway or other camera position is under the centre target, then press **Save point here**. The studio chooses walking versus same-room view markers automatically.
6. **First views**: open one destination at a time, rotate to its useful first frame and save it. Buttons remain disabled while a photo or cross-fade is loading.
7. **Publish**: check readiness, build and download one self-contained website file. Preview, website-install code, editable backup and folder package are separate collapsed options.

Every movement placement, removal, arrival view and picture adjustment is saved
automatically. Scene arrows wait for that save and ignore overlapping clicks, so
cycling between photos cannot replace a newer point with stale state. Each
**Continue** also validates and saves the current step. The Publish screen opens a
read-only same-origin preview, normally `http://127.0.0.1:8767/?preview=1&workspace=1`.
The separate preview container remains available at `http://127.0.0.1:8768/?preview=1&workspace=1`.

Create the customer package only after review approval:

```bash
npm run build:release
```

The studio blocks publishing when a newly added movement has not been explicitly
positioned or its destination view has not been saved. This prevents a technically
valid but unfinished navigation graph from reaching a customer.

The release build creates `release/`, `dist/raindigit-360-tour.html` and the advanced
`dist/raindigit-360-tour.zip`. The HTML is the normal one-file customer handoff; the ZIP contains an
`INSTALL.txt` file with a ready iframe example. Generated output is not versioned;
they are generated from the private workspace. See [the product workflow](docs/product-workflow.md)
and [client handoff](docs/client-handoff.md) for the exact operator and website-installation paths.

## Docker

```bash
docker compose up -d --build studio
```

The studio binds only to localhost and mounts the local project directory. The
release service serves only the built static output at `http://127.0.0.1:8080`.

Run `npm run test:all` for the complete server, browser and mobile matrix. The
studio journey covers create, upload, one-photo room assignment, look, centre-target movement placement, first views, preview,
downloads, local release, editable-tour restore, direct offline opening of
the downloaded HTML, iframe installation and every wizard screen at a short mobile width. It also verifies that the footer stays visible, two points from one source keep independent coordinates through Back/Next navigation, same-room destinations are explained plainly, and panorama loading cannot be skipped by rapid clicks.
It also enforces a novice-default action budget and checks that technical terms do
not leak into the visible task surface.

Studio mode writes bounded local diagnostics to
`studio-workspace/studio-debug.ndjson`. Each event records the stage, scene,
selected marker, viewer pose and marker IDs in the data model, Pannellum config and
DOM. The log rotates at 5 MB, redacts secret-like fields, omits embedded image data
and is excluded from editable backups and public releases.

## Boundaries

- Source camera files, QA evidence, working drafts, local workspaces and generated releases are deliberately ignored by Git.
- The public build keeps a permanent linked RainDigit mark in the tour header, strips source metadata, uses generated asset names and contains no editor or draft endpoint.
- A browser must receive pixels to show a panorama, so no web delivery can make a displayed photo impossible to copy. Access control belongs at the host/domain layer; see the protection note before making a commercial promise.
