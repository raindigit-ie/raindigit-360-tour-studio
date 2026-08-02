# RainDigit 360 Tour Client Handoff

## Operator: create a tour locally

For another operator, extract `raindigit-360-tour-studio.zip` first. The kit contains the application and launchers but no existing customer project or panorama.

1. Double-click `Start RainDigit 360 Studio.command`.
2. Create a project or open an existing `.rdtour` backup.
3. Complete the seven screens in order. The studio saves at every **Continue**.
4. On **Transitions**, place every new point deliberately. The next screen remains locked until all new points are positioned.
5. On **Arrival**, save the first view for every new transition. Export remains locked until all arrivals are reviewed.
6. On **Export**, open the review, build the files and open **Website embed test**.
7. Download exactly two normal delivery files:
   - `raindigit-360-tour.html` for the website;
   - `raindigit-tour-project.rdtour` for future editing.
8. Double-click `Stop RainDigit 360 Studio.command` when finished.

Camera originals stay outside the studio. The `.rdtour` backup contains normalized editable media and project data, not the untouched camera originals.

## Website owner: install the tour

1. Upload `raindigit-360-tour.html` to the website or media host.
2. Open its public URL directly and verify that the tour rotates and all transitions work.
3. Enter that public URL on the studio Export screen and click **Copy embed code**.
4. Paste the generated iframe into the page where the tour should appear.

The delivered HTML is self-contained and can also be opened directly from disk for review. It does not need adjacent image, CSS or JavaScript files.

Use **Advanced hosting** only when a host needs normal cacheable folders. That ZIP must be extracted without changing its internal paths. The one-file HTML remains the default customer handoff.

## Recovery

- Reopen the last local workspace with **Continue current project**.
- Restore a transferred or archived project with **Open editable project** and its `.rdtour` file.
- Rebuilding invalidates and replaces the previous local release but never edits the source camera files.
- A release cannot be rebuilt while a newly added transition still reports **Place point** or **Set arrival**.
