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
   - Offer exactly two explicit paths: create a clearly named new tour, or open an editable `.rdtour` project file selected by the operator.
   - Do not list, suggest or silently reopen the previous local workspace on this screen.
   - Project replacement requires an explicit confirmation. Camera originals remain outside the workspace.

2. **Photos**
   - Import ready 2:1 JPG photos. The importer rejects wrong files, undersized images and exact duplicate bytes with plain-language recovery instructions.
   - Upload all viewpoints first. Do not ask for room structure on this screen.
   - It produces private normalized browser derivatives and thumbnails while stripping metadata. The source files remain outside the release flow.

3. **Rooms**
   - Show one photo at a time and ask one question: **Where was this photo taken?**
   - Rename the view, then choose an existing room or create and choose a different room. Choosing the same room for another photo explicitly creates another camera view of that room.
   - **Save and next photo** advances only after the current view has a name and one room. Creating a room must not erase a view name already typed on the same screen.

4. **Look**
   - Show Natural, Bright and Warm as the normal choice. Keep brightness, contrast, saturation and warm/cool controls under **Fine tune picture**.
   - Add any number of local circle/ellipse or square/rectangle light/color areas. Every area must fade to zero at its boundary so it cannot introduce a visible seam.
   - Inspect each correction at the panorama seam and at the edges of the corrected area.

5. **Movement**
   - Create a link only where a visitor can move: a physical doorway/passage or another camera viewpoint.
   - Label destinations as **Another view of this room** or **Another room**. The studio chooses the correct viewfinder or walking marker automatically.
   - Choose one destination, rotate the panorama normally until the real doorway or other camera position is under the fixed centre target, then press **Save point here**. There is no rotate/place mode switch.
   - After placement, rotating the panorama must move the marker's screen projection while its saved spherical coordinate remains unchanged. A marker that stays screen-fixed, disappears from the active scene configuration or leaves a stale DOM copy fails review.
   - Check the source frame from more than one structural reference. Avoid movable furniture. For a same-room link, use the visible tripod footprint, fixed walls, tile grid or other fixed architecture in both views.
   - A newly added transition remains incomplete until **Save point here** records an explicit spherical coordinate. Back cancels a new unfinished point without changing an older point.
   - Save immediately after adding, placing or removing a movement. The wizard controls photo order itself; it waits for the queued save and for the current panorama and cross-fade to settle before enabling the next action.
   - Test at least two points by cycling through every scene forwards and backwards twice. After each cycle, the stable point IDs must match in the scene model, active Pannellum configuration, rendered DOM and persisted draft.

6. **First views**
   - For every directed link, open the target location and compose the best first view: level horizon, legible orientation and a useful subject rather than ceiling or a wall.
   - Save yaw, pitch and field of view separately from the marker position. The visitor can continue rotating after arrival.
   - Show one directed movement at a time. First press **Open destination**, rotate to the best composition, then press **Save this first view**.
   - After saving, automatically return to the next movement source. Disable Open/Save while a panorama or cross-fade is still loading, and do not open Publish while any first view is unfinished.

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

The guided browser regression additionally creates three photos and two rooms,
groups two photos as separate views of one room, saves two independent points
from the same source, cycles Back/Next, completes both first views at 390x605,
builds the customer HTML and verifies the local diagnostic events.

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

## Local Diagnostics

Studio mode keeps `studio-debug.ndjson` inside the local workspace. It records
stage changes, selections, placements, saves, scene changes, viewer load events,
runtime hotspot rebuilds, errors and a compact marker inventory. The inventory
compares the scene model, Pannellum configuration and rendered marker DOM, which
makes a reported disappearing-point bug traceable without reproducing it by eye.

The server rotates the journal at 5 MB and keeps one previous file. Secret-like
fields are redacted and data/blob URLs are omitted. Diagnostics are operator-only:
neither `.rdtour` backups nor customer releases include the journal.
