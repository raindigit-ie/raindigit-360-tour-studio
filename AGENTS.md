# Project Guidance — 3D Tour Studio

## FLOW

- Project: `PRJ-0002` (3D Tour Studio).
- Read `.kimi/AGENTS.md` for repository-specific constraints.
- Resolve or resume the FLOW Change before meaningful implementation: `agentctl flow project resolve --cwd "$PWD" --json`.
- Follow `$flow-development` and the repository's actual build and verification commands.

## Tour runtime release gate

- The Studio exporter/template is the canonical runtime source for every new customer tour. Never patch only one published bundle; update the exporter, regenerate a fixture and prove the generated output.
- Studio and tour capability versions must match exactly. Format version, runtime version and immutable package version/digest remain separate identities; never overload one field to mean another.
- Every significant Studio/runtime/format change must evaluate the complete canonical active-tour registry. Each active tour is explicitly `migrated`, proven `compatible` by the current full profile, or `blocked`; missing and unevaluated rows fail the candidate.
- Every exported package is a self-contained static application with package-local HTML, JavaScript, CSS, configuration, panoramas/tiles/fallbacks, thumbnails, brand assets, changelogs, inventory and install/embed metadata. A customer host must need only a static origin or iframe.
- DEV and PROD builds, buckets, origins, namespaces, selectors, credentials and evidence are independent. Require an explicit environment before any write, reject cross-environment combinations before network access, never use a shared mutable `current`, and promote exact accepted bytes without rebuilding.
- Do not introduce a Cloudflare Worker into the tour delivery path. Static Pages/R2 origins and immutable packages are the supported boundary unless a later explicitly approved architecture change proves a Worker is necessary.
- Every runtime release must pass standalone and cross-origin embed checks in mobile WebKit with real panorama pixels, touch drag, a real scene transition, orientation resize, hidden Resource Timing and a recoverable tile outage.
- Visual acceptance covers the entire sequence, not the final frame: the opaque neutral guard remains until the requested scene, saved pitch/yaw/hfov, required tile, renderer state and stable compositor frames all agree. Record cold starts and every directed route; a wrong/black/partial intermediate frame is a failure.
- Readiness must come from explicit viewer/canvas/transition state. Do not depend on cross-origin Resource Timing fields or `requestAnimationFrame` progress inside an off-screen iframe.
- Automated WebKit is mandatory but does not replace physical iPhone Safari acceptance. A physical iPhone failure blocks release even when desktop and CI pass.
