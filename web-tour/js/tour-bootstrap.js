(() => {
  "use strict";

  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  const query = new URLSearchParams(window.location.search);
  const local = localHosts.has(window.location.hostname);
  const editing = local && query.get("edit") === "1";
  const previewing = local && query.get("preview") === "1";
  const framePicking = local && query.get("frame-picker") === "1";
  const endpoint = editing || framePicking ? "__tour-editor" : previewing ? "__tour-preview" : null;
  const workspace = endpoint && query.get("workspace") === "1";
  document.documentElement.dataset.tourWebglBuffer = "default";

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
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
    await loadScript("js/pannellum.js?v=20260802-wizard-v1");
    if (framePicking) {
      await loadScript("js/frame-picker.js?v=20260811-frame-picker-v1");
      return;
    }
    await loadScript(workspace
      ? `/${endpoint}/workspace-config.js?workspace=1`
      : "js/tour-config.js?v=20260802-wizard-v1");
    await loadScript("js/tour-transition.js?v=20260827-safari-decode-v2");
    await loadScript("js/tour.js?v=20260815-capture-view-v2");
    if (editing) {
      await loadScript("js/generated/editor-walking-button-list.js?v=20260810-svelte-route-thumbs-v1");
      await loadScript("js/tour-editor.js?v=20260815-polish-stage-resize-v1");
    }
    if (previewing) await loadScript("js/tour-preview.js?v=20260802-wizard-v1");
  })().catch(showRuntimeRecovery);
})();
