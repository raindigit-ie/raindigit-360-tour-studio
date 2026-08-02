# RainDigit 360 Tour Studio Workflow

## Starter
- Purpose: operating protocol for producing a reviewed 360 tour from stitched panoramas.
- Contains: the linear local workflow, editable project backup, review gate and single-file release contract.
- Read full when: starting a property, handing a draft to an operator or preparing a customer release.
- Last update: 2026-08-02

## Operating Model

The studio is local-first. It keeps source material and the editable workspace on the operator's machine. The release builder creates a separate static directory for a customer host. Do not treat the public directory as an editing project.

## Seven Screens

1. **Start**
   - Continue the current project, create a clearly named new project or open a `.rdtour` editable backup.
   - Project replacement requires an explicit confirmation. Camera originals remain outside the workspace.

2. **Upload**
   - Import only stitched 2:1 equirectangular JPEG panoramas. The importer rejects non-JPEG files, non-2:1 images, undersized images and exact duplicate bytes.
   - Upload all viewpoints first. Do not ask for room structure on this screen.
   - It produces private normalized browser derivatives and thumbnails while stripping metadata. The source files remain outside the release flow.

3. **Rooms**
   - The first room is created automatically. Add any additional rooms with the dedicated control.
   - Assign each stable panorama card to a room, rename rooms and viewpoints, reorder viewpoints and choose the opening camera position.

4. **Color**
   - Use restrained whole-panorama brightness, contrast, saturation and warm/cool corrections.
   - Add any number of local circle/ellipse or square/rectangle light/color areas. Every area must fade to zero at its boundary so it cannot introduce a visible seam.
   - Inspect each correction at the panorama seam and at the edges of the corrected area.

5. **Transitions**
   - Create a link only where a visitor can move: a physical doorway/passage or another camera viewpoint.
   - Select its type and destination, then use the explicit placement mode to put its marker. Rotating the panorama alone never moves a marker.
   - Check the source frame from more than one structural reference. Avoid movable furniture. For a same-room link, use the visible tripod footprint, fixed walls, tile grid or other fixed architecture in both views.

6. **Arrival**
   - For every directed link, open the target location and compose the best first view: level horizon, legible orientation and a useful subject rather than ceiling or a wall.
   - Save yaw, pitch and field of view separately from the marker position. The visitor can continue rotating after arrival.

7. **Export**
   - Review the room, viewpoint, transition and color-edit counts, then open the read-only preview.
   - Build the static package only after the preview is accepted.
   - Download `raindigit-360-tour.html` as the one-file customer installation and `raindigit-tour-project.rdtour` as the editable project backup.

## Review Gate

1. Use **Continue** to validate and save each isolated step.
2. Open the read-only preview. It retains the scene navigator and hotspot travel but exposes no write controls.
3. Check every link from its source position and every arrival composition after the image fade completes.
4. Check desktop, Chromium mobile and WebKit/iOS-mobile emulation for clipping, misplaced controls, a hidden/reopenable navigator, fullscreen and visual paint artefacts.
5. Do not build or publish until the operator accepts the preview.

## Build And Embed

Use **Prepare final files** on the Export screen, or run `npm run build:release` after approval. The build validates the scene graph and panorama dimensions, rasterises approved look changes into public derivatives, generates thumbnails and writes:

- `release/` - static deployable folder;
- `dist/raindigit-360-tour.html` - self-contained tour with no adjacent runtime or media files;
- `dist/raindigit-360-tour.zip` - advanced folder-based deployment;
- the studio download endpoint creates `raindigit-tour-project.rdtour`, containing project JSON, draft JSON and normalized editable media.

For the simplest customer handoff, upload the single HTML file and use its URL directly. The ZIP remains available for hosts that prefer normal cacheable assets and includes `INSTALL.txt`.

Deploy the contents of `release/` to a customer-controlled host, then embed it with one iframe:

```html
<iframe
  src="https://tour.customer-domain.example/"
  title="RainDigit 3D tour"
  style="width: 100%; height: 720px; border: 0;"
  allowfullscreen>
</iframe>
```

The public release must contain no draft, project manifest, source originals, editor or save route.
