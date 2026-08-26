import { createHash } from "node:crypto";
import vm from "node:vm";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(4)) : null;
}

export function parseTourConfig(source, label = "tour-config.js") {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: label });
  if (!Array.isArray(context.window.TOUR_CONFIG?.scenes))
    throw new Error(`${label}: window.TOUR_CONFIG.scenes is missing.`);
  return context.window.TOUR_CONFIG;
}

export function tourGraphIdentity(config) {
  const scenes = config.scenes
    .map((scene) => ({
      id: scene.id,
      openingView: {
        pitch: number(scene.pitch),
        yaw: number(scene.yaw),
        hfov: number(scene.hfov)
      },
      hotspots: (scene.hotspots ?? []).map((hotspot, index) => ({
        index,
        kind: hotspot.kind ?? null,
        pitch: number(hotspot.pitch),
        yaw: number(hotspot.yaw),
        target: hotspot.target,
        targetPitch: number(hotspot.targetPitch),
        targetYaw: number(hotspot.targetYaw),
        targetHfov: number(hotspot.targetHfov)
      }))
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const arrivalViews = scenes.flatMap((scene) =>
    scene.hotspots.map((hotspot) => ({
      source: scene.id,
      index: hotspot.index,
      target: hotspot.target,
      targetPitch: hotspot.targetPitch,
      targetYaw: hotspot.targetYaw,
      targetHfov: hotspot.targetHfov
    }))
  );
  return {
    firstScene: config.firstScene,
    sceneCount: scenes.length,
    hotspotCount: arrivalViews.length,
    savedArrivalViewCount: arrivalViews.filter(
      (view) => view.targetPitch !== null && view.targetYaw !== null && view.targetHfov !== null
    ).length,
    sceneGraphDigest: digest({ firstScene: config.firstScene, scenes }),
    savedArrivalViewsDigest: digest(arrivalViews)
  };
}
