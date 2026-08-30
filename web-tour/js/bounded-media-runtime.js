(() => {
  "use strict";

  const sceneStates = new Map();
  const baseRetryDelays = [0, 1_500, 3_000];

  function emit(event, details = {}) {
    document.dispatchEvent(new CustomEvent("raindigit:bounded-media", {
      detail: { event, details },
    }));
  }

  function sceneFor(sceneId) {
    return (window.TOUR_CONFIG?.scenes || []).find((scene) => scene.id === sceneId) || null;
  }

  function mediaFor(sceneId) {
    const media = sceneFor(sceneId)?.boundedMedia;
    return media && media.deliveryCapability === "bounded-media-v1" ? media : null;
  }

  function stateFor(sceneId) {
    if (!sceneStates.has(sceneId)) {
      sceneStates.set(sceneId, {
        basePromise: null,
        baseAttempts: 0,
        fallbackAttempts: 0,
        baseExhausted: false,
        canvas: null,
        baseReady: false,
        fallbackReady: false,
        recoveryMode: null,
        detailPromise: null,
        detailAttempts: 0,
        detailRole: null,
        detailReady: false,
        detailFailed: false,
      });
    }
    return sceneStates.get(sceneId);
  }

  function sourceUrl(source, attempt = 1) {
    const url = new URL(source, document.baseURI);
    if (attempt > 1) url.searchParams.set("bounded-media-retry", String(attempt));
    return url.href;
  }

  function releaseImage(image) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
  }

  function loadDecodedImage(source, role, attempt = 1) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = role === "base" ? "high" : "low";
      image.onload = async () => {
        if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
          releaseImage(image);
          reject(new Error(`Bounded-media ${role} image has no intrinsic dimensions.`));
          return;
        }
        try {
          await image.decode?.();
        } catch {
          // A Safari decode rejection after load is not a failure when the
          // browser reports a non-empty image and drawImage accepts it.
        }
        resolve(image);
      };
      image.onerror = () => {
        releaseImage(image);
        reject(new Error(`Bounded-media ${role} image failed to load.`));
      };
      try {
        image.src = sourceUrl(source, attempt);
      } catch (error) {
        releaseImage(image);
        reject(error);
      }
    });
  }

  function canvasFromImage(image) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Bounded-media canvas context is unavailable.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      // The decoded pixels now live in the canvas. Do not retain a second
      // full-resolution Image while Pannellum owns the dynamic canvas.
      releaseImage(image);
    }
  }

  function isBoundedScene(sceneId) {
    return Boolean(mediaFor(sceneId));
  }

  async function loadCanvasWithRetries(source, role, state, sceneId) {
    let lastError = null;
    for (let index = 0; index < baseRetryDelays.length; index += 1) {
      const attempt = index + 1;
      if (baseRetryDelays[index] > 0) await new Promise((resolve) => setTimeout(resolve, baseRetryDelays[index]));
      if (role === "base") state.baseAttempts = attempt;
      else if (role === "fallback") state.fallbackAttempts = attempt;
      else state.detailAttempts = attempt;
      emit("image-attempt", { sceneId, role, attempt, path: source });
      try {
        return canvasFromImage(await loadDecodedImage(source, role, attempt));
      } catch (error) {
        lastError = error;
        emit("image-attempt-failed", { sceneId, role, attempt, path: source, message: error.message });
      }
    }
    throw lastError || new Error(`Bounded-media ${role} image exhausted its retry budget.`);
  }

  async function prepareScene(sceneId) {
    const media = mediaFor(sceneId);
    if (!media) return null;
    const state = stateFor(sceneId);
    if (state.canvas) return state.canvas;
    if (state.basePromise) return state.basePromise;
    state.basePromise = (async () => {
      try {
        const canvas = await loadCanvasWithRetries(media.base, "base", state, sceneId);
        state.canvas = canvas;
        state.baseReady = true;
        state.recoveryMode = "base";
        emit("base-ready", { sceneId, path: media.base, width: canvas.width, height: canvas.height, attempts: state.baseAttempts });
        return canvas;
      } catch (baseError) {
        state.baseExhausted = true;
        emit("base-exhausted", { sceneId, path: media.base, attempts: state.baseAttempts, message: baseError.message });
        // A fallback is a bounded recovery result, not a silent base success.
        // It is attempted only after the base retry budget is exhausted.
        try {
          const fallbackCanvas = await loadCanvasWithRetries(media.fallback, "fallback", state, sceneId);
          state.canvas = fallbackCanvas;
          state.fallbackReady = true;
          state.recoveryMode = "fallback";
          emit("fallback-ready", { sceneId, path: media.fallback, width: fallbackCanvas.width, height: fallbackCanvas.height });
          return fallbackCanvas;
        } catch (fallbackError) {
          const terminal = new Error(`Bounded-media recovery exhausted for ${sceneId}: ${fallbackError.message}`);
          emit("recovery-exhausted", {
            sceneId,
            basePath: media.base,
            fallbackPath: media.fallback,
            baseAttempts: state.baseAttempts,
            fallbackAttempts: state.fallbackAttempts,
            message: terminal.message,
          });
          window.__rainDigitTourMonitoring?.captureTerminal("bounded-media-recovery-exhausted", terminal, {
            sceneId,
            basePath: media.base,
            fallbackPath: media.fallback,
            baseAttempts: state.baseAttempts,
            fallbackAttempts: state.fallbackAttempts,
          });
          window.__rainDigitShowRuntimeRecovery?.(terminal);
          throw terminal;
        }
      }
    })().catch((error) => {
      state.basePromise = null;
      state.baseReady = false;
      throw error;
    });
    return state.basePromise;
  }

  function configureScene(sceneConfig, sceneId, canvas) {
    const media = mediaFor(sceneId);
    if (!media || !canvas || !sceneConfig) return false;
    sceneConfig.type = "equirectangular";
    sceneConfig.panorama = canvas;
    sceneConfig.dynamic = true;
    // Pannellum only initializes a dynamic equirectangular scene when
    // dynamicUpdate is enabled. The tour runtime disables continuous updates
    // immediately after the first renderer load, then re-enables them only
    // for the one-frame detail replacement.
    sceneConfig.dynamicUpdate = true;
    sceneConfig.boundedMedia = media;
    return true;
  }

  function isWebKit() {
    const userAgent = navigator.userAgent || "";
    const chromiumFamily = /Chrome|Chromium|CriOS|FxiOS|Edg|OPR/i.test(userAgent);
    return /AppleWebKit/i.test(userAgent) && !chromiumFamily;
  }

  function useMobileDetail() {
    return isWebKit() || matchMedia("(max-width: 760px)").matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  }

  function detailRoleFor() {
    return useMobileDetail() ? "mobile-detail" : "desktop-detail";
  }

  function detailPathFor(media, role) {
    return role === "mobile-detail" ? media.mobileDetail : media.desktopDetail;
  }

  async function upgrade(viewer, sceneId) {
    const media = mediaFor(sceneId);
    const state = stateFor(sceneId);
    if (!media || !state.canvas || !viewer || viewer.getScene?.() !== sceneId) return false;
    if (state.detailReady || state.detailFailed) return state.detailReady;
    if (state.detailPromise) return state.detailPromise;
    const role = detailRoleFor();
    const path = detailPathFor(media, role);
    state.detailRole = role;
    state.detailPromise = (async () => {
      const image = await loadDecodedImage(path, role);
      if (viewer.getScene?.() !== sceneId || !state.canvas) {
        releaseImage(image);
        return false;
      }
      const view = {
        pitch: viewer.getPitch?.(),
        yaw: viewer.getYaw?.(),
        hfov: viewer.getHfov?.(),
      };
      const canvas = state.canvas;
      // Resize the same canvas before drawing. Keeping 2048 here would make
      // both the 4096 mobile and 8192 desktop detail variants underresolve.
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        releaseImage(image);
        throw new Error("Bounded-media canvas context disappeared.");
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      releaseImage(image);
      // Pannellum's supported dynamic equirectangular path: the canvas object
      // identity is stable while its pixels and dimensions are replaced.
      viewer.setUpdate?.(true);
      viewer.updateOnce?.();
      viewer.setUpdate?.(false);
      if ([view.pitch, view.yaw, view.hfov].every(Number.isFinite)) {
        viewer.lookAt?.(view.pitch, view.yaw, view.hfov, 0);
      }
      state.detailReady = true;
      emit("detail-upgraded", {
        sceneId,
        role,
        path,
        width: canvas.width,
        height: canvas.height,
        sameCanvas: viewer.getConfig?.()?.panorama === canvas,
        view,
      });
      return true;
    })().catch((error) => {
      state.detailFailed = true;
      // Detail is non-terminal: the already-usable base/fallback remains
      // visible and the transition guard is never re-opened.
      emit("detail-failed", { sceneId, role, path, message: error.message });
      return false;
    });
    return state.detailPromise;
  }

  window.__rainDigitBoundedMediaRuntime = Object.freeze({
    isBoundedScene,
    prepareScene,
    configureScene,
    upgrade,
    isWebKit,
    state: (sceneId) => {
      const state = stateFor(sceneId);
      return {
        baseReady: state.baseReady,
        baseAttempts: state.baseAttempts,
        fallbackAttempts: state.fallbackAttempts,
        baseExhausted: state.baseExhausted,
        fallbackReady: state.fallbackReady,
        recoveryMode: state.recoveryMode,
        detailRole: state.detailRole,
        detailReady: state.detailReady,
        detailFailed: state.detailFailed,
        canvas: state.canvas,
      };
    },
  });
})();
