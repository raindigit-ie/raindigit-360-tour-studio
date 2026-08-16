# RainDigit 360 Tour Client Handoff

## Operator: create a tour locally

For another operator, extract `raindigit-360-tour-studio.zip` first. The kit contains the application and launchers but no existing customer project or panorama.

1. Double-click `Start RainDigit 360 Studio.command`.
2. Choose **New tour**, or choose **Open a tour** and select an exported editable `.rdtour` backup.
3. Complete the seven numbered tasks in order. The studio saves at every **Continue** and after every material edit.
4. On **Walking buttons**, rotate normally until the marker sits over the real route, drag it for precise correction when needed, then use **Next walking button**. The studio automatically opens the first unfinished point and will not advance while one remains unsaved.
5. On **First views**, save the destination view for every new movement. Publish remains locked until all destination views are reviewed.
6. On **Polish**, check the opening frame and walking-button positions in the same final viewport visitors receive.
7. On **Publish**, confirm the permanent web name, build the optimized tour, open its preview and download the web package only after review.
8. Use **Prepare embed & portable files** only when a client specifically needs one-file HTML, a paste-in block or a legacy folder package.
9. Use **Archive and finish tour** only after handoff. The studio validates a versioned local archive before clearing the active workspace.
10. Double-click `Stop RainDigit 360 Studio.command` when finished.

Camera originals stay outside the studio. The `.rdtour` backup contains normalized editable media and project data, not the untouched camera originals.

## Website owner: install the tour

1. Upload `raindigit-360-tour.html` to the website or media host.
2. Open its public URL directly and verify that the tour rotates and all transitions work.
3. Open **Add it to a website** on the Publish screen, enter that public URL and click **Copy website code**.
4. Paste the generated iframe into the page where the tour should appear.

The delivered HTML is self-contained and can also be opened directly from disk for review. It does not need adjacent image, CSS or JavaScript files.

If the website editor cannot upload a separate file, use `raindigit-360-tour-embed.html` instead. It is a single compressed body fragment containing the tour, styles and scripts. Paste its full contents into the page body. It shows a small preloader first, then creates the tour iframe after the host page has loaded and the browser is idle. This is convenient but heavier for the page than the normal iframe-by-URL method because the panorama data is inside the page markup.

Use the folder package under **Backups and advanced files** only when a host needs normal cacheable folders. That ZIP must be extracted without changing its internal paths. The one-file HTML remains the default customer handoff.

## Recovery

- Continue the named unfinished tour, reopen a recent local archive, or restore a transferred project from the Start screen with its editable `.rdtour` backup.
- Rebuilding invalidates and replaces the previous local release but never edits the source camera files.
- A release cannot be rebuilt while a newly added transition still reports **Place point** or **Set arrival**.
- If the studio misbehaves, retain `studio-workspace/studio-debug.ndjson`; it is the local diagnostic record, included in the editable archive for support and never included in the customer package.
