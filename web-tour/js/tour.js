window.__rainDigitTourRuntimeReady = (async () => {
const { firstScene, scenes, title: tourTitle, map: configuredMap = { enabled: false, asset: null, pins: {} } } = window.TOUR_CONFIG;
const sceneById = Object.fromEntries(scenes.map((scene) => [scene.id, scene]));
const configScenes = {};
const viewParams = new URLSearchParams(window.location.search);
const requestedScene = viewParams.get("scene");
const initialScene = sceneById[requestedScene] ? requestedScene : firstScene;
const studioRuntimeContext = window.__RAINDIGIT_STUDIO_CONTEXT__ || {};
const boundedMediaRuntime = window.__rainDigitBoundedMediaRuntime || null;
const initialBoundedCanvas = boundedMediaRuntime?.isBoundedScene(initialScene)
  ? await boundedMediaRuntime.prepareScene(initialScene)
  : null;
const isLocalEditorRequest = viewParams.get("edit") === "1" &&
  (["127.0.0.1", "localhost", "::1"].includes(window.location.hostname) || studioRuntimeContext.editor === true);
const isLocalDraftPreview = viewParams.get("preview") === "1" &&
  (["127.0.0.1", "localhost", "::1"].includes(window.location.hostname) || studioRuntimeContext.preview === true);
const localEditorDefaultHfov = 94;
const defaultSceneAdjustment = Object.freeze({ brightness: 100, contrast: 100, saturation: 100, warmth: 0 });
const sceneAdjustments = Object.fromEntries(scenes.map((scene) => [scene.id, { ...defaultSceneAdjustment }]));
const adjustmentPreviewDisabled = new Set();
const localAdjustments = Object.fromEntries(scenes.map((scene) => [scene.id, []]));
const baseHotspotCounts = Object.fromEntries(scenes.map((scene) => [scene.id, scene.hotspots.length]));
const addedHotspots = Object.fromEntries(scenes.map((scene) => [scene.id, []]));
const hotspotRebuildRevisions = Object.fromEntries(scenes.map((scene) => [scene.id, 0]));

function emitTourDebug(event, details = {}) {
  document.dispatchEvent(new CustomEvent("raindigit:tour-debug", {
    detail: { event, details }
  }));
}

function navigationHotspotInventory(sceneId) {
  const scene = sceneById[sceneId];
  const configured = configScenes[sceneId]?.hotSpots || [];
  const activeSceneId = viewer?.getScene?.() || null;
  return {
    sceneId,
    activeSceneId,
    loaded: Boolean(viewer?.isLoaded?.()),
    modelIds: (scene?.hotspots || []).map((_, index) => hotspotId(sceneId, index)),
    configuredIds: configured.filter((hotspot) => !hotspot.id?.startsWith("local-adjustment::")).map((hotspot) => hotspot.id),
    domIds: activeSceneId === sceneId
      ? Array.from(document.querySelectorAll("[data-editor-hotspot-id]")).map((element) => element.dataset.editorHotspotId)
      : []
  };
}

function normaliseSceneAdjustment(adjustment = {}) {
  const clamp = (value, minimum, maximum, fallback) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(minimum, Math.min(maximum, numericValue)) : fallback;
  };
  return {
    brightness: clamp(adjustment.brightness, 70, 130, defaultSceneAdjustment.brightness),
    contrast: clamp(adjustment.contrast, 70, 130, defaultSceneAdjustment.contrast),
    saturation: clamp(adjustment.saturation, 0, 160, defaultSceneAdjustment.saturation),
    warmth: clamp(adjustment.warmth, -20, 20, defaultSceneAdjustment.warmth)
  };
}

function normaliseLocalAdjustment(adjustment = {}, index = 0) {
  const clamp = (value, minimum, maximum, fallback) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(minimum, Math.min(maximum, numericValue)) : fallback;
  };
  const color = typeof adjustment.color === "string" && /^#[0-9a-f]{6}$/i.test(adjustment.color)
    ? adjustment.color.toLowerCase()
    : "#fff1b8";
  return {
    id: typeof adjustment.id === "string" && /^[a-z0-9-]{1,40}$/i.test(adjustment.id) ? adjustment.id : `area-${index + 1}`,
    shape: adjustment.shape === "rectangle" ? "rectangle" : "ellipse",
    pitch: clamp(adjustment.pitch, -85, 85, 0),
    yaw: clamp(adjustment.yaw, -180, 180, 0),
    width: clamp(adjustment.width, 80, 720, 240),
    height: clamp(adjustment.height, 80, 520, 180),
    intensity: clamp(adjustment.intensity, -100, 100, 30),
    color
  };
}

function normaliseAddedHotspot(sceneId, hotspot = {}) {
  const target = sceneById[hotspot.target] ? hotspot.target : scenes.find((scene) => scene.id !== sceneId)?.id;
  if (!target) return null;
  const targetScene = sceneById[target];
  const clamp = (value, minimum, maximum, fallback) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(minimum, Math.min(maximum, numericValue)) : fallback;
  };
  const kind = hotspot.kind === "viewpoint" ? "viewpoint" : "doorway";
  const label = typeof hotspot.label === "string" && hotspot.label.trim()
    ? hotspot.label.trim().slice(0, 80)
    : `${kind === "viewpoint" ? "View" : "Walk"} to ${targetScene.title}`;
  return {
    kind,
    pitch: clamp(hotspot.pitch, -85, 85, 0),
    yaw: clamp(hotspot.yaw, -180, 180, 0),
    target,
    label,
    targetPitch: clamp(hotspot.targetPitch, -85, 85, targetScene.pitch),
    targetYaw: clamp(hotspot.targetYaw, -180, 180, targetScene.yaw),
    targetHfov: clamp(hotspot.targetHfov, 58, 112, targetScene.hfov),
    ...(typeof hotspot.positionConfirmed === "boolean" ? { positionConfirmed: hotspot.positionConfirmed } : {}),
    ...(typeof hotspot.arrivalConfirmed === "boolean" ? { arrivalConfirmed: hotspot.arrivalConfirmed } : {})
  };
}

function numericViewParam(name, fallback) {
  const rawValue = viewParams.get(name);
  if (rawValue === null) {
    return fallback;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function createTransitionHotspot(hotspotDiv, args) {
  const safeLabel = String(args.label || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
  hotspotDiv.classList.add("nav-hotspot-anchor");
  hotspotDiv.dataset.label = args.label;
  if (args.editorId) {
    hotspotDiv.dataset.editorHotspotId = args.editorId;
  }
  hotspotDiv.setAttribute("aria-label", args.label);
  hotspotDiv.innerHTML = `<span class="nav-hotspot nav-hotspot--doorway" data-label="${safeLabel}" aria-hidden="true"><svg class="nav-hotspot__person" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="13" cy="4.8" r="1.9" />
        <path d="m11.6 8.3 2.1 3.8 3.2 1.4" />
        <path d="m13.3 12.1-2 3.5-2.7 2.2" />
        <path d="m13.3 12.1 1.5 4.1 2.9 2.1" />
        <path d="m11.8 8.7-3.2 2.4" />
      </svg></span>`;
}

function createLocalAdjustmentOverlay(hotspotDiv, args) {
  const isLightening = args.intensity >= 0;
  hotspotDiv.classList.add("local-adjustment-anchor");
  hotspotDiv.dataset.localAdjustmentId = localAdjustmentHotspotId(args.sceneId, args.id);
  hotspotDiv.setAttribute("aria-hidden", "true");
  hotspotDiv.innerHTML = `<span class="local-adjustment-preview local-adjustment-preview--${args.shape}" aria-hidden="true"></span>`;
  const preview = hotspotDiv.firstElementChild;
  preview.style.setProperty("--area-width", `${args.width}px`);
  preview.style.setProperty("--area-height", `${args.height}px`);
  preview.style.setProperty("--area-color", args.color);
  preview.style.setProperty("--area-opacity", `${Math.abs(args.intensity) / 100}`);
  preview.style.setProperty("--area-blend", isLightening ? "screen" : "multiply");
}

function hotspotId(sceneId, hotspotIndex) {
  return `${sceneId}::${hotspotIndex}`;
}

function toPannellumHotspot(scene, hotspot, hotspotIndex) {
  const id = hotspotId(scene.id, hotspotIndex);
  return {
    id,
    pitch: hotspot.pitch,
    yaw: hotspot.yaw,
    type: "scene",
    sceneId: hotspot.target,
    targetYaw: hotspot.targetYaw,
    targetPitch: hotspot.targetPitch,
    targetHfov: hotspot.targetHfov,
    clickHandlerFunc: (_event, args) => void loadSceneSafely(args.sceneId, args.targetPitch, args.targetYaw, args.targetHfov),
    clickHandlerArgs: { sceneId: hotspot.target, targetPitch: hotspot.targetPitch, targetYaw: hotspot.targetYaw, targetHfov: hotspot.targetHfov },
    cssClass: "nav-hotspot-anchor",
    createTooltipFunc: createTransitionHotspot,
    createTooltipArgs: { label: hotspot.label, editorId: id }
  };
}

function localAdjustmentHotspotId(sceneId, adjustmentId) {
  return `local-adjustment::${sceneId}::${adjustmentId}`;
}

function toPannellumLocalAdjustment(sceneId, adjustment) {
  return {
    id: localAdjustmentHotspotId(sceneId, adjustment.id),
    pitch: adjustment.pitch,
    yaw: adjustment.yaw,
    type: "info",
    cssClass: "local-adjustment-anchor",
    createTooltipFunc: createLocalAdjustmentOverlay,
    createTooltipArgs: { ...adjustment, sceneId }
  };
}
let navigationSequence = 0;
let pendingSceneNavigation = null;
let lastSceneNavigationKey = null;
let lastSceneNavigationAt = 0;
async function loadSceneSafely(sceneId, pitch = "same", yaw = "same", hfov = "same") {
  const scene = sceneById[sceneId];
  if (!scene) return false;
  const key = [sceneId, pitch, yaw, hfov].join("|");
  if (pendingSceneNavigation?.key === key) return pendingSceneNavigation.promise;
  const now = performance.now();
  if (lastSceneNavigationKey === key && now - lastSceneNavigationAt < 500) return true;
  lastSceneNavigationKey = key;
  lastSceneNavigationAt = now;
  const requestId = ++navigationSequence;
  const promise = (async () => {
    if (boundedMediaRuntime?.isBoundedScene(sceneId)) {
      const canvas = await boundedMediaRuntime.prepareScene(sceneId);
      if (requestId !== navigationSequence) return false;
      if (!boundedMediaRuntime.configureScene(configScenes[sceneId], sceneId, canvas)) {
        throw new Error(`Could not configure bounded-media scene ${sceneId}.`);
      }
    }
    viewer.loadScene(sceneId, pitch, yaw, hfov);
    return true;
  })().catch((error) => {
    emitTourDebug("runtime-bounded-base-failure", { sceneId, message: error.message });
    const boundedState = boundedMediaRuntime?.state?.(sceneId);
    if (!boundedState?.baseExhausted) {
      window.__rainDigitTourTransition?.beginScene?.(sceneId);
    }
    return false;
  }).finally(() => {
    if (pendingSceneNavigation?.promise === promise) pendingSceneNavigation = null;
  });
  pendingSceneNavigation = { key, promise };
  return promise;
}

for (const scene of scenes) {
  configScenes[scene.id] = {
    title: scene.title,
    type: "equirectangular",
    ...(scene.boundedMedia
      ? {
          panorama: scene.id === initialScene ? initialBoundedCanvas : scene.boundedMedia.base,
          dynamic: scene.id === initialScene,
          dynamicUpdate: true,
          boundedMedia: scene.boundedMedia,
        }
      : scene.type === "multires" && scene.multiRes
        ? { type: "multires", multiRes: scene.multiRes }
        : { panorama: scene.panorama }),
    pitch: scene.pitch,
    yaw: scene.yaw,
    hfov: scene.hfov,
    hotSpots: scene.hotspots.map((hotspot, hotspotIndex) => toPannellumHotspot(scene, hotspot, hotspotIndex))
  };
}

// Direct scene/yaw URLs are a non-UI QA aid for checking each physical doorway.
configScenes[initialScene].pitch = numericViewParam("pitch", configScenes[initialScene].pitch);
configScenes[initialScene].yaw = numericViewParam("yaw", configScenes[initialScene].yaw);
configScenes[initialScene].hfov = numericViewParam("hfov", configScenes[initialScene].hfov);

const viewer = pannellum.viewer("panorama", {
  default: {
    firstScene: initialScene,
    sceneFadeDuration: 0,
    autoLoad: true,
    showFullscreenCtrl: false,
    showZoomCtrl: false,
    compass: false,
    keyboardZoom: true,
    mouseZoom: true,
    doubleClickZoom: !isLocalEditorRequest,
    hfov: localEditorDefaultHfov,
    minHfov: isLocalEditorRequest ? localEditorDefaultHfov : 58,
    maxHfov: isLocalEditorRequest ? localEditorDefaultHfov : 112
  },
  scenes: configScenes
});


function applySceneAdjustment(sceneId) {
  const adjustment = sceneAdjustments[sceneId] || defaultSceneAdjustment;
  const canvas = viewer.getContainer().querySelector(".pnlm-render-container canvas");
  if (!canvas) return;
  if (adjustmentPreviewDisabled.has(sceneId)) {
    canvas.style.filter = "none";
    return;
  }

  const warmTint = Math.max(0, adjustment.warmth) / 100;
  const coolHueShift = Math.min(18, Math.max(0, -adjustment.warmth) * 0.9);
  canvas.style.filter = `brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;
}

function setSceneAdjustmentPreview(sceneId, showOriginal) {
  if (!sceneById[sceneId]) return false;
  if (showOriginal) adjustmentPreviewDisabled.add(sceneId);
  else adjustmentPreviewDisabled.delete(sceneId);
  if (viewer.getScene() === sceneId) applySceneAdjustment(sceneId);
  return true;
}

function getSceneAdjustment(sceneId) {
  return { ...(sceneAdjustments[sceneId] || defaultSceneAdjustment) };
}

function setSceneAdjustment(sceneId, adjustment) {
  if (!sceneById[sceneId]) return false;
  sceneAdjustments[sceneId] = normaliseSceneAdjustment(adjustment);
  if (viewer.getScene() === sceneId) applySceneAdjustment(sceneId);
  return true;
}

function getLocalAdjustments(sceneId) {
  return (localAdjustments[sceneId] || []).map((adjustment) => ({ ...adjustment }));
}

function syncLocalAdjustments(sceneId, previousIds = []) {
  const sceneConfig = configScenes[sceneId];
  if (!sceneConfig) return;
  const adjustments = localAdjustments[sceneId] || [];
  if (viewer.getScene() === sceneId && !viewer.isLoaded()) {
    const navigation = sceneConfig.hotSpots.filter((hotspot) => !hotspot.id?.startsWith("local-adjustment::"));
    sceneConfig.hotSpots.splice(0, sceneConfig.hotSpots.length, ...navigation, ...adjustments.map((adjustment) => toPannellumLocalAdjustment(sceneId, adjustment)));
    return;
  }
  [...new Set([...previousIds, ...viewerElementLocalAdjustments(sceneId)])].forEach((id) => removeLiveNavigationHotspot(sceneId, id));
  adjustments.forEach((adjustment) => addLiveNavigationHotspot(sceneId, toPannellumLocalAdjustment(sceneId, adjustment)));
}

function viewerElementLocalAdjustments(sceneId) {
  return (localAdjustments[sceneId] || []).map((adjustment) => localAdjustmentHotspotId(sceneId, adjustment.id));
}

function setLocalAdjustments(sceneId, adjustments) {
  if (!sceneById[sceneId] || !Array.isArray(adjustments)) return false;
  const previousIds = viewerElementLocalAdjustments(sceneId);
  const ids = new Set();
  localAdjustments[sceneId] = adjustments.map((adjustment, index) => {
    let next = normaliseLocalAdjustment(adjustment, index);
    while (ids.has(next.id)) next = { ...next, id: `${next.id}-${index + 1}` };
    ids.add(next.id);
    return next;
  });
  syncLocalAdjustments(sceneId, previousIds);
  return true;
}

function setSceneMetadata(sceneId, metadata = {}) {
  const scene = sceneById[sceneId];
  if (!scene) return false;
  const title = typeof metadata.title === "string" ? metadata.title.trim().slice(0, 80) : scene.title;
  const subtitle = typeof metadata.subtitle === "string" ? metadata.subtitle.trim().slice(0, 120) : scene.subtitle;
  if (!title) return false;
  scene.title = title;
  scene.subtitle = subtitle;
  configScenes[sceneId].title = title;
  const card = document.querySelector(`.scene-card[data-scene="${sceneId}"]`);
  if (card) {
    card.querySelector("span > span").textContent = title;
    card.querySelector("small").textContent = subtitle;
  }
  if (viewer.getScene() === sceneId) setActiveScene(sceneId);
  return true;
}

function getSceneView(sceneId) {
  const scene = sceneById[sceneId];
  return scene ? { pitch: scene.pitch, yaw: scene.yaw, hfov: scene.hfov } : null;
}

function setSceneView(sceneId, view = {}) {
  const scene = sceneById[sceneId];
  if (!scene || !Number.isFinite(view.pitch) || !Number.isFinite(view.yaw) || !Number.isFinite(view.hfov)) return false;
  scene.pitch = Math.max(-85, Math.min(85, view.pitch));
  scene.yaw = Math.max(-180, Math.min(180, view.yaw));
  scene.hfov = Math.max(58, Math.min(112, view.hfov));
  configScenes[sceneId].pitch = scene.pitch;
  configScenes[sceneId].yaw = scene.yaw;
  configScenes[sceneId].hfov = scene.hfov;
  if (viewer.isLoaded() && viewer.getScene() === sceneId) {
    viewer.lookAt(scene.pitch, scene.yaw, scene.hfov, 0);
  }
  return true;
}

function getAddedHotspots(sceneId) {
  const scene = sceneById[sceneId];
  return scene ? scene.hotspots.slice(getBaseHotspotCount(sceneId)).map((hotspot) => ({ ...hotspot })) : [];
}

function getBaseHotspotCount(sceneId) {
  return baseHotspotCounts[sceneId] || 0;
}

function removeLiveNavigationHotspot(sceneId, id) {
  const isActiveScene = viewer.getScene() === sceneId;
  // Before the first Pannellum load, active-scene hotspot records have no DOM
  // node yet. Updating config is sufficient; removeHotSpot would dereference
  // that absent node while Pannellum finishes its initial render.
  if (isActiveScene && !viewer.isLoaded()) return;

  const remove = isActiveScene ? () => viewer.removeHotSpot(id) : () => viewer.removeHotSpot(id, sceneId);
  // Let Pannellum remove both its model record and DOM node. Removing the DOM
  // first makes its own cleanup dereference a detached hotspot element.
  while (remove()) {
    // Deliberately empty: each pass removes one matching Pannellum instance.
  }
  viewer.getContainer().querySelectorAll("[data-editor-hotspot-id], [data-local-adjustment-id]").forEach((element) => {
    if (element.dataset.editorHotspotId === id || element.dataset.localAdjustmentId === id) element.remove();
  });
}

function addLiveNavigationHotspot(sceneId, hotspot) {
  const isActiveScene = viewer.getScene() === sceneId;
  // The initial Pannellum scene already owns the config hotspot list. Until it
  // has rendered, the updated config is the single source of truth; adding
  // another record here creates a duplicate marker on first paint.
  if (isActiveScene && !viewer.isLoaded()) return;
  if (isActiveScene) viewer.addHotSpot(hotspot);
  else viewer.addHotSpot(hotspot, sceneId);
}

function removeOrphanHotspotElements() {
  const activeDivs = new Set((configScenes[viewer.getScene()]?.hotSpots || []).map((hotspot) => hotspot.div).filter(Boolean));
  viewer.getContainer().querySelectorAll("[data-editor-hotspot-id], [data-local-adjustment-id]").forEach((element) => {
    if (!activeDivs.has(element)) element.remove();
  });
}

function rebuildSceneHotspots(sceneId) {
  const scene = sceneById[sceneId];
  const sceneConfig = configScenes[sceneId];
  if (!scene || !sceneConfig) return;
  const existingNavigationIds = sceneConfig.hotSpots
    .filter((hotspot) => !hotspot.id?.startsWith("local-adjustment::"))
    .map((hotspot) => hotspot.id);
  emitTourDebug("runtime-hotspots-rebuild-start", navigationHotspotInventory(sceneId));
  if (viewer.getScene() === sceneId && !viewer.isLoaded()) {
    const localOverlays = sceneConfig.hotSpots.filter((hotspot) => hotspot.id?.startsWith("local-adjustment::"));
    sceneConfig.hotSpots.splice(0, sceneConfig.hotSpots.length, ...scene.hotspots.map((hotspot, hotspotIndex) => toPannellumHotspot(scene, hotspot, hotspotIndex)), ...localOverlays);
    emitTourDebug("runtime-hotspots-rebuild-config-only", navigationHotspotInventory(sceneId));
    return;
  }
  existingNavigationIds.forEach((id) => removeLiveNavigationHotspot(sceneId, id));
  scene.hotspots.forEach((hotspot, hotspotIndex) => addLiveNavigationHotspot(sceneId, toPannellumHotspot(scene, hotspot, hotspotIndex)));
  emitTourDebug("runtime-hotspots-rebuild-complete", navigationHotspotInventory(sceneId));
}

function setAddedHotspots(sceneId, hotspots) {
  const scene = sceneById[sceneId];
  if (!scene || !Array.isArray(hotspots)) return false;
  const normalised = hotspots.map((hotspot) => normaliseAddedHotspot(sceneId, hotspot)).filter(Boolean);
  emitTourDebug("runtime-added-hotspots-set-start", {
    sceneId,
    incomingCount: hotspots.length,
    acceptedCount: normalised.length,
    before: navigationHotspotInventory(sceneId)
  });
  addedHotspots[sceneId] = normalised;
  scene.hotspots.splice(getBaseHotspotCount(sceneId));
  scene.hotspots.push(...normalised.map((hotspot) => ({ ...hotspot })));
  rebuildSceneHotspots(sceneId);
  const revision = hotspotRebuildRevisions[sceneId] + 1;
  hotspotRebuildRevisions[sceneId] = revision;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    if (hotspotRebuildRevisions[sceneId] === revision) rebuildSceneHotspots(sceneId);
  }));
  emitTourDebug("runtime-added-hotspots-set-complete", navigationHotspotInventory(sceneId));
  return true;
}

// Exposed for the shell, capture controls and QA checks.
window.__tourViewer = viewer;
window.__rainDigitTourTransition?.attach(viewer);

function updateHotspotCoordinates(sceneId, hotspotIndex, coordinates) {
  const scene = sceneById[sceneId];
  const hotspot = scene?.hotspots[hotspotIndex];
  if (!hotspot || !Number.isFinite(coordinates.pitch) || !Number.isFinite(coordinates.yaw)) {
    return false;
  }

  hotspot.pitch = coordinates.pitch;
  hotspot.yaw = coordinates.yaw;
  const id = hotspotId(sceneId, hotspotIndex);
  const configuredHotspot = configScenes[sceneId]?.hotSpots?.find((candidate) => candidate.id === id);
  if (configuredHotspot) {
    configuredHotspot.pitch = coordinates.pitch;
    configuredHotspot.yaw = coordinates.yaw;
  }

  removeLiveNavigationHotspot(sceneId, id);
  addLiveNavigationHotspot(sceneId, toPannellumHotspot(scene, hotspot, hotspotIndex));
  emitTourDebug("runtime-hotspot-coordinate-updated", {
    id,
    pitch: hotspot.pitch,
    yaw: hotspot.yaw,
    inventory: navigationHotspotInventory(sceneId)
  });
  return true;
}

function updateHotspotArrival(sceneId, hotspotIndex, arrival) {
  const scene = sceneById[sceneId];
  const hotspot = scene?.hotspots[hotspotIndex];
  if (!hotspot || !Number.isFinite(arrival.pitch) || !Number.isFinite(arrival.yaw) || !Number.isFinite(arrival.hfov)) return false;
  hotspot.targetPitch = Math.max(-85, Math.min(85, arrival.pitch));
  hotspot.targetYaw = Math.max(-180, Math.min(180, arrival.yaw));
  hotspot.targetHfov = Math.max(58, Math.min(112, arrival.hfov));
  const configuredHotspot = configScenes[sceneId]?.hotSpots?.find((candidate) => candidate.id === hotspotId(sceneId, hotspotIndex));
  if (configuredHotspot) {
    configuredHotspot.targetPitch = hotspot.targetPitch;
    configuredHotspot.targetYaw = hotspot.targetYaw;
    configuredHotspot.targetHfov = hotspot.targetHfov;
  }
  removeLiveNavigationHotspot(sceneId, hotspotId(sceneId, hotspotIndex));
  addLiveNavigationHotspot(sceneId, toPannellumHotspot(scene, hotspot, hotspotIndex));
  emitTourDebug("runtime-hotspot-arrival-updated", {
    id: hotspotId(sceneId, hotspotIndex),
    targetPitch: hotspot.targetPitch,
    targetYaw: hotspot.targetYaw,
    targetHfov: hotspot.targetHfov,
    inventory: navigationHotspotInventory(sceneId)
  });
  return true;
}

function applyDraft(draft) {
  if (!draft || draft.schema !== "raindigit-tour-hotspot-overrides/v1") return false;
  Object.entries(draft.addedHotspots || {}).forEach(([sceneId, hotspots]) => {
    setAddedHotspots(sceneId, hotspots);
  });
  Object.entries(draft.overrides || {}).forEach(([key, coordinates]) => {
    const [sceneId, hotspotIndex] = key.split("::");
    if (Number(hotspotIndex) >= getBaseHotspotCount(sceneId) && Array.isArray(draft.addedHotspots?.[sceneId])) return;
    updateHotspotCoordinates(sceneId, Number(hotspotIndex), coordinates);
  });
  Object.entries(draft.sceneAdjustments || {}).forEach(([sceneId, adjustment]) => {
    setSceneAdjustment(sceneId, adjustment);
  });
  Object.entries(draft.sceneMetadata || {}).forEach(([sceneId, metadata]) => {
    setSceneMetadata(sceneId, metadata);
  });
  Object.entries(draft.sceneViews || {}).forEach(([sceneId, view]) => {
    setSceneView(sceneId, view);
  });
  Object.entries(draft.localAdjustments || {}).forEach(([sceneId, adjustments]) => {
    setLocalAdjustments(sceneId, adjustments);
  });
  Object.entries(draft.overrides || {}).forEach(([key, override]) => {
    if (!Number.isFinite(override?.targetPitch) || !Number.isFinite(override?.targetYaw) || !Number.isFinite(override?.targetHfov)) return;
    const [sceneId, hotspotIndex] = key.split("::");
    if (Number(hotspotIndex) >= getBaseHotspotCount(sceneId) && Array.isArray(draft.addedHotspots?.[sceneId])) return;
    updateHotspotArrival(sceneId, Number(hotspotIndex), {
      pitch: override.targetPitch,
      yaw: override.targetYaw,
      hfov: override.targetHfov
    });
  });
  return true;
}

/* RELEASE_STRIP_START: local editor bridge */
// The editor bridge is exposed only on localhost or when the Studio server
// explicitly authorizes this document. Static customer releases never receive
// that server-injected capability.
if (isLocalEditorRequest) {
  window.__TOUR_EDITOR_API = {
    viewer,
    scenes,
    sceneById,
    hotspotId,
    updateHotspotCoordinates,
    updateHotspotArrival,
    getSceneAdjustment,
    setSceneAdjustment,
    setSceneAdjustmentPreview,
    getLocalAdjustments,
    setLocalAdjustments,
    setSceneMetadata,
    getSceneView,
    setSceneView,
    getAddedHotspots,
    getBaseHotspotCount,
    setAddedHotspots
  };
}

// The preview can apply a saved local draft, but deliberately exposes no editor UI or write endpoint.
if (isLocalDraftPreview) {
  window.__TOUR_DRAFT_PREVIEW_API = { applyDraft, viewer };
}
/* RELEASE_STRIP_END: local editor bridge */

const sceneList = document.querySelector("#sceneList");
const sceneCounter = document.querySelector("#sceneCounter");
const routeStrip = document.querySelector("#routeStrip");
const routeNodes = [];
const navigatorToggle = document.querySelector("#navigatorToggle");
const navigatorClose = document.querySelector("#navigatorClose");
const mapToggle = document.querySelector("#mapToggle");
const floorplanPanel = document.querySelector("#floorplanPanel");
const floorplanClose = document.querySelector("#floorplanClose");
const floorplanCanvas = document.querySelector("#floorplanCanvas");
const floorplanPins = [];
const fullscreenButton = document.querySelector("#fullscreen");
const captureViewButton = document.querySelector("#captureView");
const tourShell = document.querySelector(".tour-shell");

function setActiveScene(sceneId) {
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  document.querySelectorAll(".scene-card").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scene === sceneId);
  });
  document.querySelectorAll(".scene-card").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.scene === sceneId ? "true" : "false");
  });
  routeNodes.forEach((node) => {
    const isActive = node.dataset.routeSpace === sceneById[sceneId].space;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-current", isActive ? "true" : "false");
  });
  floorplanPins.forEach((pin) => {
    const isActive = pin.dataset.scene === sceneId;
    pin.classList.toggle("is-active", isActive);
    pin.setAttribute("aria-current", isActive ? "true" : "false");
  });
  sceneCounter.textContent = `View ${index + 1} of ${scenes.length}`;
  document.title = `${sceneById[sceneId].title} - ${tourTitle}`;
}

for (const scene of scenes) {
  const button = document.createElement("button");
  button.className = "scene-card";
  button.type = "button";
  button.dataset.scene = scene.id;
  button.innerHTML = `
    <img data-src="${scene.thumb}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
    <span>
      <span>${scene.title}</span>
      <small>${scene.subtitle}</small>
    </span>
  `;
  button.addEventListener("click", () => void loadSceneSafely(scene.id));
  sceneList.appendChild(button);
}

const spaces = new Map();
for (const scene of scenes) {
  const spaceId = scene.space || scene.id;
  if (!spaces.has(spaceId)) {
    spaces.set(spaceId, {
      id: spaceId,
      label: scene.spaceLabel || scene.title,
      firstScene: scene.id
    });
  }
}

for (const [index, space] of [...spaces.values()].entries()) {
  if (index > 0) {
    const connector = document.createElement("span");
    connector.className = "route-strip__connector";
    connector.setAttribute("aria-hidden", "true");
    routeStrip.appendChild(connector);
  }
  const button = document.createElement("button");
  button.className = "route-step";
  button.type = "button";
  button.dataset.routeSpace = space.id;
  button.textContent = space.label;
  button.addEventListener("click", () => void loadSceneSafely(space.firstScene));
  routeNodes.push(button);
  routeStrip.appendChild(button);
}

function setNavigatorOpen(isOpen) {
  if (isOpen) {
    sceneList.querySelectorAll("img[data-src]").forEach((image) => {
      image.src = image.dataset.src;
      delete image.dataset.src;
    });
  }
  document.body.classList.toggle("is-navigator-open", isOpen);
  navigatorToggle.setAttribute("aria-expanded", String(isOpen));
  navigatorToggle.setAttribute("aria-label", isOpen ? "Hide room navigator" : "Show room navigator");
  navigatorToggle.title = isOpen ? "Hide room navigator" : "Show room navigator";
}

function setFloorplanOpen(isOpen) {
  if (!configuredMap.enabled || !configuredMap.asset) return;
  floorplanPanel.hidden = !isOpen;
  mapToggle.setAttribute("aria-expanded", String(isOpen));
  mapToggle.setAttribute("aria-label", isOpen ? "Hide floorplan" : "Show floorplan");
  mapToggle.title = isOpen ? "Hide floorplan" : "Show floorplan";
}

navigatorToggle.addEventListener("click", () => {
  setNavigatorOpen(!document.body.classList.contains("is-navigator-open"));
});
navigatorClose.addEventListener("click", () => setNavigatorOpen(false));
if (configuredMap.enabled && configuredMap.asset) {
  mapToggle.hidden = false;
  const image = document.createElement("img");
  image.src = configuredMap.asset;
  image.alt = "Property floorplan";
  floorplanCanvas.appendChild(image);
  Object.entries(configuredMap.pins || {}).forEach(([sceneId, pin]) => {
    if (!sceneById[sceneId] || !Number.isFinite(pin?.x) || !Number.isFinite(pin?.y)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "floorplan-pin";
    button.dataset.scene = sceneId;
    button.style.left = `${pin.x}%`;
    button.style.top = `${pin.y}%`;
    button.textContent = String(scenes.findIndex((scene) => scene.id === sceneId) + 1);
    button.setAttribute("aria-label", `Open ${sceneById[sceneId].title}`);
    button.addEventListener("click", () => {
      void loadSceneSafely(sceneId);
      setFloorplanOpen(false);
    });
    floorplanPins.push(button);
    floorplanCanvas.appendChild(button);
  });
  mapToggle.addEventListener("click", () => setFloorplanOpen(floorplanPanel.hidden));
  floorplanClose.addEventListener("click", () => setFloorplanOpen(false));
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setNavigatorOpen(false);
    setFloorplanOpen(false);
  }
});

document.querySelector("#resetView").addEventListener("click", () => {
  const scene = sceneById[viewer.getScene()];
  viewer.lookAt(scene.pitch, scene.yaw, scene.hfov, 380);
});

function downloadCurrentCleanView() {
  const renderer = viewer.getRenderer?.();
  if (!renderer) return;

  let image = "";
  try {
    // Ask Pannellum to render and read back in the same synchronous call.
    // A later canvas.toBlob() can be black when WebGL correctly uses the
    // mobile-safe default of preserveDrawingBuffer: false.
    image = renderer.render(
      viewer.getPitch() * Math.PI / 180,
      viewer.getYaw() * Math.PI / 180,
      viewer.getHfov() * Math.PI / 180,
      { roll: 0, returnImage: true }
    ) || "";
  } catch {
    return;
  }
  if (!image.startsWith("data:image/png")) return;

  const scene = sceneById[viewer.getScene()];
  const safeScene = (scene?.title || viewer.getScene() || "view")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "view";
  const link = document.createElement("a");
  link.href = image;
  link.download = `raindigit-tour-${safeScene}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

captureViewButton?.addEventListener("click", downloadCurrentCleanView);

function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    document.body.classList.contains("is-cinema-fullscreen")
  );
}

function getNativeFullscreenElement() {
  return document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null;
}

function requestNativeFullscreen(element) {
  const request = element?.requestFullscreen ||
    element?.webkitRequestFullscreen ||
    element?.mozRequestFullScreen ||
    element?.msRequestFullscreen;
  if (!request) return null;
  return Promise.resolve(request.call(element));
}

function exitNativeFullscreen() {
  const exit = document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen;
  if (!exit) return Promise.resolve();
  return Promise.resolve(exit.call(document));
}

function updateFullscreenButton() {
  const isActive = isFullscreenActive();
  fullscreenButton.classList.toggle("is-active", isActive);
  fullscreenButton.setAttribute("aria-label", isActive ? "Exit fullscreen" : "Fullscreen");
  fullscreenButton.title = isActive ? "Exit fullscreen" : "Fullscreen";
}

function resizeTourAfterFullscreenChange() {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => viewer.resize()));
}

function toggleFullscreenFallback() {
  const action = document.body.classList.contains("is-cinema-fullscreen") ? "exit" : "enter";
  if (window.parent !== window) {
    window.parent.postMessage({ type: "raindigit-tour-fullscreen-fallback", action }, "*");
    return;
  }
  document.body.classList.toggle("is-cinema-fullscreen", action === "enter");
  updateFullscreenButton();
  resizeTourAfterFullscreenChange();
}

async function requestTourFullscreen() {
  if (getNativeFullscreenElement()) {
    try {
      await exitNativeFullscreen();
    } finally {
      updateFullscreenButton();
      resizeTourAfterFullscreenChange();
    }
    return;
  }

  if (document.body.classList.contains("is-cinema-fullscreen")) {
    toggleFullscreenFallback();
    return;
  }

  if (window.parent !== window && window.matchMedia("(max-width: 760px)").matches) {
    toggleFullscreenFallback();
    return;
  }

  try {
    const request = requestNativeFullscreen(tourShell);
    if (!request) {
      toggleFullscreenFallback();
      return;
    }
    await request;
  } catch {
    toggleFullscreenFallback();
    return;
  }

  window.setTimeout(() => {
    if (!isFullscreenActive()) toggleFullscreenFallback();
  }, 450);
}

fullscreenButton.addEventListener("click", () => void requestTourFullscreen());

["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((eventName) => {
  document.addEventListener(eventName, () => {
    updateFullscreenButton();
    resizeTourAfterFullscreenChange();
  });
});

window.addEventListener("message", (event) => {
  if (event.data?.type !== "raindigit-tour-fullscreen-state") return;
  document.body.classList.toggle("is-cinema-fullscreen", Boolean(event.data.active));
  updateFullscreenButton();
  resizeTourAfterFullscreenChange();
});

viewer.on("scenechange", (sceneId) => {
  window.__rainDigitTourMonitoring?.setScene(sceneId);
  setActiveScene(sceneId);
  applySceneAdjustment(sceneId);
  emitTourDebug("runtime-scene-change", navigationHotspotInventory(sceneId));
});

let tourReadyNotified = false;
const tourReadySlug = window.location.pathname.match(/\/tours\/([^/]+)\//)?.[1] || null;
const tourReadyTargetOrigin = (() => {
  const queryOrigin = new URLSearchParams(window.location.search).get("parentOrigin");
  if (queryOrigin) {
    try { return new URL(queryOrigin).origin; } catch {}
  }
  try { return document.referrer ? new URL(document.referrer).origin : "*"; } catch { return "*"; }
})();
function reportTourReady(target = window.parent, targetOrigin = tourReadyTargetOrigin) {
  target.postMessage(
    { type: "raindigit-tour-ready", version: 1, slug: tourReadySlug },
    targetOrigin,
  );
}
function revealRenderedTour() {
  const canvas = viewer.getContainer().querySelector(".pnlm-render-container canvas");
  const runtimeStylesState = document.documentElement.dataset.runtimeStyles;
  const runtimeStylesReady = !runtimeStylesState || runtimeStylesState === "ready";
  const transition = window.__rainDigitTourTransition?.state?.();
  const transitionReady = !window.__rainDigitTourTransition || transition?.phase === "ready";
  if (viewer.isLoaded() && canvas?.width > 0 && canvas?.height > 0 && runtimeStylesReady && transitionReady) {
    document.documentElement.classList.add("is-tour-ready");
    if (!tourReadyNotified) {
      tourReadyNotified = true;
      reportTourReady();
    }
    return;
  }
  // Keep booting while embedded below the fold; browsers may suspend rAF in
  // an off-screen iframe indefinitely.
  window.setTimeout(revealRenderedTour, 16);
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window.parent ||
    event.data?.type !== "raindigit-tour-ready-query" ||
    event.data.version !== 1 ||
    event.data.slug !== tourReadySlug ||
    !tourReadyNotified
  ) return;
  reportTourReady(event.source, event.origin);
});

viewer.on("load", () => {
  // A dynamic canvas must start with updates enabled so Pannellum creates the
  // renderer. Once the base frame exists, suspend continuous texture uploads;
  // boundedMediaRuntime.upgrade() explicitly re-arms exactly one detail frame.
  viewer.setUpdate(false);
  revealRenderedTour();
  setActiveScene(viewer.getScene());
  void boundedMediaRuntime?.upgrade(viewer, viewer.getScene());
  applySceneAdjustment(viewer.getScene());
  window.requestAnimationFrame(removeOrphanHotspotElements);
  window.requestAnimationFrame(() => emitTourDebug("runtime-scene-loaded", navigationHotspotInventory(viewer.getScene())));
});
if (viewer.isLoaded()) {
  // Dynamic canvas initialization can complete synchronously before the load
  // listener is attached. Preserve the same base -> detail path in that case.
  viewer.setUpdate(false);
  void boundedMediaRuntime?.upgrade(viewer, viewer.getScene());
}
revealRenderedTour();
setActiveScene(initialScene);
  if (isLocalDraftPreview) setNavigatorOpen(true);
})();
