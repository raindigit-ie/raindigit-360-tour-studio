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

## Product Workflow

Start the local studio:

```bash
npm run studio
```

Open `http://127.0.0.1:8767/?edit=1` and follow the screen sequence:

1. **Start**: continue, create or restore an editable `.rdtour` project.
2. **Upload**: add all stitched 2:1 JPG panoramas without room decisions.
3. **Rooms**: manage a short room list, assign stable panorama cards, name and order viewpoints, then choose the opening view. Counts update immediately and empty rooms can be removed.
4. **Color**: apply whole-panorama corrections or smooth local light/color areas.
5. **Transitions**: create doorway or same-room viewpoint links, then deliberately place each marker.
6. **Arrival**: compose the first view that a visitor sees after every directed transition.
7. **Export**: review and create the single website file plus editable project backup.

Each **Continue** validates and saves the current step. The Export screen opens a
read-only same-origin preview, normally `http://127.0.0.1:8767/?preview=1&workspace=1`.
The separate preview container remains available at `http://127.0.0.1:8768/?preview=1&workspace=1`.

Create the customer package only after review approval:

```bash
npm run build:release
```

This creates `release/`, `dist/raindigit-360-tour.html` and the advanced
`dist/raindigit-360-tour.zip`. The HTML is the simplest one-file handoff; the ZIP contains an
`INSTALL.txt` file with a ready iframe example. Generated output is not versioned;
they are generated from the private workspace. See [the product workflow](docs/product-workflow.md)
and [asset-protection model](docs/asset-protection.md) for the exact boundaries.

## Docker

```bash
docker compose up studio preview
docker compose --profile release up release
```

The studio binds only to localhost and mounts the local project directory. The
release service serves only the built static output at `http://127.0.0.1:8080`.

Run `npm run test:studio-ui` for the complete browser journey: create, upload,
rooms, color, transition, arrival, preview, both downloads, local release,
editable-project restore and the mobile Rooms layout.

## Boundaries

- Source camera files, QA evidence, working drafts, local workspaces and generated releases are deliberately ignored by Git.
- The public build keeps a permanent linked RainDigit mark in the tour header, strips source metadata, uses generated asset names and contains no editor or draft endpoint.
- A browser must receive pixels to show a panorama, so no web delivery can make a displayed photo impossible to copy. Access control belongs at the host/domain layer; see the protection note before making a commercial promise.
