import { readFile, writeFile } from "node:fs/promises";

export const monitoringConfigMarker = "data-tour-monitoring-config";
export const sentryBrowserBundle = "js/generated/sentry-browser-10.71.0.min.js";
export const tourMonitoringRuntimeBundle = "js/generated/tour-monitoring.min.js";
// Public Sentry DSNs identify an ingest project; they are intentionally safe to
// ship in browser code. Keeping the canonical production defaults beside the
// release contract prevents a direct/package build from silently omitting
// monitoring. Exact-origin gating still makes DEV and preview packages inert.
export const productionTourSentryDsn =
  "https://9c1ec205549003af8e3712b5da9ad065@o4511984520462336.ingest.de.sentry.io/4511985294901328";
export const defaultProductionTourOrigins = Object.freeze([
  "https://cdn.raindigit.ie",
]);

export function productionTourMonitoringEnvironment(environment = process.env) {
  return {
    ...environment,
    RAINDIGIT_TOUR_SENTRY_DSN:
      String(environment.RAINDIGIT_TOUR_SENTRY_DSN || "").trim() ||
      productionTourSentryDsn,
    RAINDIGIT_TOUR_SENTRY_ORIGINS:
      String(environment.RAINDIGIT_TOUR_SENTRY_ORIGINS || "").trim() ||
      defaultProductionTourOrigins.join(","),
  };
}

function exactHttpsOrigin(value) {
  const candidate = new URL(String(value || "").trim());
  if (
    candidate.protocol !== "https:" ||
    candidate.username ||
    candidate.password ||
    candidate.pathname !== "/" ||
    candidate.search ||
    candidate.hash
  ) {
    throw new Error(`Tour monitoring origin must be an exact HTTPS origin: ${value}`);
  }
  return candidate.origin;
}

function publicSentryDsn(value) {
  const candidate = new URL(String(value || "").trim());
  if (
    candidate.protocol !== "https:" ||
    candidate.password ||
    !candidate.username ||
    !candidate.hostname ||
    !/^\/[0-9]+\/?$/.test(candidate.pathname)
  ) {
    throw new Error("RAINDIGIT_TOUR_SENTRY_DSN must be a public HTTPS Sentry DSN.");
  }
  candidate.search = "";
  candidate.hash = "";
  return candidate.href;
}

export function productionOriginsFromEnvironment(environment = process.env) {
  const source = String(environment.RAINDIGIT_TOUR_SENTRY_ORIGINS || "").trim();
  if (!source) return [];
  const origins = source
    .split(",")
    .map((value) => exactHttpsOrigin(value))
    .filter((value, index, values) => values.indexOf(value) === index);
  if (origins.some((origin) => origin.includes("*"))) {
    throw new Error("Tour monitoring does not permit wildcard production origins.");
  }
  return origins.sort();
}

export function tourMonitoringConfig({ identity, slug, environment = process.env }) {
  const rawDsn = String(environment.RAINDIGIT_TOUR_SENTRY_DSN || "").trim();
  const productionOrigins = productionOriginsFromEnvironment(environment);
  if (!rawDsn && productionOrigins.length) {
    throw new Error("Tour monitoring origins were supplied without RAINDIGIT_TOUR_SENTRY_DSN.");
  }
  if (rawDsn && productionOrigins.length === 0) {
    throw new Error("RAINDIGIT_TOUR_SENTRY_ORIGINS must list every exact production origin.");
  }
  const dsn = rawDsn ? publicSentryDsn(rawDsn) : "";
  return {
    schema: "raindigit-tour-monitoring/v1",
    enabled: Boolean(dsn && productionOrigins.length),
    dsn,
    environment: "production",
    productionOrigins,
    sdkUrl: sentryBrowserBundle,
    release: `raindigit-tour-runtime@${identity.runtimeVersion}`,
    studioVersion: identity.studioVersion,
    runtimeVersion: identity.runtimeVersion,
    tourVersion: identity.tourVersion,
    slug,
  };
}

export function injectTourMonitoringConfig(entrypoint, config) {
  const pattern = new RegExp(
    `<script ${monitoringConfigMarker}>[\\s\\S]*?<\\/script>`,
  );
  if (!pattern.test(entrypoint)) {
    throw new Error("Tour entrypoint is missing the monitoring configuration marker.");
  }
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return entrypoint.replace(
    pattern,
    `<script ${monitoringConfigMarker}>window.TOUR_MONITORING_CONFIG=Object.freeze(${json})</script>`,
  );
}

export async function configureTourMonitoringEntrypoint(path, config) {
  const source = await readFile(path, "utf8");
  await writeFile(path, injectTourMonitoringConfig(source, config), "utf8");
}
