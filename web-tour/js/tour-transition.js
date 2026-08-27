(() => {
  "use strict";

  const shell = document.querySelector(".tour-shell");
  if (!shell) return;

  const firstFrame = shell.querySelector(".tour-first-frame");
  const staticLoader = shell.querySelector("[data-tour-static-loader]");
  const config = window.TOUR_CONFIG || { firstScene: null, scenes: [] };
  // A portable document is static and cannot know `?scene=` before this
  // runtime reads the URL.  A neutral shell therefore deliberately has no
  // first-frame source.  The first scene-specific image is assigned below,
  // only after `requestedScene()` validates the URL against TOUR_CONFIG.
  const staticPreview = firstFrame?.currentSrc || firstFrame?.src || "";
  const initialPreview = firstFrame?.dataset.firstPaint === "neutral" ? "" : staticPreview;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const guardColumns = 6;
  const guardRows = 4;
  const baseFaces = ["f", "b", "u", "d", "l", "r"];
  const pollInterval = 50;
  const renderSettleDelay = reducedMotion ? 20 : 80;
  // The six target level-1 faces are the correctness gate. Detail levels are
  // deliberately allowed to continue through Pannellum's native progressive
  // renderer after the first stable target frame is presented.
  const presentationSettleDelay = reducedMotion ? 20 : 80;
  const presentationFrameCount = 2;
  const guardCellDuration = reducedMotion ? 160 : 1_180;
  const guardSettleDuration = reducedMotion ? 80 : 180;
  const retryDelay = 20_000;
  const tileFailureRetryDelays = [1_500, 3_000, 6_000];
  const maximumRetries = tileFailureRetryDelays.length;
  let viewer = null;
  let phase = "loading";
  let sequence = 0;
  let active = null;
  let contextLost = false;
  let contextRecoveryScheduled = false;
  let lastStableSceneId = null;
  let prearmed = false;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  const overlay = staticLoader || document.createElement("div");
  // Do not replace `className` here. The static shell owns the very first
  // pixel while the sequential bootstrap downloads Pannellum and tour.js;
  // clearing its classes created an iPhone-only window for a raw canvas.
  overlay.classList.add("tour-scene-transition", "tour-scene-transition--mobile-entry");
  overlay.setAttribute("aria-hidden", "true");
  if (!staticLoader) {
    overlay.innerHTML = `
      <div class="tour-scene-transition__stage">
        <img class="tour-scene-transition__image tour-scene-transition__outgoing" alt="" draggable="false" />
        <div class="tour-scene-transition__tiles" aria-hidden="true"></div>
        <div class="tour-scene-transition__mobile-status">
          <span class="tour-scene-transition__mobile-mark" aria-hidden="true"></span>
          <span>Loading tour</span>
        </div>
      </div>`;
    shell.append(overlay);
  }
  const outgoing = overlay.querySelector(".tour-scene-transition__outgoing");
  const tileLayer = overlay.querySelector(".tour-scene-transition__tiles");
  const statusLabel = overlay.querySelector(".tour-scene-transition__mobile-status span:last-child");
  if (!outgoing || !tileLayer) return;
  overlay.style.setProperty("--tour-cell-duration", `${guardCellDuration}ms`);
  overlay.style.setProperty("--tour-settle-duration", `${guardSettleDuration}ms`);

  function resetGuardTiles() {
    tileLayer.replaceChildren();
    for (let row = 0; row < guardRows; row += 1) {
      for (let column = 0; column < guardColumns; column += 1) {
        const tile = document.createElement("span");
        tile.className = "tour-scene-transition__tile tour-scene-transition__mobile-tile";
        const distance = Math.abs(column - (guardColumns - 1) / 2) +
          Math.abs(row - (guardRows - 1) / 2);
        tile.style.setProperty("--tour-cell-delay", `${Math.round(distance * 42)}ms`);
        tileLayer.append(tile);
      }
    }
  }

  function activateGuard(initial = false, sourceSceneId = null) {
    // Cold start owns the full viewport. Later scene changes mask only the
    // panorama and stay below the persistent control surface.
    overlay.dataset.phase = initial ? "initial-loading" : "loading";
    // The static form has already covered the page. Once a concrete run is
    // armed, retain that visibility but switch to the live tile treatment.
    overlay.classList.remove("tour-scene-transition--static");
    // The guard is scene-neutral on entry and navigation. Retaining the
    // source preview created "loader → wrong frame → requested frame" during
    // the final reveal on desktop Chrome and physical iPhone Safari.
    outgoing.removeAttribute("src");
    if (sourceSceneId) outgoing.dataset.sourceScene = sourceSceneId;
    else delete outgoing.dataset.sourceScene;
    resetGuardTiles();
    overlay.classList.remove("is-revealing", "is-settled");
    overlay.style.removeProperty("opacity");
    overlay.style.removeProperty("transition");
    void overlay.offsetWidth;
    overlay.classList.add("is-active", "is-waiting");
    shell.classList.add("is-mobile-transition-overlay-visible");
  }

  async function releaseGuard(run) {
    if (run.releasing) return;
    run.releasing = true;
    phase = "revealing";
    overlay.dataset.phase = "revealing";
    overlay.classList.remove("is-waiting");
    void overlay.offsetWidth;
    overlay.classList.add("is-revealing");
    // Fade the whole opaque layer. Fading only its children exposed the stage
    // background and a stale preview before the selected WebGL frame.
    overlay.style.setProperty(
      "transition",
      `opacity ${guardSettleDuration}ms cubic-bezier(.2,.76,.18,1)`
    );
    overlay.style.setProperty("opacity", "0");
    await sleep(guardSettleDuration);
    if (active?.token !== run.token) return;
    overlay.classList.add("is-settled");
    await sleep(reducedMotion ? 20 : 80);
    // Keep interaction and external readiness blocked until the cross-fade
    // is complete. Declaring readiness at fade start allowed a second tap to
    // replace the active run while the previous release was still sleeping.
    document.documentElement.classList.add("is-tour-ready");
    overlay.classList.remove("is-active", "is-waiting", "is-revealing", "is-settled");
    overlay.style.removeProperty("opacity");
    overlay.style.removeProperty("transition");
    shell.classList.remove("is-mobile-transition-overlay-visible");
    lastStableSceneId = run.sceneId;
  }

  function sceneConfig(sceneId) {
    return config.scenes.find((scene) => scene.id === sceneId) || null;
  }

  function resetTileAttempt(run, increment = false) {
    if (increment) run.tileAttempt += 1;
    run.tileRequested = 0;
    run.tileLoaded = 0;
    run.tileFailed = 0;
    run.tilePending = 0;
    run.tileLastEventAt = 0;
    run.tileLastFailureAt = 0;
  }

  function tilePrefix(sceneId) {
    const basePath = sceneConfig(sceneId)?.multiRes?.basePath;
    if (!basePath || typeof basePath !== "string") return null;
    try {
      return new URL(`${basePath.replace(/\/+$/, "")}/`, document.baseURI).href;
    } catch {
      return null;
    }
  }

  function tileMatchesRun(run, source) {
    const prefix = tilePrefix(run.sceneId);
    if (!prefix || typeof source !== "string") return false;
    try {
      return new URL(source, document.baseURI).href.startsWith(prefix);
    } catch {
      return false;
    }
  }

  function baseFaceForRun(run, source) {
    const prefix = tilePrefix(run.sceneId);
    if (!prefix || typeof source !== "string") return null;
    try {
      const absolute = new URL(source, document.baseURI).href;
      if (!absolute.startsWith(prefix)) return null;
      const relative = absolute.slice(prefix.length);
      const match = relative.match(/^1\/([fbudlr])0_0(?:\.[^/?]+)?(?:[?#]|$)/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }

  function updateBaseProgress(run) {
    if (active?.token !== run.token) return;
    const loaded = run.baseLoaded.size;
    tileLayer.dataset.baseLoaded = String(loaded);
    tileLayer.dataset.baseRequired = String(baseFaces.length);
    if (statusLabel) statusLabel.textContent = `Preparing view ${loaded}/${baseFaces.length}`;
  }

  function settleBaseFace(run, face, outcome) {
    if (active?.token !== run.token || !face) return;
    run.basePending.delete(face);
    if (outcome === "loaded") {
      run.baseLoaded.add(face);
      run.baseFailed.delete(face);
    } else if (!run.baseLoaded.has(face)) {
      run.baseFailed.add(face);
      run.tileLastFailureAt = performance.now();
    }
    updateBaseProgress(run);
  }

  function observeTileRequest(image, source) {
    const run = active;
    if (!run || !tileMatchesRun(run, source)) return;
    const token = run.token;
    const attempt = run.tileAttempt;
    const baseFace = baseFaceForRun(run, source);
    if (baseFace) {
      run.baseRequested.add(baseFace);
      if (!run.baseLoaded.has(baseFace)) run.basePending.add(baseFace);
      updateBaseProgress(run);
    }
    run.tileRequested += 1;
    run.tilePending += 1;
    run.tileLastEventAt = performance.now();
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
      const current = active;
      if (current?.token !== token || current.tileAttempt !== attempt) return;
      current.tilePending = Math.max(0, current.tilePending - 1);
      current.tileLastEventAt = performance.now();
      if (outcome === "loaded") {
        current.tileLoaded += 1;
        if (baseFace) {
          const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
          void decoded.then(
            () => settleBaseFace(current, baseFace, "loaded"),
            () => settleBaseFace(current, baseFace, "failed"),
          );
        }
      } else {
        current.tileFailed += 1;
        current.tileLastFailureAt = current.tileLastEventAt;
        settleBaseFace(current, baseFace, "failed");
      }
    };
    const loaded = () => settle("loaded");
    const failed = () => settle("failed");
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
  }

  function installTileObserver() {
    const NativeImage = window.Image;
    const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (!NativeImage || !sourceDescriptor?.get || !sourceDescriptor?.set) return;
    function TrackedImage(width, height) {
      const image = width === undefined
        ? new NativeImage()
        : height === undefined
          ? new NativeImage(width)
          : new NativeImage(width, height);
      Object.defineProperty(image, "src", {
        configurable: true,
        enumerable: sourceDescriptor.enumerable,
        get: () => sourceDescriptor.get.call(image),
        set: (source) => {
          observeTileRequest(image, source);
          sourceDescriptor.set.call(image, source);
        }
      });
      return image;
    }
    Object.setPrototypeOf(TrackedImage, NativeImage);
    TrackedImage.prototype = NativeImage.prototype;
    window.Image = TrackedImage;
  }

  function baseAttemptIsHealthy(run) {
    return Boolean(
      run.baseRequested.size === baseFaces.length &&
      run.baseLoaded.size === baseFaces.length &&
      run.baseFailed.size === 0 &&
      run.basePending.size === 0
    );
  }

  function preloadTargetBaseTiles(run) {
    const scene = sceneConfig(run.sceneId);
    const prefix = tilePrefix(run.sceneId);
    const extension = scene?.multiRes?.extension || "jpg";
    if (!prefix) return;
    run.baseImages = baseFaces.map((face) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "high";
      image.src = `${prefix}1/${face}0_0.${extension}`;
      return image;
    });
  }

  function previewFor(sceneId) {
    const scene = sceneConfig(sceneId);
    return scene?.multiRes?.equirectangularThumbnail || scene?.thumb || initialPreview;
  }

  function requestedScene() {
    const requested = new URLSearchParams(window.location.search).get("scene");
    return sceneConfig(requested)?.id || config.firstScene;
  }

  function dispatch(phaseName, run) {
    document.dispatchEvent(new CustomEvent("raindigit:tour-transition", {
      detail: {
        phase: phaseName,
        initial: run.initial,
        token: run.token,
        patchCount: 0,
        sceneId: run.sceneId,
        sourceSceneId: run.sourceSceneId,
        targetSceneId: run.sceneId,
        retryCount: run.retryCount,
        baseRequired: baseFaces.length,
        baseRequested: run.baseRequested.size,
        baseLoaded: run.baseLoaded.size,
        baseFailed: run.baseFailed.size,
        basePending: run.basePending.size,
        detailPending: Math.max(0, run.tilePending - run.basePending.size),
      }
    }));
  }

  function guard(sceneId, initial = false) {
    const resolvedSceneId = initial ? requestedScene() : (sceneConfig(sceneId)?.id || config.firstScene);
    const usesPrearmedOverlay = !initial && prearmed;
    prearmed = false;
    const run = {
      token: ++sequence,
      sceneId: resolvedSceneId,
      initial,
      sourceSceneId: initial ? null : lastStableSceneId,
      retryCount: 0,
      loadedAt: 0,
      viewerLoadAt: 0,
      readiness: "waiting",
      releasing: false,
      tileAttempt: 0,
      tileRequested: 0,
      tileLoaded: 0,
      tileFailed: 0,
      tilePending: 0,
      tileLastEventAt: 0,
      tileLastFailureAt: 0,
      baseRequested: new Set(),
      baseLoaded: new Set(),
      baseFailed: new Set(),
      basePending: new Set(),
      baseImages: [],
      // Pannellum may schedule the first tile just before emitting
      // scenechange / returning the viewer from its constructor.
      // A prime may happen before `tour.js` creates Pannellum. Its retry
      // clock must not expire while the bootstrap is still loading.
      attemptStartedAt: viewer ? Math.max(0, performance.now() - 500) : 0
    };
    active = run;
    phase = initial ? "initial-loading" : "loading";
    const preview = previewFor(run.sceneId);
    if (firstFrame) firstFrame.src = preview;
    firstFrame?.style.setProperty("visibility", "hidden", "important");
    firstFrame?.style.setProperty("opacity", "0", "important");
    shell.classList.add("is-transition-guarded");
    document.documentElement.classList.remove("is-tour-ready");
    document.documentElement.classList.add("is-tour-transition-boot");
    // On every run the branded loader owns every visible pixel. Neither a
    // target thumbnail nor a source-scene preview may enter the reveal path.
    if (!usesPrearmedOverlay) {
      activateGuard(initial, initial ? run.sceneId : run.sourceSceneId);
    }
    overlay.dataset.sourceScene = initial ? run.sceneId : (run.sourceSceneId || "unknown");
    overlay.dataset.targetScene = run.sceneId;
    updateBaseProgress(run);
    preloadTargetBaseTiles(run);
    dispatch(phase, run);
    void waitUntilRenderable(run);
    return run;
  }

  async function markReady(run) {
    if (active?.token !== run.token || run.releasing) return;
    await releaseGuard(run);
    if (active?.token !== run.token) return;
    phase = "ready";
    shell.classList.remove("is-transition-guarded");
    document.documentElement.classList.remove("is-tour-transition-boot");
    active = null;
    dispatch("complete", run);
    // A successful, stable compositor frame resets the bounded document-level
    // WebGL recovery allowance. Keeping the marker would make a later,
    // unrelated context loss look like a reload loop.
    try {
      const stableUrl = new URL(window.location.href);
      if (stableUrl.searchParams.has("webgl-recovery")) {
        stableUrl.searchParams.delete("webgl-recovery");
        history.replaceState(history.state, "", stableUrl.href);
      }
    } catch {
      // Static file previews can deny History API writes; readiness remains valid.
    }
  }

  function reload(run) {
    if (active?.token !== run.token || run.retryCount >= maximumRetries) return false;
    run.retryCount += 1;
    run.loadedAt = 0;
    run.viewerLoadAt = 0;
    run.readiness = "retrying";
    run.attemptStartedAt = Math.max(0, performance.now() - 100);
    resetTileAttempt(run, true);
    run.baseRequested.clear();
    run.baseLoaded.clear();
    run.baseFailed.clear();
    run.basePending.clear();
    run.baseImages = [];
    updateBaseProgress(run);
    preloadTargetBaseTiles(run);
    phase = "recovering";
    dispatch("recovering", run);
    try {
      const pitch = viewer?.getPitch?.() ?? "same";
      const yaw = viewer?.getYaw?.() ?? "same";
      const hfov = viewer?.getHfov?.() ?? "same";
      viewer?.loadScene?.(run.sceneId, pitch, yaw, hfov);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleDocumentContextRecovery(run) {
    if (contextRecoveryScheduled) return;
    contextRecoveryScheduled = true;
    const recoveryUrl = new URL(window.location.href);
    const previousAttempts = Number(recoveryUrl.searchParams.get("webgl-recovery") || "0");
    if (!Number.isFinite(previousAttempts) || previousAttempts >= 2) {
      phase = "fallback";
      dispatch("fallback", run);
      window.__rainDigitShowRuntimeRecovery?.(
        new Error("The 360 renderer could not recover its WebGL context."),
      );
      return;
    }
    const view = {
      pitch: viewer?.getPitch?.(),
      yaw: viewer?.getYaw?.(),
      hfov: viewer?.getHfov?.(),
    };
    recoveryUrl.searchParams.set("scene", run.sceneId);
    for (const [name, value] of Object.entries(view)) {
      if (Number.isFinite(value)) recoveryUrl.searchParams.set(name, String(value));
    }
    recoveryUrl.searchParams.set("webgl-recovery", String(previousAttempts + 1));
    // Pannellum cannot reliably rebuild an already-lost WebGL renderer on
    // physical Safari. Keep the neutral compositor guard visible, then replace
    // the document so a fresh renderer starts directly on the same scene/view.
    setTimeout(() => window.location.replace(recoveryUrl.href), 160);
  }

  function canvasMatchesRun(run) {
    const currentScene = viewer?.getScene?.();
    const canvas = shell.querySelector(".pnlm-render-container canvas");
    const canvasReady = Boolean(canvas?.isConnected && canvas.width > 0 && canvas.height > 0);
    return Boolean(currentScene === run.sceneId && canvasReady && !contextLost);
  }

  function viewerIsRenderable(run) {
    return Boolean(
      viewer?.isLoaded?.() &&
      canvasMatchesRun(run) &&
      baseAttemptIsHealthy(run)
    );
  }

  function nextPresentationTurn() {
    return new Promise((resolve) => {
      // `true` means a real compositor opportunity ran; `false` means the
      // fallback timer won because an off-screen embed suspended rAF.
      const fallback = setTimeout(() => resolve(false), 120);
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        resolve(true);
      });
    });
  }

  async function waitForPresentedCanvas(run) {
    let receivedPresentationFrame = false;
    for (let frame = 0; frame < presentationFrameCount; frame += 1) {
      receivedPresentationFrame ||= await nextPresentationTurn();
      // A browser may pause the renderer for an off-screen embed after the
      // initial safe readiness check. We still require the same mounted
      // canvas and scene, but never turn a presentation polish into a load
      // gate that can deadlock an otherwise valid portable tour.
      if (active?.token !== run.token || !canvasMatchesRun(run)) return false;
    }
    await sleep(presentationSettleDelay);
    if (active?.token !== run.token || !canvasMatchesRun(run)) return false;
    // No compositor confirmation means no release. An off-screen iframe may
    // keep the guard indefinitely; once it becomes visible, rAF resumes and
    // the same requested-scene + renderer-idle contract completes normally.
    // Treating a suspended compositor as success exposed partial desktop
    // tiles and made automated viewport emulation disagree with real Chrome.
    return receivedPresentationFrame && viewerIsRenderable(run);
  }

  async function waitUntilRenderable(run) {
    while (active?.token === run.token) {
      const mountedSelectedScene = Boolean(viewer?.isLoaded?.() && canvasMatchesRun(run));
      if (mountedSelectedScene) {
        run.viewerLoadAt ||= performance.now();
        run.loadedAt ||= performance.now();
        run.readiness = "viewer-canvas-arming";
        if (performance.now() - run.loadedAt >= renderSettleDelay) {
          run.readiness = "viewer-canvas-presenting";
          if (await waitForPresentedCanvas(run)) {
            run.readiness = "viewer-canvas-settled";
            void markReady(run);
            return;
          }
          run.loadedAt = 0;
        }
      } else {
        run.loadedAt = 0;
      }
      const tileRetryDelay = tileFailureRetryDelays[
        Math.min(run.retryCount, tileFailureRetryDelays.length - 1)
      ];
      if (
        run.baseFailed.size > 0 &&
        run.basePending.size === 0 &&
        performance.now() - run.tileLastFailureAt >= tileRetryDelay
      ) {
        if (!reload(run)) {
          phase = "fallback";
          dispatch("fallback", run);
          return;
        }
        void waitUntilRenderable(run);
        return;
      }
      if (viewer && run.attemptStartedAt && performance.now() - run.attemptStartedAt >= retryDelay) {
        if (!reload(run)) {
          phase = "fallback";
          dispatch("fallback", run);
          return;
        }
        void waitUntilRenderable(run);
        return;
      }
      await sleep(pollInterval);
    }
  }

  function attach(nextViewer) {
    if (viewer || !nextViewer) return;
    viewer = nextViewer;
    const canvas = shell.querySelector(".pnlm-render-container canvas");
    canvas?.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      const sceneId = viewer?.getScene?.() || config.firstScene;
      const run = active || guard(sceneId, sequence === 0);
      phase = "recovering";
      dispatch("context-lost", run);
      scheduleDocumentContextRecovery(run);
    });
    canvas?.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      const run = active;
      if (run) dispatch("context-restored", run);
    });
    // `primeInitial()` has owned first paint since tour-transition loaded.
    // Reusing that run prevents the visible canvas → loader → canvas race.
    if (active?.initial) active.attemptStartedAt ||= Math.max(0, performance.now() - 500);
    else guard(viewer.getScene?.() || requestedScene(), true);
    viewer.on("scenechange", (sceneId) => {
      if (active?.sceneId === sceneId || (!active && lastStableSceneId === sceneId)) return;
      guard(sceneId, false);
    });
    viewer.on("load", () => {
      if (!active) return;
      active.viewerLoadAt = performance.now();
      active.loadedAt = performance.now();
    });
    const armBeforeSceneReset = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (active || prearmed || !target?.closest(".nav-hotspot-anchor,.scene-card,.route-step,.floorplan-pin")) return;
      // Arm the existing stable frame before Pannellum synchronously clears
      // its canvas. The following scenechange adopts this same overlay and
      // creates exactly one transition run for the destination scene.
      prearmed = true;
      const currentScene = lastStableSceneId || viewer?.getScene?.() || config.firstScene;
      firstFrame?.style.setProperty("visibility", "hidden", "important");
      firstFrame?.style.setProperty("opacity", "0", "important");
      shell.classList.add("is-transition-guarded");
      document.documentElement.classList.remove("is-tour-ready");
      document.documentElement.classList.add("is-tour-transition-boot");
      activateGuard(false, currentScene);
      overlay.dataset.sourceScene = currentScene;
      overlay.dataset.targetScene = currentScene;
    };
    const resumeFallback = () => {
      if (phase !== "fallback" || !active) return;
      active.retryCount = 0;
      if (reload(active)) void waitUntilRenderable(active);
    };
    shell.addEventListener("pointerdown", armBeforeSceneReset, true);
    shell.addEventListener("pointerdown", resumeFallback, true);
    addEventListener("online", resumeFallback);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resumeFallback();
    });
  }

  document.documentElement.dataset.tourSceneTransition = "target-base-progressive-v4";
  document.documentElement.dataset.tourWebglReadback = "disabled";
  const primeInitial = () => active || guard(requestedScene(), true);
  window.__rainDigitTourTransition = {
    attach,
    primeInitial,
    state: () => ({
      variant: "target-base-progressive",
      phase,
      initial: active?.initial ?? false,
      patchCount: 0,
      sequence,
      sceneId: active?.sceneId || viewer?.getScene?.() || null,
      sourceSceneId: active?.sourceSceneId || lastStableSceneId,
      targetSceneId: active?.sceneId || viewer?.getScene?.() || null,
      retryCount: active?.retryCount || 0,
      tileAttempt: active?.tileAttempt || 0,
      tileRequested: active?.tileRequested || 0,
      tileLoaded: active?.tileLoaded || 0,
      tileFailed: active?.tileFailed || 0,
      tilePending: active?.tilePending || 0,
      baseRequired: baseFaces.length,
      baseRequested: active?.baseRequested.size || 0,
      baseLoaded: active?.baseLoaded.size || 0,
      baseFailed: active?.baseFailed.size || 0,
      basePending: active?.basePending.size || 0,
      detailPending: Math.max(0, (active?.tilePending || 0) - (active?.basePending.size || 0)),
      readiness: active?.readiness || "ready",
      guarded: shell.classList.contains("is-transition-guarded")
    })
  };

  function reportBootstrapOwnership() {
    if (window.parent === window) return;
    const slug = window.location.pathname.match(/\/tours\/([^/]+)\//)?.[1] || null;
    const queryOrigin = new URLSearchParams(window.location.search).get("parentOrigin");
    let targetOrigin = "*";
    try {
      targetOrigin = queryOrigin
        ? new URL(queryOrigin).origin
        : document.referrer
          ? new URL(document.referrer).origin
          : "*";
    } catch {
      targetOrigin = "*";
    }
    window.parent.postMessage(
      { type: "raindigit-tour-bootstrap", version: 1, slug },
      targetOrigin,
    );
  }

  installTileObserver();
  // This executes after tour-config.js but before tour.js constructs the
  // Pannellum canvas. The loader, not WebGL, now owns the initial paint.
  primeInitial();
  reportBootstrapOwnership();
})();
