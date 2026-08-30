(() => {
  "use strict";

  document.documentElement.dataset.tourWebglBuffer = "default";

  const runtimeSources = [
    "js/pannellum.js",
    "js/tour-config.js",
    "js/bounded-media-runtime.js",
    "js/tour-transition.js",
    "js/tour.js",
  ];

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      // Script-inserted external scripts default to async. Setting async to
      // false before insertion lets the browser fetch the complete set in
      // parallel while preserving the dependency order above, without a
      // second speculative preload request that can stall mobile WebKit.
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${source}`));
      document.body.appendChild(script);
    });
  }

  function showRuntimeRecovery(error) {
    console.error(error);
    window.__rainDigitTourMonitoring?.captureTerminal(
      "bootstrap-failure",
      error,
      { phase: "bootstrap" },
    );
    document.documentElement.classList.remove("is-tour-transition-boot");
    document.querySelector("[data-tour-static-loader]")?.remove();
    document.body.dataset.tourError = "true";
    if (document.querySelector("[data-tour-runtime-recovery]")) return;

    const recovery = document.createElement("button");
    recovery.type = "button";
    recovery.className = "tour-runtime-recovery";
    recovery.dataset.tourRuntimeRecovery = "true";
    recovery.textContent = "Reload tour";
    recovery.style.cssText = "position:fixed;z-index:90;left:50%;top:50%;min-height:46px;padding:12px 18px;transform:translate(-50%,-50%);border:1px solid rgba(229,185,96,.76);border-radius:999px;background:#0b0c09;color:#fff8e7;font:700 13px/1.1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 14px 42px rgba(0,0,0,.48);cursor:pointer";
    recovery.addEventListener(
      "click",
      () => {
        const retryUrl = new URL(window.location.href);
        retryUrl.searchParams.set("runtime", Date.now().toString(36));
        window.location.assign(retryUrl.href);
      },
      { once: true },
    );
    document.body.append(recovery);
  }

  (async () => {
    await Promise.all(runtimeSources.map(loadScript));
    await window.__rainDigitTourRuntimeReady;
  })().catch(showRuntimeRecovery);
})();
