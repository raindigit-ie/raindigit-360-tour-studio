(() => {
  "use strict";

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
    await loadScript("js/pannellum.js");
    await loadScript("js/tour-config.js");
    await loadScript("js/tour.js");
  })().catch((error) => {
    console.error(error);
    document.body.dataset.tourError = "true";
  });
})();
