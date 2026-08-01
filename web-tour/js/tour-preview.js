(() => {
  "use strict";

  const api = window.__TOUR_DRAFT_PREVIEW_API;
  if (!api) return;

  const workspace = new URLSearchParams(window.location.search).get("workspace") === "1";
  fetch(`__tour-preview/overrides${workspace ? "?workspace=1" : ""}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Could not load saved draft (${response.status})`)))
    .then((draft) => api.applyDraft(draft))
    .catch((error) => console.warn(error.message));
})();
