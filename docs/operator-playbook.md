# RainDigit 360 Tour Studio — Operator Playbook

## Starter
- Purpose: the shortest safe employee procedure from prepared panoramas to a reviewed handoff.
- Audience: tour operators; no programming or Cloudflare access required.
- Read full when: starting work, recovering a tour, or handing a package to the publisher.
- Last update: 2026-08-16

## Before starting

1. Put the stitched 2:1 JPG panoramas for one customer in a clearly named Finder folder. Keep camera originals elsewhere.
2. Double-click `Start RainDigit 360 Studio.command` and wait for the Studio page. First start prepares the private runtime; later starts reuse it and are much faster.
3. If the Start screen shows an unfinished customer tour, continue it or archive it before starting another. Never replace a project merely to clear the screen.

## Normal production path

1. Create and clearly name the tour.
2. Import every panorama. A rejected file does not cancel the valid files in the same selection; read the skipped-file message and correct only those files.
3. Set spaces and floors, order them, name every photo and group photos by space. The first visible photo is the opening scene.
4. Select each source photo and mark every place a visitor can walk to.
5. Choose the overall look. Use fine controls only to solve a visible problem.
6. Place every walking button on a stable architectural reference, not furniture.
7. Save one useful opening view for every destination photo.
8. Polish the exact visitor viewport: opening frame first, then any walking-button corrections.
9. On Publish, resolve every item in the pre-publish check. Build the optimized website tour, open it and walk every route.
10. Download the web package. Prepare portable files only when the publisher or client asks for them.
11. After the publisher confirms receipt, use **Archive and finish tour**. Confirm the tour appears under recent archives before starting the next one.

## Fast path for a normal linear tour

Use this when the imported photos are already arranged in the order a visitor should walk:

1. In **Spaces**, drag rooms/photos into visitor order and press **Connect in order**. The Studio adds two-way routes only between neighbouring photos and keeps existing routes. Check the suggestion; **Undo automatic routes** restores the earlier route list.
2. In **Look**, choose one preset and press **Use on all photos & continue**. This copies only the overall colour/brightness. Photo-specific local correction areas are not copied.
3. Place every walking button manually. This is intentionally not automated: the Studio cannot safely infer the real doorway or walking point from an image.
4. In **First views**, press **Keep current views & continue** when each photo already opens in a useful direction. Fine corrections remain available in **Polish**.
5. In **Publish**, leave the automatically created web address collapsed unless the publisher requested a specific slug. Press **Build & download web package** once; the verified ZIP downloads automatically after the build passes.

The regression budget for a three-photo linear fixture is **13 deliberate clicks plus four required marker drags** from new-tour creation through downloaded ZIP. Synthetic local fixtures complete in roughly 9–10 seconds; real import/build time depends on panorama resolution and machine speed.

## Recovery rules

- **Save says retrying/offline:** leave the Studio open. Reconnect; it retries automatically.
- **Changed in another window:** stop editing and reload. Do not keep both windows open.
- **Build lists unreachable photos:** return to Spaces and add walking routes. Nothing was deleted.
- **Browser warns before closing:** cancel, wait for **Saved**, then close.
- **Need an older finished tour:** open it from **Recent archived tours**. Restoring never reads files outside a validated `.rdtour` archive.
- **Studio behaves unexpectedly:** download the debug bundle and note the customer name, current step and exact action. Do not send camera originals.
- **Need to know where time went:** the current browser session records local-only elapsed time, deliberate actions and time per stage in the diagnostic journal. It is not sent to analytics or a remote service.
- **Launcher says it is preparing the runtime:** this is expected only on first use or after an engineer-requested upgrade. Do not repeatedly rebuild during ordinary work.

## Handoff checklist

- Optimized preview opens without a black frame.
- Every room/view is named correctly and in the intended order.
- Every walking button works in both directions where a return route is intended.
- Every arrival and opening view is level and useful.
- Desktop and phone layouts expose Rooms, capture and fullscreen controls.
- The web package filename and permanent slug match the customer/project.
- The editable project remains in Studio until a safe archive exists.

## Publisher handoff

Give the publisher:

- `raindigit-<slug>-web-package.zip`;
- the permanent slug;
- the approved title/description/cover assets for the RainDigit story page;
- a note confirming that the optimized preview and route checklist passed.

The operator does not need production credentials. Publishing to R2 and changing the RainDigit site remain a separate reviewed release role.
