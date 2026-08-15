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

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${source}`));
      document.body.appendChild(script);
    });
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
    await loadScript("js/tour.js?v=20260802-wizard-v1");
    if (editing) {
      await loadScript("js/generated/editor-walking-button-list.js?v=20260810-svelte-route-thumbs-v1");
      await loadScript("js/tour-editor.js?v=20260815-space-order-v1");
    }
    if (previewing) await loadScript("js/tour-preview.js?v=20260802-wizard-v1");
  })().catch((error) => {
    console.error(error);
    document.body.dataset.tourError = "true";
  });
})();
