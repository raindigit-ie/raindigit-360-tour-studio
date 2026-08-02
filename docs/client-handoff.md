# RainDigit 360 Tour Client Handoff

## Operator: create a tour locally

For another operator, extract `raindigit-360-tour-studio.zip` first. The kit contains the application and launchers but no existing customer project or panorama.

1. Double-click `Start RainDigit 360 Studio.command`.
2. Create a tour. Use **Open saved work** only when continuing from an exported editable backup.
3. Complete the six numbered screens in order. The studio saves at every **Continue**.
4. On **Movement**, place every new point deliberately. The next screen remains locked until all new points are positioned.
5. On **First views**, save the destination view for every new movement. Publish remains locked until all destination views are reviewed.
6. On **Publish**, build the tour and download `raindigit-360-tour.html`.
7. Use **Backups and advanced files -> Download editable backup** only for internal continuation or transfer to another operator. It is not required by the website owner.
8. Double-click `Stop RainDigit 360 Studio.command` when finished.

Camera originals stay outside the studio. The `.rdtour` backup contains normalized editable media and project data, not the untouched camera originals.

## Website owner: install the tour

1. Upload `raindigit-360-tour.html` to the website or media host.
2. Open its public URL directly and verify that the tour rotates and all transitions work.
3. Open **Add it to a website** on the Publish screen, enter that public URL and click **Copy website code**.
4. Paste the generated iframe into the page where the tour should appear.

The delivered HTML is self-contained and can also be opened directly from disk for review. It does not need adjacent image, CSS or JavaScript files.

Use the folder package under **Backups and advanced files** only when a host needs normal cacheable folders. That ZIP must be extracted without changing its internal paths. The one-file HTML remains the default customer handoff.

## Recovery

- Reopen the last local workspace with **Continue this tour**.
- Restore a transferred or archived project with **Open saved work** and its editable backup.
- Rebuilding invalidates and replaces the previous local release but never edits the source camera files.
- A release cannot be rebuilt while a newly added transition still reports **Place point** or **Set arrival**.
