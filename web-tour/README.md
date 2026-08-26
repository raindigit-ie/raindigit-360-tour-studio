# Killarney Interior 360 Tour

## Starter
- Purpose: self-hosted 360-degree virtual tour from Insta360 X4 interior photos.
- Contains: processed web panoramas, thumbnails, Pannellum viewer, scalable horizontal navigator and embed snippet.
- Read full when: publishing or editing this tour.
- Last update: 2026-08-01

## Files
- `index.html` - tour entry point.
- `panoramas/` - privacy-stripped, color-graded 11904x5952 equirectangular JPEGs.
- `thumbnails/` - scene thumbnails for navigation.
- `css/` and `js/` - local viewer and custom interface files.

## Scenes
1. `scene-001` - Kitchen.
2. `scene-002` - Kitchen main-room view.
3. `scene-003` - Hall.
4. `scene-004` - Living Room.

## Embed
Upload the complete `web-tour` folder to the site and embed:

```html
<iframe
  src="/web-tour/index.html"
  title="Killarney Interior 360 Tour"
  style="width:100%;height:720px;border:0;"
  allowfullscreen
  webkitallowfullscreen
  mozallowfullscreen>
</iframe>
```

## Notes
- Original JPG/DNG files are outside this folder in `../originals/Camera01`; the studio imports only ready stitched JPG panoramas.
- Web panoramas were stripped of EXIF/GPS metadata.
- The navigator is generated from `js/tour-config.js`, stays horizontal and scrollable on desktop/mobile, and supports any number of scenes without taking a vertical portion of the panorama.
- The navigator distinguishes room views from physical travel: a viewfinder can reveal another camera position in the same room, while the walking-person marker only marks actual doorways. Their coordinates and arrival compositions are in `js/tour-config.js`.
- The Rooms icon always opens the navigator after it is closed. Fullscreen uses Pannellum first, with a full-viewport fallback when a browser/iframe blocks native fullscreen.
- The route strip is intentionally a sequence, not a floor plan. Do not invent room geometry from panoramas; use a real floor plan if spatial mapping is required.
- Add `?scene=scene-003&yaw=150&pitch=-18` to inspect an exact doorway during QA; these URL parameters do not change the standard tour UI.
- Viewer: Pannellum 2.5.6, bundled locally in `css/pannellum.css` and `js/pannellum.js`.
- `build:release` and multires exports content-version every mutable CSS/JavaScript reference. Keep the generated `?v=<digest>` values when uploading to Rain Digit or a customer website; never hand-edit or strip them. HTML/runtime files must revalidate, while hashed panorama media may be cached immutably. This prevents a long-lived iPhone Safari tab from combining an old bootstrap with a new viewer.
- Viewer/runtime, delivery, embed, or exporter changes require automated mobile WebKit plus a physical iPhone Safari check of both the direct package and a customer-style iframe before promotion. A desktop-only pass is not release evidence.

## Local Studio Review

Use the local studio before every publication when automatic doorway or
same-room suggestions need human confirmation. For a new property, start in
**Project** to create its isolated workspace and import stitched 2:1 JPEGs;
the stage creates private normalized derivatives and rejects duplicate inputs.
The original Killarney tour can continue to use its existing draft workflow.

1. Run `bash "/Users/mk/MEMO/FLOW Base/sars-scripts/bin/insta360-tour-coordinate-editor.sh"`.
2. Open `http://127.0.0.1:8767/?edit=1`.
3. In **Scenes**, set each location title and description and order the scene list. In **Links**, select
   a transition or add a local draft transition. Panorama rotation does not
   change a marker; press `Place selected point` first, then click its exact
   visible destination. Delete only draft-only links in this screen.
4. In **Arrival**, choose a directed link, pan the target panorama to its best
   starting composition, then save the arrival view. This does not alter the
   source marker position.
5. In **Light**, store per-scene brightness, contrast, saturation and
   warm/cool values. Add any number of elliptical or rectangular local light/
   colour areas. They are preview overlays with a smooth fade to zero at every
   edge; the approved build rasterises them into browser panorama derivatives.
6. Press the single `Save` action to write the entire local review draft. The
   original Killarney tour uses `../qa/manual-hotspot-overrides.json`; a new
   Project workspace writes `../studio-workspace/draft.json`.
7. Open `http://127.0.0.1:8768/?preview=1` to inspect the saved result with the
   normal lower navigator and clickable markers, without the studio panel or
   any write endpoint.
8. Review every directed marker and tell the agent when the draft is final.
   For the original Killarney tour, transfer approved coordinates into
   `js/tour-config.js` before a separate publication. For a workspace project,
   run `npm run build:release`; its static release and ZIP contain only public
   derivatives, not the editable workspace or draft.

The editor JavaScript is loaded only for `?edit=1` on `localhost` / `127.0.0.1`.
The localhost server binds only to `127.0.0.1`; it is not part of the public
Pages build and production has no draft-save endpoint.
