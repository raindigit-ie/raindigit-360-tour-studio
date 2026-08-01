# RainDigit 360 Tour Asset Protection

## Starter
- Purpose: define the honest security and ownership boundaries for delivered web tours.
- Contains: current release safeguards and the access-control decision needed for stronger protection.
- Read full when: preparing a public deployment or discussing source-photo protection with a customer.
- Last update: 2026-08-01

## Non-Negotiable Browser Limit

A browser has to receive enough image data to render a 360 panorama. A visitor who can view it can save, screenshot or inspect that delivered derivative. Minifying JavaScript, putting all assets into one file, hiding URLs or obfuscating code does not make published photos unextractable.

Do not promise cryptographic prevention of copying for an open web tour.

## Current Release Safeguards

The release builder intentionally:

- excludes camera originals, the editable workspace, QA captures and editor/preview code;
- strips EXIF and GPS from generated public JPEGs;
- re-encodes to a web delivery derivative and uses content-derived asset paths;
- rasterises approved local corrections into the derivative rather than publishing their editable controls;
- writes no draft-save API, no project JSON and no upload route;
- sets `noindex`, restrictive cross-origin/referrer headers and blocks known editing-path requests in the release server;
- preserves a linked RainDigit logo and `3D tour` label in the viewer header.

These measures protect the camera originals and reduce accidental reuse. They do not turn a delivered panorama into a secret.

## Stronger Commercial Control

For a private sale, client review or paid property portal, host the static release behind a real authorization boundary, such as Cloudflare Access, a site login, or short-lived signed asset URLs. This requires a deployment domain and an identity/access decision from the client. It deliberately is not enabled by default because it conflicts with a public, one-line iframe embed.

Even with authorization, an approved viewer can still capture the rendered image. The meaningful protection is controlled access, contractual ownership and visible RainDigit attribution, not a claim that client-side files cannot be extracted.
