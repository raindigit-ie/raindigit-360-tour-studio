(() => {
  "use strict";

  const config = window.TOUR_MONITORING_CONFIG || {};
  const queue = [];
  const fingerprints = new Set();
  const queueLimit = 20;
  const fingerprintLimit = 50;
  let sdkPromise = null;
  let sdk = null;
  let currentSceneId = null;

  function currentOriginIsAllowed() {
    return Boolean(
      config.enabled === true &&
        typeof config.dsn === "string" &&
        config.dsn.length > 0 &&
        Array.isArray(config.productionOrigins) &&
        config.productionOrigins.includes(window.location.origin),
    );
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), document.baseURI);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "invalid-url";
    }
  }

  function safeText(value, maximum = 240) {
    return String(value ?? "")
      .replace(/https?:\/\/[^\s)\]}]+/gi, (url) => safeUrl(url))
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
      .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maximum);
  }

  function safeValue(value, depth = 0) {
    if (depth > 2 || value == null) return null;
    if (typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return safeText(value);
    if (Array.isArray(value)) return value.slice(0, 10).map((item) => safeValue(item, depth + 1));
    if (typeof value !== "object") return safeText(value);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/cookie|authorization|password|token|secret|email|phone|input|body/i.test(key))
        .slice(0, 20)
        .map(([key, item]) => [safeText(key, 48), safeValue(item, depth + 1)]),
    );
  }

  function embedHost() {
    try {
      return document.referrer ? new URL(document.referrer).hostname : "direct";
    } catch {
      return "unknown";
    }
  }

  function packageVersion() {
    return window.location.pathname.match(/\/(?:legacy|multires)-[a-f0-9]{8,64}\//)?.[0]?.slice(1, -1) || "unknown";
  }

  function errorFrom(value, fallback) {
    if (value instanceof Error) return value;
    const message = safeText(value?.message || value || fallback) || fallback;
    const error = new Error(message);
    error.name = safeText(value?.name || "TourRuntimeError", 80);
    return error;
  }

  function sanitizeEvent(event) {
    if (!currentOriginIsAllowed()) return null;
    const next = { ...event };
    if (next.request) {
      next.request = { ...next.request, url: safeUrl(next.request.url || window.location.href) };
      delete next.request.cookies;
      delete next.request.data;
      delete next.request.headers;
      delete next.request.query_string;
    }
    if (next.user) delete next.user;
    if (next.breadcrumbs) delete next.breadcrumbs;
    if (next.contexts) next.contexts = safeValue(next.contexts);
    if (next.extra) next.extra = safeValue(next.extra);
    if (next.tags) next.tags = safeValue(next.tags);
    for (const exception of next.exception?.values || []) {
      exception.value = safeText(exception.value, 500);
      for (const frame of exception.stacktrace?.frames || []) {
        if (frame.filename) frame.filename = safeUrl(frame.filename);
        delete frame.vars;
      }
    }
    return next;
  }

  function initializeSdk(adapter) {
    adapter.init({
      dsn: config.dsn,
      environment: "production",
      release: config.release,
      dist: packageVersion(),
      defaultIntegrations: false,
      autoSessionTracking: false,
      sendClientReports: false,
      enableLogs: false,
      tracesSampleRate: 0,
      sampleRate: 1,
      maxBreadcrumbs: 0,
      attachStacktrace: true,
      sendDefaultPii: false,
      beforeSend: sanitizeEvent,
      initialScope: {
        tags: {
          product: "raindigit-360-tour",
          tour_slug: safeText(config.slug, 96),
          tour_version: safeText(config.tourVersion, 32),
          runtime_version: safeText(config.runtimeVersion, 32),
          studio_version: safeText(config.studioVersion, 32),
          package_version: packageVersion(),
          embed_host: embedHost(),
        },
      },
    });
  }

  function loadSdk() {
    if (!currentOriginIsAllowed()) return Promise.resolve(null);
    if (sdk) return Promise.resolve(sdk);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      const configuredSource = String(config.sdkUrl || "js/generated/sentry-browser-10.71.0.min.js");
      script.src = configuredSource.startsWith("data:") ? configuredSource : safeUrl(configuredSource);
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        const adapter = window.__rainDigitSentrySdk;
        if (!adapter?.init || !adapter?.captureException) {
          resolve(null);
          return;
        }
        try {
          initializeSdk(adapter);
          sdk = adapter;
          resolve(adapter);
        } catch {
          resolve(null);
        }
      };
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
    return sdkPromise;
  }

  function fingerprintFor(kind, error, context) {
    return [kind, error.name, error.message, context?.sceneId || currentSceneId || "unknown"].map((value) => safeText(value, 120)).join("|");
  }

  async function flush() {
    const adapter = await loadSdk();
    if (!adapter) return;
    while (queue.length) {
      const item = queue.shift();
      try {
        adapter.captureException(item.error, {
          level: "error",
          fingerprint: ["{{ default }}", item.kind, item.sceneId || "unknown"],
          tags: {
            failure_class: item.kind,
            scene_id: item.sceneId || "unknown",
            transition_phase: item.phase || "unknown",
          },
          contexts: { tour: item.context },
        });
      } catch {
        // Monitoring must never alter the tour's recovery path.
      }
    }
  }

  function captureTerminal(kind, value, context = {}) {
    if (!currentOriginIsAllowed()) return false;
    const error = errorFrom(value, "Tour runtime failure");
    const sceneId = safeText(context.sceneId || currentSceneId || "unknown", 96);
    const fingerprint = fingerprintFor(kind, error, { sceneId });
    if (fingerprints.has(fingerprint)) return false;
    if (fingerprints.size >= fingerprintLimit) fingerprints.clear();
    fingerprints.add(fingerprint);
    if (queue.length >= queueLimit) queue.shift();
    queue.push({
      kind: safeText(kind || "runtime-error", 64),
      error,
      sceneId,
      phase: safeText(context.phase || "unknown", 64),
      context: safeValue({
        ...context,
        sceneId,
        packageVersion: packageVersion(),
        embedHost: embedHost(),
      }),
    });
    void flush();
    return true;
  }

  function setScene(sceneId) {
    currentSceneId = safeText(sceneId || "unknown", 96);
  }

  addEventListener("error", (event) => {
    if (event.error) {
      captureTerminal("uncaught-error", event.error, { sceneId: currentSceneId });
      return;
    }
    const target = event.target;
    if (target instanceof HTMLScriptElement && /\/js\/(?:tour-|pannellum)/.test(target.src)) {
      captureTerminal("runtime-script-failure", new Error(`Could not load ${safeUrl(target.src)}`), {
        asset: safeUrl(target.src),
        sceneId: currentSceneId,
      });
    }
  }, true);
  addEventListener("unhandledrejection", (event) => {
    captureTerminal("unhandled-rejection", event.reason, { sceneId: currentSceneId });
  });

  window.__rainDigitTourMonitoring = Object.freeze({
    captureTerminal,
    enabled: currentOriginIsAllowed,
    setScene,
  });
})();
