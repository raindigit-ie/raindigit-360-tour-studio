# RainDigit 360 Tour Studio Workflow

## Starter
- Purpose: operating protocol for producing a reviewed 360 tour from stitched panoramas.
- Contains: the linear local workflow, editable project backup, review gate and single-file release contract.
- Read full when: starting a property, handing a draft to an operator or preparing a customer release.
- Last update: 2026-08-02

## Operating Model

The studio is local-first. It keeps source material and the editable workspace on the operator's machine. The release builder creates a separate static directory for a customer host. Do not treat the public directory as an editing project.

## Novice-First Interface Contract

- One screen has one user goal and at most one visually primary action.
- The normal path uses everyday terms: **photos**, **rooms**, **look**, **movement**, **first views**, and **publish**.
- Technical formats, professional image controls, link metadata, install code, backups and folder hosting start collapsed.
- The interface never exposes coordinates, schema names or camera-engine terms in the default task surface.
- A user can always go **Back** or return to **Tours**. Continue validates the current screen and explains one unresolved action in plain language.
- The same contract is tested at desktop and a short 390x605 mobile viewport. The Back/Continue footer must remain fully visible while only the current step content scrolls. A disclosure may add capability, but it must not compete with the screen's main action while closed.

## Seven Screens

1. **Start**
   - Continue the current tour or create a clearly named new tour. Keep **Open saved work** collapsed.
   - Project replacement requires an explicit confirmation. Camera originals remain outside the workspace.

2. **Photos**
   - Import ready 2:1 JPG photos. The importer rejects wrong files, undersized images and exact duplicate bytes with plain-language recovery instructions.
   - Upload all viewpoints first. Do not ask for room structure on this screen.
   - It produces private normalized browser derivatives and thumbnails while stripping metadata. The source files remain outside the release flow.

3. **Rooms**
   - The first room is created automatically. Add any additional rooms with the dedicated control.
   - Keep room management and panorama assignment as separate lists. Assign each stable panorama card to a room, rename rooms and viewpoints, reorder viewpoints and choose the opening camera position.
   - Update room counts immediately without moving a panorama card under the pointer. Allow an accidental empty room to be removed.

4. **Look**
   - Show Natural, Bright and Warm as the normal choice. Keep brightness, contrast, saturation and warm/cool controls under **Fine tune picture**.
   - Add any number of local circle/ellipse or square/rectangle light/color areas. Every area must fade to zero at its boundary so it cannot introduce a visible seam.
   - Inspect each correction at the panorama seam and at the edges of the corrected area.

5. **Movement**
   - Create a link only where a visitor can move: a physical doorway/passage or another camera viewpoint.
   - Default to a viewpoint marker for another camera in the same room and a doorway marker for a different room. Keep marker type and custom name under **Link options**.
   - Select its type and destination, then use the explicit **Rotate view** / **Place selected** modes. Placement locks the camera; a short click/tap positions the selected marker, while a drag positions nothing. Selecting another marker never turns the camera or changes another marker.
   - After placement, rotating the panorama must move the marker's screen projection while its saved spherical coordinate remains unchanged. A marker that stays screen-fixed, disappears from the active scene configuration or leaves a stale DOM copy fails review.
   - Check the source frame from more than one structural reference. Avoid movable furniture. For a same-room link, use the visible tripod footprint, fixed walls, tile grid or other fixed architecture in both views.
   - A newly added transition remains incomplete until placement mode records an explicit point. If Continue finds unfinished work on another photo, it opens that source photo, selects the point and enters placement mode automatically.

6. **First views**
   - For every directed link, open the target location and compose the best first view: level horizon, legible orientation and a useful subject rather than ceiling or a wall.
   - Save yaw, pitch and field of view separately from the marker position. The visitor can continue rotating after arrival.
   - After saving the target composition, automatically select the next unsaved destination view. When none remain, return to the transition's source panorama so the operator does not lose context.
   - The wizard must not open Publish while any new movement still says **Set arrival**.

7. **Publish**
   - Review the room, view, movement and picture-change counts and require a green readiness gate.
   - Build the static package, then show **Download website file** as the only primary result.
   - Keep preview/testing, website-install code, editable backup and folder ZIP in separate collapsed disclosures.
   - `raindigit-360-tour.html` is the normal one-file customer installation. The editable backup is an operator asset, not part of the default customer handoff.

## Review Gate

1. Use **Continue** to validate and save each isolated step.
2. Open the read-only preview. It retains the scene navigator and hotspot travel but exposes no write controls.
3. Check every link from its source position and every arrival composition after the image fade completes.
4. Check desktop, Chromium mobile and WebKit/iOS-mobile emulation for clipping, misplaced controls, a hidden/reopenable navigator, fullscreen and visual paint artefacts.
5. Do not build or publish until the operator accepts the preview.

## Build And Embed

Use **Build the tour** on the Publish screen, or run `npm run build:release` after approval. The build validates the scene graph and image dimensions, rasterises approved look changes into public derivatives, generates thumbnails and writes:

- `release/` - static deployable folder;
- `dist/raindigit-360-tour.html` - self-contained tour with no adjacent runtime or media files;
- `dist/raindigit-360-tour.zip` - advanced folder-based deployment;
- the studio download endpoint creates `raindigit-tour-project.rdtour`, containing project JSON, draft JSON and normalized editable media.

For the simplest customer handoff, upload the single HTML file and use its URL directly. The ZIP remains available for hosts that prefer normal cacheable assets and includes `INSTALL.txt`.

The single HTML must also open directly from disk and render when embedded in a
fullscreen-enabled iframe. Both paths are part of the automated product test.

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
