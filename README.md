# RainDigit 360 Tour Studio

## Starter
- Purpose: local RainDigit application for turning stitched 360 panoramas into a reviewed, self-hosted property tour.
- Contains: the original Killarney tour, a local five-stage studio, a static release builder and Docker delivery files.
- Read full when: importing the next room set, reviewing a tour, producing a customer package or deploying it.
- Last update: 2026-08-01

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
- Web panoramas use the original 11904x5952 resolution, a natural interior grade, high-quality JPEG encoding and no EXIF/GPS metadata.
- Scene labels are: Kitchen, Passage, Hall and Living Room.
- Each physical transition is checked in the browser from its source doorway and on arrival. The route matrix is `qa/route-matrix.md`.

## Product Workflow

Start the local studio:

```bash
npm run studio
```

Open `http://127.0.0.1:8767/?edit=1` and work through the five stages:

1. **Project**: create an isolated workspace and import stitched 2:1 JPEG panoramas. Imports are normalized, have EXIF/GPS stripped and are duplicate-checked.
2. **Scenes**: name, describe and order each camera location.
3. **Links**: create the doorway or viewpoint transitions, then deliberately place each marker.
4. **Arrival**: compose the first view that a visitor sees after every directed transition.
5. **Light**: apply whole-panorama corrections or smooth local light/color areas.

One **Save** persists the local draft. Review the product view at
`http://127.0.0.1:8768/?preview=1`. When working in a newly imported project,
use the `workspace=1` URL supplied by the studio for both editor and preview.

Create the customer package only after review approval:

```bash
npm run build:release
```

This creates `release/` and `dist/raindigit-360-tour.zip`. Neither is versioned;
they are generated from the private workspace. See [the product workflow](docs/product-workflow.md)
and [asset-protection model](docs/asset-protection.md) for the exact boundaries.

## Docker

```bash
docker compose up studio preview
docker compose --profile release up release
```

The studio binds only to localhost and mounts the local project directory. The
release service serves only the built static output at `http://127.0.0.1:8080`.

## Boundaries

- Source camera files, QA evidence, working drafts, local workspaces and generated releases are deliberately ignored by Git.
- The public build keeps a permanent linked RainDigit mark in the tour header, strips source metadata, uses generated asset names and contains no editor or draft endpoint.
- A browser must receive pixels to show a panorama, so no web delivery can make a displayed photo impossible to copy. Access control belongs at the host/domain layer; see the protection note before making a commercial promise.
