#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  injectTourMonitoringConfig,
  defaultProductionTourOrigins,
  productionTourMonitoringEnvironment,
  productionTourSentryDsn,
  productionOriginsFromEnvironment,
  tourMonitoringConfig,
} from "./lib/tour-monitoring-contract.mjs";
import { releaseIdentity } from "./lib/release-contract.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(run, message) {
  try {
    run();
  } catch {
    return;
  }
  throw new Error(message);
}

function testContract() {
  const identity = releaseIdentity({});
  const disabled = tourMonitoringConfig({
    identity,
    slug: "test-tour",
    environment: {},
  });
  assert(
    disabled.enabled === false && disabled.dsn === "",
    "A build without a DSN must stay inert.",
  );
  const defaults = productionTourMonitoringEnvironment({});
  const productionDefault = tourMonitoringConfig({
    identity,
    slug: "test-tour",
    environment: defaults,
  });
  assert(
    productionDefault.enabled === true &&
      productionDefault.dsn === productionTourSentryDsn &&
      JSON.stringify(productionDefault.productionOrigins) ===
        JSON.stringify(defaultProductionTourOrigins),
    "The canonical production package defaults did not enable exact-origin monitoring.",
  );
  expectThrow(
    () =>
      tourMonitoringConfig({
        identity,
        slug: "test-tour",
        environment: {
          RAINDIGIT_TOUR_SENTRY_DSN: "https://key@o1.ingest.sentry.io/123",
        },
      }),
    "A DSN without exact production origins was accepted.",
  );
  expectThrow(
    () =>
      productionOriginsFromEnvironment({
        RAINDIGIT_TOUR_SENTRY_ORIGINS: "https://*.example.com",
      }),
    "A wildcard production origin was accepted.",
  );
  expectThrow(
    () =>
      tourMonitoringConfig({
        identity,
        slug: "test-tour",
        environment: {
          RAINDIGIT_TOUR_SENTRY_DSN:
            "https://public-key@o1.ingest.sentry.io/123",
          RAINDIGIT_TOUR_SENTRY_ORIGINS: "https://tours.customer.example",
        },
      }),
    "An unlisted customer origin was accepted.",
  );
  const enabled = tourMonitoringConfig({
    identity,
    slug: "test-tour",
    environment: {
      RAINDIGIT_TOUR_SENTRY_DSN: "https://public-key@o1.ingest.sentry.io/123",
      RAINDIGIT_TOUR_SENTRY_ORIGINS: "https://cdn.raindigit.ie",
    },
  });
  assert(
    enabled.enabled && enabled.productionOrigins.length === 1,
    "Valid production monitoring was not enabled.",
  );
  const injected = injectTourMonitoringConfig(
    "<script data-tour-monitoring-config>old</script>",
    { ...enabled, slug: "</script><script>alert(1)</script>" },
  );
  assert(
    !injected.includes("</script><script>alert"),
    "Monitoring config can break out of its script element.",
  );
}

async function testBrowserRuntime() {
  const monitor = await readFile(
    join(projectRoot, "web-tour", "js", "generated", "tour-monitoring.min.js"),
    "utf8",
  );
  const sdkStub = `window.__rainDigitCaptured=[];window.__rainDigitSentrySdk={init:(options)=>{window.__rainDigitSentryOptions=options},captureException:(error,hint)=>{window.__rainDigitCaptured.push({name:error.name,message:error.message,hint});return "event-id"}};`;
  const config = {
    schema: "raindigit-tour-monitoring/v1",
    enabled: true,
    dsn: "https://public-key@o1.ingest.sentry.io/123",
    environment: "production",
    productionOrigins: ["https://cdn.raindigit.ie"],
    sdkUrl: "/js/generated/sdk.js",
    release: "raindigit-tour-runtime@2.0.9",
    studioVersion: "0.2.9",
    runtimeVersion: "2.0.9",
    tourVersion: "0.2.9",
    slug: "test-tour",
  };
  const html = `<!doctype html><html><head><script>window.TOUR_MONITORING_CONFIG=${JSON.stringify(config)}</script><script src="/js/tour-monitoring.js"></script></head><body><main class="tour-shell"></main></body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    let sdkRequests = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/js/tour-monitoring.js") {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: monitor,
        });
      } else if (url.pathname === "/js/generated/sdk.js") {
        sdkRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: sdkStub,
        });
      } else if (url.pathname.startsWith("/tiles/")) {
        await route.fulfill({ status: 404, body: "missing" });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html,
        });
      }
    });

    const productionPage = await context.newPage();
    await productionPage.goto(
      "https://cdn.raindigit.ie/tours/test-tour/multires-deadbeef0000/index.html?signed=secret#private",
    );
    await productionPage.waitForFunction(() =>
      Boolean(window.__rainDigitTourMonitoring),
    );
    assert(
      sdkRequests === 0,
      "The Sentry SDK was requested during a healthy production boot.",
    );
    await productionPage.evaluate(() => {
      const image = new Image();
      image.src = "/tiles/f.jpg?signature=secret";
      document.body.append(image);
    });
    await productionPage.waitForTimeout(100);
    assert(sdkRequests === 0, "An individual tile failure loaded Sentry.");

    const accepted = await productionPage.evaluate(() =>
      window.__rainDigitTourMonitoring.captureTerminal(
        "scene-transition-failure",
        new Error("Failed https://cdn.raindigit.ie/tile.webp?token=secret"),
        { sceneId: "scene-003", phase: "fallback", retryCount: 3 },
      ),
    );
    assert(accepted === true, "A terminal production failure was rejected.");
    await productionPage.waitForFunction(
      () => window.__rainDigitCaptured?.length === 1,
    );
    assert(
      sdkRequests === 1,
      "The Sentry SDK was not loaded exactly once after a terminal failure.",
    );
    const evidence = await productionPage.evaluate(() => {
      const options = window.__rainDigitSentryOptions;
      const sanitized = options.beforeSend({
        request: {
          url: "https://cdn.raindigit.ie/tour/?token=secret#fragment",
          headers: { authorization: "secret" },
          cookies: "secret",
          query_string: "token=secret",
        },
        user: { email: "private@example.com" },
        breadcrumbs: [{ message: "secret" }],
        contexts: {
          tour: {
            token: "secret",
            phone: "+353 87 123 4567",
            sceneId: "scene-003",
          },
        },
        exception: {
          values: [
            {
              value: "Bad https://example.com/a?token=secret",
              stacktrace: {
                frames: [
                  {
                    filename: "https://cdn.raindigit.ie/app.js?token=secret",
                    vars: { token: "secret" },
                  },
                ],
              },
            },
          ],
        },
      });
      const duplicate = window.__rainDigitTourMonitoring.captureTerminal(
        "scene-transition-failure",
        new Error("Failed https://cdn.raindigit.ie/tile.webp?token=secret"),
        { sceneId: "scene-003", phase: "fallback", retryCount: 3 },
      );
      return {
        options,
        sanitized,
        duplicate,
        captured: window.__rainDigitCaptured,
      };
    });
    assert(
      evidence.options.defaultIntegrations === false,
      "Default Sentry browser integrations were enabled.",
    );
    assert(
      evidence.options.tracesSampleRate === 0 &&
        evidence.options.sendDefaultPii === false,
      "Privacy or quota controls are incomplete.",
    );
    assert(
      evidence.sanitized.user == null && evidence.sanitized.breadcrumbs == null,
      "PII-bearing Sentry fields were retained.",
    );
    assert(
      !JSON.stringify(evidence.sanitized).includes("secret"),
      "A URL query, cookie, header or frame variable survived redaction.",
    );
    assert(
      evidence.duplicate === false && evidence.captured.length === 1,
      "Duplicate terminal failures were not collapsed.",
    );

    const devPage = await context.newPage();
    await devPage.goto(
      "https://pub-example.r2.dev/tours/test-tour/multires-deadbeef0000/index.html",
    );
    await devPage.waitForFunction(() =>
      Boolean(window.__rainDigitTourMonitoring),
    );
    const devAccepted = await devPage.evaluate(() =>
      window.__rainDigitTourMonitoring.captureTerminal(
        "scene-transition-failure",
        new Error("development failure"),
        { sceneId: "scene-003" },
      ),
    );
    await devPage.waitForTimeout(100);
    assert(
      devAccepted === false && sdkRequests === 1,
      "A DEV/R2 origin consumed production monitoring.",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

async function testRuntimeRevisionWiring() {
  const source = await readFile(
    join(projectRoot, "scripts", "revise-multires-runtime.mjs"),
    "utf8",
  );
  assert(
    source.includes('currentIndex.includes("data-tour-monitoring-config")') &&
      source.includes('currentIndex.includes("js/tour-monitoring.js")') &&
      source.includes('stat(join(stagedRelease, "js", "tour-monitoring.js"))'),
    "Runtime-only fleet revisions can silently omit canonical production monitoring.",
  );
}

testContract();
await testRuntimeRevisionWiring();
await testBrowserRuntime();
console.log(
  "Production-only tour monitoring passed: exact-origin gate, lazy SDK, tile suppression, redaction and dedupe.",
);
