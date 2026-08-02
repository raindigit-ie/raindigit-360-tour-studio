const { firstScene, scenes, title: tourTitle } = window.TOUR_CONFIG;
const sceneById = Object.fromEntries(scenes.map((scene) => [scene.id, scene]));
const configScenes = {};
const viewParams = new URLSearchParams(window.location.search);
const requestedScene = viewParams.get("scene");
const initialScene = sceneById[requestedScene] ? requestedScene : firstScene;
const isLocalEditorRequest = viewParams.get("edit") === "1" &&
  ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
const isLocalDraftPreview = viewParams.get("preview") === "1" &&
  ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
const defaultSceneAdjustment = Object.freeze({ brightness: 100, contrast: 100, saturation: 100, warmth: 0 });
const sceneAdjustments = Object.fromEntries(scenes.map((scene) => [scene.id, { ...defaultSceneAdjustment }]));
const localAdjustments = Object.fromEntries(scenes.map((scene) => [scene.id, []]));
const baseHotspotCounts = Object.fromEntries(scenes.map((scene) => [scene.id, scene.hotspots.length]));
const addedHotspots = Object.fromEntries(scenes.map((scene) => [scene.id, []]));
const hotspotRebuildRevisions = Object.fromEntries(scenes.map((scene) => [scene.id, 0]));

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
  hotspotDiv.classList.add("nav-hotspot", `nav-hotspot--${args.kind}`);
  hotspotDiv.dataset.label = args.label;
  if (args.editorId) {
    hotspotDiv.dataset.editorHotspotId = args.editorId;
  }
  hotspotDiv.setAttribute("aria-label", args.label);
  hotspotDiv.innerHTML = args.kind === "viewpoint"
    ? `<svg class="nav-hotspot__view" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8V5h3" /><path d="M20 8V5h-3" />
        <path d="M4 16v3h3" /><path d="M20 16v3h-3" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>`
    : `<svg class="nav-hotspot__person" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="13" cy="4.8" r="1.9" />
        <path d="m11.6 8.3 2.1 3.8 3.2 1.4" />
        <path d="m13.3 12.1-2 3.5-2.7 2.2" />
        <path d="m13.3 12.1 1.5 4.1 2.9 2.1" />
        <path d="m11.8 8.7-3.2 2.4" />
      </svg>`;
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
    cssClass: "nav-hotspot-anchor",
    createTooltipFunc: createTransitionHotspot,
    createTooltipArgs: { label: hotspot.label, kind: hotspot.kind || "doorway", editorId: id }
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

for (const scene of scenes) {
  configScenes[scene.id] = {
    title: scene.title,
    type: "equirectangular",
    panorama: scene.panorama,
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
    sceneFadeDuration: 260,
    autoLoad: true,
    showFullscreenCtrl: false,
    showZoomCtrl: false,
    compass: false,
    keyboardZoom: true,
    mouseZoom: true,
    hfov: 94,
    minHfov: 58,
    maxHfov: 112
  },
  scenes: configScenes
});

function applySceneAdjustment(sceneId) {
  const adjustment = sceneAdjustments[sceneId] || defaultSceneAdjustment;
  const canvas = viewer.getContainer().querySelector(".pnlm-render-container canvas");
  if (!canvas) return;

  const warmTint = Math.max(0, adjustment.warmth) / 100;
  const coolHueShift = Math.min(18, Math.max(0, -adjustment.warmth) * 0.9);
  canvas.style.filter = `brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;
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
  if (viewer.getScene() === sceneId && !viewer.isLoaded()) {
    const localOverlays = sceneConfig.hotSpots.filter((hotspot) => hotspot.id?.startsWith("local-adjustment::"));
    sceneConfig.hotSpots.splice(0, sceneConfig.hotSpots.length, ...scene.hotspots.map((hotspot, hotspotIndex) => toPannellumHotspot(scene, hotspot, hotspotIndex)), ...localOverlays);
    return;
  }
  existingNavigationIds.forEach((id) => removeLiveNavigationHotspot(sceneId, id));
  scene.hotspots.forEach((hotspot, hotspotIndex) => addLiveNavigationHotspot(sceneId, toPannellumHotspot(scene, hotspot, hotspotIndex)));
}

function setAddedHotspots(sceneId, hotspots) {
  const scene = sceneById[sceneId];
  if (!scene || !Array.isArray(hotspots)) return false;
  const normalised = hotspots.map((hotspot) => normaliseAddedHotspot(sceneId, hotspot)).filter(Boolean);
  addedHotspots[sceneId] = normalised;
  scene.hotspots.splice(getBaseHotspotCount(sceneId));
  scene.hotspots.push(...normalised.map((hotspot) => ({ ...hotspot })));
  rebuildSceneHotspots(sceneId);
  const revision = hotspotRebuildRevisions[sceneId] + 1;
  hotspotRebuildRevisions[sceneId] = revision;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    if (hotspotRebuildRevisions[sceneId] === revision) rebuildSceneHotspots(sceneId);
  }));
  return true;
}

// Exposed only on explicit QA URLs so source doorway points can be measured.
if (viewParams.get("qa") === "1") {
  window.__tourViewer = viewer;
}

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

// The editor module is dynamically loaded only on a local ?edit=1 URL.
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

const sceneList = document.querySelector("#sceneList");
const sceneCounter = document.querySelector("#sceneCounter");
const routeStrip = document.querySelector("#routeStrip");
const routeNodes = [];
const navigatorToggle = document.querySelector("#navigatorToggle");
const navigatorClose = document.querySelector("#navigatorClose");
const fullscreenButton = document.querySelector("#fullscreen");
let initialViewApplied = false;

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
  sceneCounter.textContent = `View ${index + 1} of ${scenes.length}`;
  document.title = `${sceneById[sceneId].title} - ${tourTitle}`;
}

for (const scene of scenes) {
  const button = document.createElement("button");
  button.className = "scene-card";
  button.type = "button";
  button.dataset.scene = scene.id;
  button.innerHTML = `
    <img src="${scene.thumb}" alt="" loading="eager" />
    <span>
      <span>${scene.title}</span>
      <small>${scene.subtitle}</small>
    </span>
  `;
  button.addEventListener("click", () => viewer.loadScene(scene.id));
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
  button.addEventListener("click", () => viewer.loadScene(space.firstScene));
  routeNodes.push(button);
  routeStrip.appendChild(button);
}

function setNavigatorOpen(isOpen) {
  document.body.classList.toggle("is-navigator-open", isOpen);
  navigatorToggle.setAttribute("aria-expanded", String(isOpen));
  navigatorToggle.setAttribute("aria-label", isOpen ? "Hide room navigator" : "Show room navigator");
  navigatorToggle.title = isOpen ? "Hide room navigator" : "Show room navigator";
}

navigatorToggle.addEventListener("click", () => {
  setNavigatorOpen(!document.body.classList.contains("is-navigator-open"));
});
navigatorClose.addEventListener("click", () => setNavigatorOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setNavigatorOpen(false);
  }
});

document.querySelector("#resetView").addEventListener("click", () => {
  const scene = sceneById[viewer.getScene()];
  viewer.lookAt(scene.pitch, scene.yaw, scene.hfov, 380);
});

function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    document.body.classList.contains("is-cinema-fullscreen")
  );
}

function updateFullscreenButton() {
  const isActive = isFullscreenActive();
  fullscreenButton.classList.toggle("is-active", isActive);
  fullscreenButton.setAttribute("aria-label", isActive ? "Exit fullscreen" : "Fullscreen");
  fullscreenButton.title = isActive ? "Exit fullscreen" : "Fullscreen";
}

function toggleFullscreenFallback() {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "raindigit-tour-fullscreen-fallback" }, "*");
    return;
  }
  document.body.classList.toggle("is-cinema-fullscreen");
  updateFullscreenButton();
}

fullscreenButton.addEventListener("click", () => {
  viewer.toggleFullscreen();
  window.setTimeout(() => {
    if (!isFullscreenActive()) {
      toggleFullscreenFallback();
    }
  }, 450);
});

["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((eventName) => {
  document.addEventListener(eventName, updateFullscreenButton);
});

viewer.on("scenechange", (sceneId) => {
  setActiveScene(sceneId);
  applySceneAdjustment(sceneId);
});
viewer.on("load", () => {
  if (!initialViewApplied) {
    const scene = configScenes[initialScene];
    viewer.lookAt(scene.pitch, scene.yaw, scene.hfov, 0);
    initialViewApplied = true;
  }
  setActiveScene(viewer.getScene());
  applySceneAdjustment(viewer.getScene());
  window.requestAnimationFrame(removeOrphanHotspotElements);
});
setActiveScene(initialScene);
  if (isLocalDraftPreview) setNavigatorOpen(true);
