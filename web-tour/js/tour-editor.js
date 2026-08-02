(() => {
  "use strict";

  const api = window.__TOUR_EDITOR_API;
  if (!api) return;

  const endpoint = "__tour-editor";
  const workspaceMode = new URLSearchParams(window.location.search).get("workspace") === "1";
  const stageOrder = ["start", "upload", "rooms", "light", "links", "arrival", "export"];
  const stageLabels = {
    start: "Start",
    upload: "Photos",
    rooms: "Rooms",
    light: "Look",
    links: "Walking buttons",
    arrival: "First views",
    export: "Publish"
  };
  const stageStorageKey = "raindigit-tour-studio-stage";
  const restoredStage = window.sessionStorage.getItem(stageStorageKey);
  const roundCoordinate = (value) => Math.round(value * 10) / 10;
  const state = {
    activeStage: stageOrder.includes(restoredStage) ? restoredStage : "start",
    selected: null,
    selectedAdjustmentId: null,
    placement: null,
    arrival: null,
    savedAt: null,
    workspaceProject: null,
    importing: false,
    restoring: false,
    importProgress: { current: 0, total: 0 },
    building: false,
    sceneMoving: false,
    pendingFocus: null,
    release: { ready: false },
    roomPlanSceneId: null,
    previewSceneId: null,
    lookSceneIndex: 0,
    linkSceneIndex: 0,
    linkStep: "choose",
    arrivalLoading: false,
    viewportSettling: false,
    viewerSettled: false,
    statusMessage: "Loading project"
  };
  window.sessionStorage.removeItem(stageStorageKey);

  const panel = document.createElement("aside");
  panel.className = "editor-panel";
  panel.setAttribute("aria-label", "RainDigit tour studio");
  panel.innerHTML = `
    <div class="editor-panel__header">
      <div>
        <p class="editor-panel__eyebrow">RainDigit</p>
        <p class="editor-panel__title">360 Tour Studio</p>
      </div>
      <div class="editor-panel__header-actions">
        <button class="editor-button" id="editorHome" type="button">Tours</button>
        <button class="editor-button editor-button--icon" id="editorClose" type="button" aria-label="Hide tour studio" title="Hide tour studio">&times;</button>
      </div>
    </div>
    <div class="editor-progress" aria-label="Tour production progress">
      <div><strong id="editorProgressLabel">Start</strong><span id="editorProgressCount">1 of 7</span></div>
      <div class="editor-progress__track"><i id="editorProgressFill"></i></div>
    </div>
    <div class="editor-panel__scene">
      <button class="editor-button editor-button--icon" id="editorPreviousScene" type="button" aria-label="Previous 360 photo" title="Previous 360 photo">&larr;</button>
      <div>
        <span id="editorRoomName"></span>
        <strong class="editor-panel__scene-name" id="editorSceneName"></strong>
      </div>
      <button class="editor-button editor-button--icon" id="editorNextScene" type="button" aria-label="Next 360 photo" title="Next 360 photo">&rarr;</button>
    </div>
    <div class="editor-panel__content">
      <section class="editor-stage-panel" data-stage-panel="start">
        <div class="editor-step-heading"><span>Start</span><h2>Start a tour</h2></div>
        <div class="editor-start-options">
          <section class="editor-start-block">
            <strong>New tour</strong>
            <label class="editor-field editor-field--stacked">
              <span>Tour name</span>
              <input id="editorProjectTitle" type="text" maxlength="100" autocomplete="off" value="Untitled 360 Tour" />
            </label>
            <button class="editor-button editor-button--primary editor-button--wide" id="editorCreateWorkspace" type="button">Create new tour</button>
          </section>
          <section class="editor-start-block">
            <strong>Open a tour</strong>
            <label class="editor-file-picker">
              <span id="editorProjectBackupName">Choose an editable project file</span>
              <input id="editorProjectBackup" type="file" accept=".rdtour,application/zip" />
            </label>
            <button class="editor-button editor-button--wide" id="editorRestoreProject" type="button" disabled>Open project</button>
          </section>
        </div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="upload">
        <div class="editor-step-heading"><span>Step 1</span><h2>Add 360 photos</h2></div>
        <label class="editor-upload-zone">
          <strong>Choose 360 JPG photos</strong>
          <span>Use the stitched photos exported by your 360 camera.</span>
          <input id="editorImportFiles" type="file" accept="image/jpeg,.jpg,.jpeg" multiple />
        </label>
        <p class="editor-empty" id="editorProjectEmpty"></p>
        <div class="editor-upload-list" id="editorUploadList" aria-label="Uploaded 360 photos"></div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="rooms">
        <div class="editor-step-heading"><span>Step 2</span><h2>Set up rooms and walking routes</h2></div>
        <section class="editor-setup-section">
          <div class="editor-setup-section__heading"><span>1</span><div><strong>Rooms</strong><small>Name the rooms in this tour.</small></div></div>
          <div class="editor-room-count">
            <label class="editor-field editor-field--stacked"><span>Number of rooms</span><input id="editorRoomCount" type="number" min="1" max="100" step="1" value="1" inputmode="numeric" /></label>
            <button class="editor-button" id="editorApplyRoomCount" type="button">Update rooms</button>
          </div>
          <div class="editor-room-list" id="editorRoomList"></div>
        </section>
        <section class="editor-setup-section">
          <div class="editor-setup-section__heading"><span>2</span><div><strong>Photos</strong><small>Drag each photo into its room.</small></div></div>
          <div class="editor-room-board" id="editorProjectOrder" aria-label="Photos grouped by room"></div>
          <p class="editor-task-progress" id="editorAssignmentStatus"></p>
        </section>
        <section class="editor-setup-section editor-place-planner">
          <div class="editor-setup-section__heading"><span>3</span><div><strong>Walking routes</strong><small>Pick where the visitor stands, then pick where they can walk.</small></div></div>
          <div class="editor-photo-strip" id="editorRoomChoices" aria-label="Choose the starting photo"></div>
          <p class="editor-task-progress" id="editorRoomTaskProgress"></p>
          <div class="editor-planned-places" id="editorPlannedPlaces"></div>
          <div class="editor-place-choices" id="editorPlaceChoices" aria-label="Choose destination photos"></div>
        </section>
      </section>
      <section class="editor-stage-panel" data-stage-panel="light">
        <div class="editor-step-heading"><span>Step 3</span><h2>Choose the look</h2></div>
        <div class="editor-presets" id="editorImagePresets" aria-label="Picture style"></div>
        <details class="editor-disclosure editor-disclosure--compact">
          <summary>Fine tune picture</summary>
          <div class="editor-image__controls" id="editorImageControls"></div>
          <div class="editor-local-header">
            <strong>Light areas</strong>
            <button class="editor-button" id="editorAddAdjustment" type="button">Add light area</button>
          </div>
          <div class="editor-adjustment-list" id="editorAdjustmentList"></div>
          <div class="editor-adjustment-controls" id="editorAdjustmentControls"></div>
        </details>
      </section>
      <section class="editor-stage-panel" data-stage-panel="links">
        <div class="editor-step-heading"><span>Step 4</span><h2 id="editorMovementHeading">Place the walking buttons</h2></div>
        <p class="editor-task-progress" id="editorLinkTaskProgress"></p>
        <p class="editor-guidance" id="editorLinkGuidance"></p>
        <div class="editor-hotspot-list" id="editorHotspotList" aria-label="Saved movements"></div>
        <div class="editor-place-at-centre" id="editorPlaceAtCentre" hidden>
          <strong>Put the walking button under the door or camera point.</strong>
          <span>Drag the 360 photo, then save the walking button.</span>
          <button class="editor-button editor-button--primary editor-button--wide" id="editorConfirmCentre" type="button">Save point here</button>
          <button class="editor-button editor-button--wide" id="editorCancelCentre" type="button">Change rooms and routes</button>
        </div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="arrival">
        <div class="editor-step-heading"><span>Step 5</span><h2>Choose what people see first</h2></div>
        <p class="editor-guidance" id="editorArrivalHelp"></p>
        <div class="editor-hotspot-list" id="editorArrivalList" hidden></div>
        <button class="editor-button" id="editorEditArrival" type="button" hidden>Choose destination view</button>
        <button class="editor-button editor-button--primary editor-button--wide" id="editorSaveArrival" type="button">Save this first view</button>
        <div class="editor-default-view" hidden>
          <span id="editorDefaultView"></span>
          <button id="editorSaveSceneView" type="button">Use as room opening</button>
        </div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="export">
        <div class="editor-step-heading"><span>Step 6</span><h2>Check and publish</h2></div>
        <div class="editor-export-summary" id="editorExportSummary"></div>
        <div class="editor-readiness" id="editorReadiness" role="status"></div>
        <details class="editor-disclosure editor-disclosure--compact" id="editorPreviewOptions">
          <summary id="editorPreviewOptionsLabel">Check the tour first</summary>
          <a class="editor-button editor-button--wide" id="editorPreviewLink" target="_blank" rel="noopener">Open tour preview</a>
        </details>
        <button class="editor-button editor-button--primary editor-button--wide" id="editorBuild" type="button">Build the tour</button>
        <div class="editor-release-actions" id="editorReleaseActions" hidden>
          <div class="editor-publish-card">
            <strong>Your tour is ready</strong>
            <a class="editor-button editor-button--primary editor-button--wide" id="editorDownloadSingle" download="raindigit-360-tour.html">Download website file</a>
          </div>
          <details class="editor-disclosure editor-disclosure--compact">
            <summary>Test on a website</summary>
            <a class="editor-button editor-button--wide" id="editorEmbedTestLink" target="_blank" rel="noopener">Open sample website</a>
          </details>
          <details class="editor-disclosure editor-disclosure--compact">
            <summary>Add it to a website</summary>
            <div class="editor-publish-card">
              <span>Upload the downloaded file, then enter its web address.</span>
              <label class="editor-field editor-field--stacked">
                <span>Tour web address</span>
                <input id="editorInstallUrl" type="url" value="./raindigit-360-tour.html" autocomplete="off" />
              </label>
              <textarea class="editor-embed-code" id="editorEmbedCode" readonly aria-label="Website code"></textarea>
              <button class="editor-button editor-button--wide" id="editorCopyEmbed" type="button">Copy website code</button>
            </div>
          </details>
          <details class="editor-advanced">
            <summary>Backups and advanced files</summary>
            <button class="editor-button editor-button--wide" id="editorDownloadProject" type="button">Download editable backup</button>
            <a class="editor-button editor-button--wide" id="editorDownloadZip" download="raindigit-360-tour.zip">Download folder package (.zip)</a>
          </details>
        </div>
        <p class="editor-empty" id="editorReleaseStatus"></p>
      </section>
    </div>
    <div class="editor-panel__footer">
      <button class="editor-button" id="editorBack" type="button">Back</button>
      <span class="editor-panel__status" id="editorStatus" role="status">Loading project</span>
      <button class="editor-button editor-button--primary" id="editorContinue" type="button" hidden>Continue</button>
    </div>
  `;
  document.body.appendChild(panel);
  document.body.classList.add("is-editor-open");

  const previewDialog = document.createElement("div");
  previewDialog.className = "editor-photo-preview";
  previewDialog.hidden = true;
  previewDialog.innerHTML = `
    <div class="editor-photo-preview__dialog" role="dialog" aria-modal="true" aria-labelledby="editorPreviewTitle">
      <header>
        <div>
          <span id="editorPreviewRoom"></span>
          <strong id="editorPreviewTitle">360 photo preview</strong>
        </div>
        <button class="editor-button editor-button--icon" id="editorPreviewClose" type="button" aria-label="Close preview" title="Close preview">&times;</button>
      </header>
      <img id="editorPreviewImage" alt="" />
      <p>Use this large preview to check which doors, room openings or other camera points are visible before choosing walking routes.</p>
    </div>
  `;
  document.body.appendChild(previewDialog);

  const elements = Object.fromEntries([
    "SceneName", "RoomName", "Home", "ProgressLabel", "ProgressCount", "ProgressFill", "ProjectTitle", "CreateWorkspace", "ProjectBackup", "ProjectBackupName", "RestoreProject", "ImportFiles", "ProjectEmpty", "UploadList", "RoomCount", "ApplyRoomCount", "RoomList", "AssignmentStatus", "ProjectOrder", "RoomTaskProgress", "RoomChoices", "PlannedPlaces", "PlaceChoices", "HotspotList", "ArrivalList", "LinkTaskProgress", "LinkGuidance", "MovementHeading", "PlaceAtCentre", "ConfirmCentre", "CancelCentre", "EditArrival", "SaveArrival", "ArrivalHelp", "DefaultView", "SaveSceneView", "ImagePresets", "ImageControls", "AdjustmentList", "AdjustmentControls", "AddAdjustment", "ExportSummary", "Readiness", "PreviewOptions", "PreviewOptionsLabel", "PreviewLink", "Build", "ReleaseActions", "EmbedTestLink", "DownloadSingle", "DownloadProject", "InstallUrl", "EmbedCode", "CopyEmbed", "DownloadZip", "ReleaseStatus", "Back", "Status", "Continue"
  ].map((name) => [name, panel.querySelector(`#editor${name}`)]));
  const previewElements = {
    close: previewDialog.querySelector("#editorPreviewClose"),
    image: previewDialog.querySelector("#editorPreviewImage"),
    room: previewDialog.querySelector("#editorPreviewRoom"),
    title: previewDialog.querySelector("#editorPreviewTitle")
  };
  const viewerElement = api.viewer.getContainer();
  const placementSurface = document.createElement("div");
  placementSurface.className = "editor-placement-surface";
  placementSurface.hidden = true;
  placementSurface.tabIndex = 0;
  placementSurface.setAttribute("role", "button");
  viewerElement.appendChild(placementSurface);
  const centreTarget = document.createElement("div");
  centreTarget.className = "editor-centre-target";
  centreTarget.hidden = true;
  centreTarget.setAttribute("aria-hidden", "true");
  viewerElement.appendChild(centreTarget);
  let placementPointerStart = null;
  let suppressPlacementClick = false;
  let draftSavePromise = Promise.resolve(true);
  let draftSaveTimer = 0;
  const studioSessionId = window.crypto?.randomUUID?.() || `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let studioLogSequence = 0;
  let studioLogBuffer = [];
  let studioLogTimer = 0;
  let roomPointerDrag = null;

  document.addEventListener("pointermove", (event) => {
    if (!roomPointerDrag) return;
    if (Math.hypot(event.clientX - roomPointerDrag.startX, event.clientY - roomPointerDrag.startY) > 8) {
      roomPointerDrag.moved = true;
    }
  });
  document.addEventListener("pointerup", (event) => {
    if (!roomPointerDrag) return;
    const drag = roomPointerDrag;
    roomPointerDrag = null;
    if (!drag.moved) return;
    const column = document.elementFromPoint(event.clientX, event.clientY)?.closest(".editor-room-column");
    if (column?.dataset.roomId) assignSceneToRoom(drag.sceneId, column.dataset.roomId);
  });
  previewElements.close.addEventListener("click", closePhotoPreview);
  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) closePhotoPreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePhotoPreview();
  });

  const editorToggle = document.createElement("button");
  editorToggle.className = "icon-button";
  editorToggle.type = "button";
  editorToggle.setAttribute("aria-label", "Hide tour studio");
  editorToggle.title = "Hide tour studio";
  editorToggle.innerHTML = "&#9678;";
  document.querySelector(".toolbar").appendChild(editorToggle);

  function studioInventory() {
    const activeSceneId = api.viewer.getScene();
    const activeConfig = api.viewer.getConfig()?.hotSpots || [];
    return {
      activeSceneId,
      viewerLoaded: Boolean(api.viewer.isLoaded()),
      pose: {
        pitch: roundCoordinate(api.viewer.getPitch()),
        yaw: roundCoordinate(api.viewer.getYaw()),
        hfov: roundCoordinate(api.viewer.getHfov())
      },
      selected: state.selected ? { ...state.selected } : null,
      placement: state.placement ? { ...state.placement } : null,
      arrival: state.arrival ? { ...state.arrival } : null,
      scenes: api.scenes.map((scene) => ({
        id: scene.id,
        modelIds: scene.hotspots.map((_, index) => api.hotspotId(scene.id, index)),
        addedCount: api.getAddedHotspots(scene.id).length
      })),
      activeConfigIds: activeConfig.filter((hotspot) => !hotspot.id?.startsWith("local-adjustment::")).map((hotspot) => hotspot.id),
      activeDomIds: Array.from(viewerElement.querySelectorAll("[data-editor-hotspot-id]")).map((element) => element.dataset.editorHotspotId)
    };
  }

  async function flushStudioLogs() {
    window.clearTimeout(studioLogTimer);
    studioLogTimer = 0;
    if (!studioLogBuffer.length) return true;
    const entries = studioLogBuffer.splice(0, 100);
    try {
      const response = await fetch(studioUrl("studio-log", false), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries })
      });
      if (!response.ok) throw new Error(`Studio log failed (${response.status})`);
      if (studioLogBuffer.length) studioLogTimer = window.setTimeout(flushStudioLogs, 120);
      return true;
    } catch (error) {
      studioLogBuffer = [...entries, ...studioLogBuffer].slice(-300);
      console.warn(error.message);
      return false;
    }
  }

  function studioLog(event, details = {}, includeInventory = false) {
    const entry = {
      time: new Date().toISOString(),
      sessionId: studioSessionId,
      sequence: ++studioLogSequence,
      event,
      stage: state.activeStage,
      workspaceMode,
      details,
      ...(includeInventory ? { inventory: studioInventory() } : {})
    };
    console.debug("[RainDigit Studio]", event, details);
    studioLogBuffer.push(entry);
    if (studioLogBuffer.length > 300) studioLogBuffer.shift();
    window.clearTimeout(studioLogTimer);
    studioLogTimer = window.setTimeout(flushStudioLogs, 180);
  }

  function setStatus(message) {
    state.statusMessage = message;
    elements.Status.textContent = message;
    studioLog("status", { message });
  }

  function studioUrl(path, workspace = workspaceMode) {
    return `${endpoint}/${path}${workspace ? "?workspace=1" : ""}`;
  }

  function workspaceEditorUrl() {
    return `${window.location.pathname}?edit=1&workspace=1`;
  }

  function currentScene() {
    return api.sceneById[api.viewer.getScene()] || null;
  }

  function selectedHotspot() {
    if (!state.selected) return null;
    const scene = api.sceneById[state.selected.sceneId];
    const hotspot = scene?.hotspots[state.selected.hotspotIndex];
    return hotspot ? { scene, hotspot } : null;
  }

  function selectedAdjustment() {
    const scene = currentScene();
    if (!scene || !state.selectedAdjustmentId) return null;
    return api.getLocalAdjustments(scene.id).find((adjustment) => adjustment.id === state.selectedAdjustmentId) || null;
  }

  function roomMap(project = state.workspaceProject) {
    const rooms = new Map();
    for (const room of project?.rooms || []) rooms.set(room.id, { ...room, scenes: [] });
    for (const scene of project?.scenes || []) {
      if (!rooms.has(scene.space)) rooms.set(scene.space, { id: scene.space, label: scene.spaceLabel, scenes: [] });
      rooms.get(scene.space).scenes.push(scene);
    }
    return rooms;
  }

  function projectRooms(project = state.workspaceProject) {
    if (!project) return [];
    if (!Array.isArray(project.rooms)) {
      project.rooms = [...roomMap(project).values()]
        .filter((room) => room.id !== "room-unassigned")
        .map(({ id, label }) => ({ id, label }));
    }
    return project.rooms;
  }

  function isAutoSceneTitle(scene) {
    return scene?.titleAutoGenerated === true || /^View\s+\d+$/i.test((scene?.title || "").trim());
  }

  function refreshAutoSceneTitles(project = state.workspaceProject, roomId = null) {
    if (!project) return;
    for (const room of projectRooms(project)) {
      if (roomId && room.id !== roomId) continue;
      const roomScenes = project.scenes.filter((scene) => scene.space === room.id);
      roomScenes.forEach((scene, index) => {
        if (!isAutoSceneTitle(scene)) return;
        scene.title = roomScenes.length === 1 ? room.label : `${room.label} view ${index + 1}`;
        scene.titleAutoGenerated = true;
      });
    }
  }

  function updateSceneLabelDom(scene) {
    panel.querySelectorAll(`[data-scene-title-for="${scene.id}"]`).forEach((node) => { node.textContent = scene.title; });
    panel.querySelectorAll(`[data-scene-room-for="${scene.id}"]`).forEach((node) => { node.textContent = scene.spaceLabel; });
    panel.querySelectorAll(`[data-scene-title-input-for="${scene.id}"]`).forEach((node) => {
      if (document.activeElement !== node) node.value = scene.title;
      node.setAttribute("aria-label", `Name for ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-preview-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Preview ${scene.title}`);
    });
  }

  function openPhotoPreview(sceneId) {
    const scene = state.workspaceProject?.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return;
    state.previewSceneId = scene.id;
    previewElements.title.textContent = scene.title;
    previewElements.room.textContent = scene.spaceLabel || "360 photo";
    previewElements.image.src = workspaceAsset(scene.panorama || scene.thumb);
    previewElements.image.alt = scene.title;
    previewDialog.hidden = false;
    document.body.classList.add("is-photo-preview-open");
    previewElements.close.focus();
    studioLog("photo-preview-opened", { sceneId: scene.id });
  }

  function closePhotoPreview() {
    if (previewDialog.hidden) return;
    previewDialog.hidden = true;
    previewElements.image.removeAttribute("src");
    document.body.classList.remove("is-photo-preview-open");
    studioLog("photo-preview-closed", { sceneId: state.previewSceneId });
    state.previewSceneId = null;
  }

  function workspaceAsset(path) {
    return `/${endpoint}/workspace/${path}`;
  }

  function setStage(stage) {
    if (!stageOrder.includes(stage)) return;
    const previousStage = state.activeStage;
    state.activeStage = stage;
    state.placement = null;
    state.pendingFocus = null;
    if (stage !== "arrival") state.arrival = null;
    if (stage === "rooms" && previousStage === "upload") state.roomPlanSceneId = state.workspaceProject?.scenes?.[0]?.id || null;
    if (stage === "light" && previousStage === "rooms") state.lookSceneIndex = 0;
    if (stage === "links" && previousStage === "light") {
      state.linkSceneIndex = 0;
      state.linkStep = "choose";
    }
    studioLog("stage-change", { from: previousStage, to: stage }, true);
    render();
  }

  function stageOffset(offset) {
    const index = stageOrder.indexOf(state.activeStage);
    return stageOrder[Math.max(0, Math.min(stageOrder.length - 1, index + offset))];
  }

  function setSelected(sceneId, hotspotIndex, stage = "links") {
    state.selected = { sceneId, hotspotIndex };
    state.placement = null;
    state.arrival = null;
    studioLog("movement-selected", { sceneId, hotspotIndex, requestedStage: stage }, true);
    setStage(stage);
  }

  function findPendingHotspot(field) {
    for (const scene of api.scenes) {
      const hotspotIndex = scene.hotspots.findIndex((hotspot) => hotspot[field] === false);
      if (hotspotIndex >= 0) return { sceneId: scene.id, hotspotIndex };
    }
    return null;
  }

  function applyPendingFocus() {
    const focus = state.pendingFocus;
    if (!focus || api.viewer.getScene() !== focus.sceneId) return false;
    state.pendingFocus = null;
    state.activeStage = focus.stage;
    state.selected = { sceneId: focus.sceneId, hotspotIndex: focus.hotspotIndex };
    state.arrival = null;
    state.placement = focus.place ? { type: "hotspot" } : null;
    render();
    return true;
  }

  function focusHotspotTask(task, stage, place = false) {
    if (!task) return;
    const taskSceneIndex = api.scenes.findIndex((scene) => scene.id === task.sceneId);
    if (taskSceneIndex >= 0) state.linkSceneIndex = taskSceneIndex;
    state.pendingFocus = { ...task, stage, place };
    state.activeStage = stage;
    state.arrival = null;
    state.placement = null;
    if (api.viewer.getScene() === task.sceneId) applyPendingFocus();
    else api.viewer.loadScene(task.sceneId);
  }

  function renderStages() {
    panel.dataset.stage = state.activeStage;
    document.body.dataset.editorStage = state.activeStage;
    panel.querySelectorAll(".editor-stage-panel").forEach((section) => {
      section.hidden = section.dataset.stagePanel !== state.activeStage;
    });
    const index = stageOrder.indexOf(state.activeStage);
    elements.ProgressLabel.textContent = stageLabels[state.activeStage];
    elements.ProgressCount.textContent = state.activeStage === "start" ? "Ready" : `${index} of ${stageOrder.length - 1}`;
    elements.ProgressFill.style.width = `${index / (stageOrder.length - 1) * 100}%`;
    elements.Home.hidden = state.activeStage === "start";
    const readiness = releaseReadiness();
    elements.Back.hidden = ["start", "upload"].includes(state.activeStage);
    elements.Continue.hidden = ["start", "export"].includes(state.activeStage)
      || (state.activeStage === "links" && readiness.pendingPositions > 0)
      || (state.activeStage === "arrival" && readiness.pendingArrivals > 0);
    const viewerRequired = ["light", "links", "arrival"].includes(state.activeStage);
    const viewerBusy = viewerRequired && (!api.viewer.isLoaded() || !state.viewerSettled || state.viewportSettling);
    elements.Continue.disabled = (state.activeStage === "upload" && !state.workspaceProject?.scenes?.length) || viewerBusy;
    elements.Status.textContent = viewerBusy ? "Loading photo..." : state.statusMessage;
    const totalScenes = state.workspaceProject?.scenes?.length || api.scenes.length;
    elements.Continue.textContent = state.activeStage === "rooms"
      ? "Save setup"
      : state.activeStage === "light"
        ? state.lookSceneIndex < api.scenes.length - 1 ? "Next photo" : "Continue"
        : state.activeStage === "links"
          ? "Choose first views"
          : state.activeStage === "arrival" ? "Check tour" : "Continue";
    elements.Continue.classList.toggle("editor-button--primary", true);
    panel.querySelector(".editor-panel__scene").hidden = ["start", "upload", "rooms", "export"].includes(state.activeStage);
    panel.querySelector("#editorPreviousScene").hidden = true;
    panel.querySelector("#editorNextScene").hidden = true;
  }

  function moveWorkspaceScene(index, direction) {
    const project = state.workspaceProject;
    const target = index + direction;
    if (!project || target < 0 || target >= project.scenes.length) return;
    [project.scenes[index], project.scenes[target]] = [project.scenes[target], project.scenes[index]];
    renderProjectPanel();
  }

  function renderStartPanel() {
    elements.ProjectTitle.value ||= "Untitled 360 Tour";
  }

  function renderUploadPanel() {
    const project = state.workspaceProject;
    elements.ImportFiles.disabled = !project || state.importing;
    elements.ProjectEmpty.hidden = Boolean(project?.scenes?.length);
    elements.ProjectEmpty.textContent = state.importing
      ? `Preparing ${state.importProgress.current} of ${state.importProgress.total}`
      : project ? "No 360 photos yet." : "Create a tour first.";
    elements.UploadList.replaceChildren();
    if (!project) return;
    for (const scene of project.scenes) {
      const row = document.createElement("article");
      row.className = "editor-upload-item";
      const thumb = document.createElement("img");
      thumb.src = workspaceAsset(scene.thumb);
      thumb.alt = "";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = scene.title;
      const dimensions = document.createElement("span");
      dimensions.textContent = "360 photo ready";
      details.append(title, dimensions);
      const remove = document.createElement("button");
      remove.className = "editor-button editor-button--icon editor-button--danger";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove 360 photo";
      remove.setAttribute("aria-label", `Remove ${scene.title}`);
      remove.addEventListener("click", () => removeWorkspaceScene(scene.id, scene.title, "upload"));
      row.append(thumb, details, remove);
      elements.UploadList.appendChild(row);
    }
  }

  function ensureInitialRoom() {
    const project = state.workspaceProject;
    if (!project?.scenes?.length || projectRooms(project).length) return;
    const room = { id: "room-1", label: "Room 1" };
    project.rooms.push(room);
    project.scenes.forEach((scene) => {
      scene.space = room.id;
      scene.spaceLabel = room.label;
    });
  }

  function setRoomCount() {
    const project = state.workspaceProject;
    if (!project) return;
    const count = Math.max(1, Math.min(100, Number.parseInt(elements.RoomCount.value, 10) || 1));
    const rooms = projectRooms(project);
    while (rooms.length < count) {
      const number = rooms.length + 1;
      rooms.push({ id: `room-${Date.now().toString(36)}-${number}`, label: `Room ${number}` });
    }
    if (rooms.length > count) {
      const kept = rooms.slice(0, count);
      const keptIds = new Set(kept.map((room) => room.id));
      const fallback = kept[0];
      project.scenes.forEach((scene) => {
        if (keptIds.has(scene.space)) return;
        scene.space = fallback.id;
        scene.spaceLabel = fallback.label;
      });
      project.rooms = kept;
    }
    refreshAutoSceneTitles(project);
    elements.RoomCount.value = String(count);
    setStatus(`${count} room${count === 1 ? "" : "s"} ready`);
    studioLog("room-count-changed", { count });
    renderRoomsPanel();
  }

  function assignSceneToRoom(sceneId, roomId) {
    const project = state.workspaceProject;
    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    const room = projectRooms(project).find((candidate) => candidate.id === roomId);
    if (!scene || !room) return;
    const previousRoomId = scene.space;
    if (isAutoSceneTitle(scene)) scene.titleAutoGenerated = true;
    scene.space = room.id;
    scene.spaceLabel = room.label;
    refreshAutoSceneTitles(project, previousRoomId);
    refreshAutoSceneTitles(project, room.id);
    setStatus(`${scene.title} moved to ${room.label}`);
    studioLog("room-selected", { roomId: room.id, sceneId: scene.id });
    renderRoomsPanel();
  }

  function plannedTargets(scene) {
    if (!Array.isArray(scene.plannedTargets)) scene.plannedTargets = [];
    return scene.plannedTargets;
  }

  function togglePlannedTarget(sourceId, targetId) {
    const source = state.workspaceProject?.scenes.find((scene) => scene.id === sourceId);
    if (!source || source.id === targetId) return;
    const targets = plannedTargets(source);
    source.plannedTargets = targets.includes(targetId)
      ? targets.filter((id) => id !== targetId)
      : [...targets, targetId];
    setStatus(`${source.plannedTargets.length} walking route${source.plannedTargets.length === 1 ? "" : "s"} selected from ${source.title}`);
    studioLog("planned-place-toggled", { sourceSceneId: sourceId, targetSceneId: targetId, selected: source.plannedTargets.includes(targetId) });
    renderRoomsPanel();
  }

  function renderRoomsPanel() {
    const project = state.workspaceProject;
    elements.RoomList.replaceChildren();
    elements.ProjectOrder.replaceChildren();
    elements.RoomChoices.replaceChildren();
    elements.PlaceChoices.replaceChildren();
    elements.PlannedPlaces.replaceChildren();
    if (!project) return;
    ensureInitialRoom();
    const rooms = projectRooms(project);
    const roomIds = new Set(rooms.map((room) => room.id));
    const fallbackRoom = rooms[0];
    project.scenes.forEach((scene) => {
      if (!roomIds.has(scene.space)) {
        scene.space = fallbackRoom.id;
        scene.spaceLabel = fallbackRoom.label;
      }
      plannedTargets(scene);
    });
    refreshAutoSceneTitles(project);
    elements.RoomCount.value = String(rooms.length);

    for (const room of rooms) {
      const field = document.createElement("label");
      field.className = "editor-field editor-field--stacked";
      field.innerHTML = `<span>Room name</span><input type="text" maxlength="80" autocomplete="off" />`;
      const input = field.querySelector("input");
      input.value = room.label;
      input.setAttribute("aria-label", `Name for ${room.label}`);
      const commitRoomName = (rerender) => {
        const nextLabel = input.value.trim();
        if (!nextLabel) {
          input.value = room.label;
          setStatus("Every room needs a name");
          return;
        }
        room.label = nextLabel;
        project.scenes.filter((scene) => scene.space === room.id).forEach((scene) => { scene.spaceLabel = nextLabel; });
        refreshAutoSceneTitles(project, room.id);
        studioLog("room-name-edited", { roomId: room.id, label: nextLabel });
        if (rerender) renderRoomsPanel();
        else {
          const column = elements.ProjectOrder.querySelector(`.editor-room-column[data-room-id="${room.id}"]`);
          if (column) column.querySelector("header strong").textContent = nextLabel;
          elements.ProjectOrder.querySelectorAll(".editor-room-photo select").forEach((select) => {
            Array.from(select.options).filter((option) => option.value === room.id).forEach((option) => { option.textContent = nextLabel; });
          });
          project.scenes.filter((scene) => scene.space === room.id).forEach(updateSceneLabelDom);
        }
      };
      input.addEventListener("input", () => commitRoomName(false));
      input.addEventListener("change", () => commitRoomName(true));
      elements.RoomList.appendChild(field);

      const column = document.createElement("section");
      column.className = "editor-room-column";
      column.dataset.roomId = room.id;
      const roomScenes = project.scenes.filter((scene) => scene.space === room.id);
      column.innerHTML = `<header><strong></strong><span></span></header><div class="editor-room-column__photos"></div>`;
      column.querySelector("strong").textContent = room.label;
      column.querySelector("span").textContent = `${roomScenes.length} photo${roomScenes.length === 1 ? "" : "s"}`;
      column.addEventListener("dragover", (event) => {
        event.preventDefault();
        column.classList.add("is-drag-over");
      });
      column.addEventListener("dragleave", () => column.classList.remove("is-drag-over"));
      column.addEventListener("drop", (event) => {
        event.preventDefault();
        column.classList.remove("is-drag-over");
        assignSceneToRoom(event.dataTransfer.getData("text/plain"), room.id);
      });
      const photoList = column.querySelector(".editor-room-column__photos");
      roomScenes.forEach((scene) => {
        const card = document.createElement("article");
        card.className = `editor-room-photo${state.roomPlanSceneId === scene.id ? " is-selected" : ""}`;
        card.draggable = true;
        card.dataset.sceneId = scene.id;
        card.innerHTML = `<div class="editor-room-photo__media"><button type="button" class="editor-room-photo__select"><img alt="" /><span>Choose routes</span></button><button class="editor-card-preview" type="button">Preview</button></div><label class="editor-field editor-field--stacked"><span>Photo name</span><input type="text" maxlength="80" autocomplete="off" /></label><label class="editor-field editor-field--stacked"><span>Room</span><select></select></label>`;
        card.querySelector("img").src = workspaceAsset(scene.thumb);
        const choose = card.querySelector("button");
        choose.setAttribute("aria-label", `Choose routes from ${scene.title}`);
        choose.draggable = true;
        choose.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || event.pointerType !== "mouse") return;
          roomPointerDrag = { sceneId: scene.id, startX: event.clientX, startY: event.clientY, moved: false };
        });
        choose.addEventListener("click", () => {
          state.roomPlanSceneId = scene.id;
          setStatus(`Choose where people can walk from ${scene.title}`);
          renderRoomsPanel();
        });
        const preview = card.querySelector(".editor-card-preview");
        preview.dataset.scenePreviewFor = scene.id;
        preview.setAttribute("aria-label", `Preview ${scene.title}`);
        preview.addEventListener("click", () => openPhotoPreview(scene.id));
        const titleInput = card.querySelector("input");
        titleInput.value = scene.title;
        titleInput.dataset.sceneTitleInputFor = scene.id;
        titleInput.setAttribute("aria-label", `Name for ${scene.title}`);
        titleInput.addEventListener("input", () => {
          scene.title = titleInput.value;
          scene.titleAutoGenerated = false;
          updateSceneLabelDom(scene);
          studioLog("view-name-edited", { sceneId: scene.id });
        });
        titleInput.addEventListener("change", () => {
          if (!scene.title.trim()) {
            scene.titleAutoGenerated = true;
            refreshAutoSceneTitles(project, scene.space);
            renderRoomsPanel();
            return;
          }
          updateSceneLabelDom(scene);
        });
        const roomSelect = card.querySelector("select");
        roomSelect.setAttribute("aria-label", `Room for ${scene.title}`);
        rooms.forEach((candidate) => roomSelect.add(new Option(candidate.label, candidate.id)));
        roomSelect.value = room.id;
        roomSelect.addEventListener("change", () => assignSceneToRoom(scene.id, roomSelect.value));
        const beginDrag = (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", scene.id);
          card.classList.add("is-dragging");
        };
        card.addEventListener("dragstart", beginDrag);
        choose.addEventListener("dragstart", beginDrag);
        card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
        photoList.appendChild(card);
      });
      elements.ProjectOrder.appendChild(column);
    }

    if (!state.roomPlanSceneId || !project.scenes.some((scene) => scene.id === state.roomPlanSceneId)) {
      state.roomPlanSceneId = project.scenes[0]?.id || null;
    }
    project.scenes.forEach((scene) => {
      const button = document.createElement("button");
      button.className = `editor-photo-choice${scene.id === state.roomPlanSceneId ? " is-selected" : ""}`;
      button.type = "button";
      button.setAttribute("aria-pressed", String(scene.id === state.roomPlanSceneId));
      button.innerHTML = `<img alt="" /><span></span>`;
      button.querySelector("img").src = workspaceAsset(scene.thumb);
      const title = button.querySelector("span");
      title.dataset.sceneTitleFor = scene.id;
      title.textContent = scene.title;
      button.addEventListener("click", () => {
        state.roomPlanSceneId = scene.id;
        renderRoomsPanel();
      });
      elements.RoomChoices.appendChild(button);
    });

    const source = project.scenes.find((scene) => scene.id === state.roomPlanSceneId);
    if (source) {
      const selectedTargets = plannedTargets(source);
      elements.RoomTaskProgress.textContent = `${selectedTargets.length} walking route${selectedTargets.length === 1 ? "" : "s"} from ${source.title}`;
      project.scenes.filter((scene) => scene.id !== source.id).forEach((target) => {
        const selected = selectedTargets.includes(target.id);
        const card = document.createElement("article");
        card.className = "editor-place-choice-card";
        const button = document.createElement("button");
        button.className = `editor-place-choice${selected ? " is-selected" : ""}`;
        button.type = "button";
        button.setAttribute("aria-pressed", String(selected));
        button.innerHTML = `<img alt="" /><span><strong></strong><small></small></span><i aria-hidden="true"></i>`;
        button.querySelector("img").src = workspaceAsset(target.thumb);
        const targetTitle = button.querySelector("strong");
        targetTitle.dataset.sceneTitleFor = target.id;
        targetTitle.textContent = target.title;
        const targetRoom = button.querySelector("small");
        targetRoom.dataset.sceneRoomFor = target.id;
        targetRoom.textContent = target.spaceLabel;
        button.querySelector("i").textContent = selected ? "✓" : "+";
        button.addEventListener("click", () => togglePlannedTarget(source.id, target.id));
        const preview = document.createElement("button");
        preview.className = "editor-card-preview editor-card-preview--inline";
        preview.type = "button";
        preview.textContent = "Preview";
        preview.dataset.scenePreviewFor = target.id;
        preview.setAttribute("aria-label", `Preview ${target.title}`);
        preview.addEventListener("click", () => openPhotoPreview(target.id));
        card.append(button, preview);
        elements.PlaceChoices.appendChild(card);
      });
      const summary = document.createElement("p");
      summary.textContent = selectedTargets.length
        ? `Walking buttons: ${selectedTargets.map((id) => project.scenes.find((scene) => scene.id === id)?.title).filter(Boolean).join(", ")}`
        : "No walking buttons selected yet.";
      elements.PlannedPlaces.appendChild(summary);
    }
    const totalPlaces = project.scenes.reduce((total, scene) => total + plannedTargets(scene).length, 0);
    elements.AssignmentStatus.textContent = `${project.scenes.length} photos in ${rooms.length} room${rooms.length === 1 ? "" : "s"}; ${totalPlaces} walking button${totalPlaces === 1 ? "" : "s"}`;
  }

  function renderProjectPanel() {
    document.body.classList.toggle("is-workspace-ready", Boolean(workspaceMode && state.workspaceProject?.scenes?.length));
    renderStartPanel();
    renderUploadPanel();
    renderRoomsPanel();
  }

  async function refreshWorkspaceProject() {
    const response = await fetch(studioUrl("workspace-project", false));
    if (!response.ok) throw new Error(`Could not read workspace (${response.status})`);
    state.workspaceProject = (await response.json()).project || null;
    return state.workspaceProject;
  }

  async function createWorkspace(replace = false) {
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", title: elements.ProjectTitle.value, replace })
    });
    if (response.status === 409 && !replace) {
      if (window.confirm("Replace the current tour? Its local edits and imported copies will be removed. Original camera photos stay safe.")) return createWorkspace(true);
      return null;
    }
    if (!response.ok) throw new Error((await response.json()).error || `Could not create project (${response.status})`);
    state.workspaceProject = await response.json();
    setStatus("Project created");
    window.sessionStorage.setItem(stageStorageKey, "upload");
    window.location.assign(`${window.location.pathname}?edit=1`);
    return state.workspaceProject;
  }

  async function saveWorkspaceStructure(nextStage = null) {
    const project = state.workspaceProject;
    if (!project?.scenes?.length) throw new Error("Add at least one 360 photo first.");
    const usedRoomIds = new Set(project.scenes.map((scene) => scene.space));
    const rooms = projectRooms(project).filter((room) => room.label.trim() && usedRoomIds.has(room.id));
    if (!rooms.length) throw new Error("Create at least one room.");
    const roomIds = new Set(rooms.map((room) => room.id));
    if (project.scenes.some((scene) => !roomIds.has(scene.space))) throw new Error("Choose a room for every photo.");
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "structure",
        title: project.title,
        rooms,
        firstScene: project.firstScene,
        sceneIds: project.scenes.map((scene) => scene.id),
        scenes: project.scenes.map(({ id, title, titleAutoGenerated, subtitle, space, spaceLabel, plannedTargets: targets }) => ({
          id,
          title,
          titleAutoGenerated: titleAutoGenerated === true,
          subtitle,
          space,
          spaceLabel,
          plannedTargets: Array.isArray(targets) ? targets : []
        }))
      })
    });
    if (!response.ok) throw new Error((await response.json()).error || `Could not save room structure (${response.status})`);
    state.workspaceProject = await response.json();
    setStatus("Room structure saved");
    if (workspaceMode) {
      window.sessionStorage.setItem(stageStorageKey, nextStage || "rooms");
      window.location.reload();
    } else {
      window.sessionStorage.setItem(stageStorageKey, nextStage || "rooms");
      window.location.assign(workspaceEditorUrl());
    }
  }

  async function removeWorkspaceScene(sceneId, title, returnStage = state.activeStage) {
    if (!window.confirm(`Remove ${title} from this project? The original upload will not be deleted.`)) return;
    setStatus(`Removing ${title}`);
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove", sceneId })
    });
    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error || `Could not remove viewpoint (${response.status})`);
      return;
    }
    state.workspaceProject = body;
    window.sessionStorage.setItem(stageStorageKey, returnStage);
    window.location.assign(body.scenes.length ? workspaceEditorUrl() : `${window.location.pathname}?edit=1`);
  }

  async function importPanoramas() {
    const files = [...elements.ImportFiles.files];
    if (!files.length || !state.workspaceProject) return;
    const roomLabel = "Unassigned";
    const roomId = "room-unassigned";
    state.importing = true;
    state.importProgress = { current: 0, total: files.length };
    renderProjectPanel();
    let imported = 0;
    try {
      for (const [index, file] of files.entries()) {
        state.importProgress.current = index + 1;
        renderUploadPanel();
        setStatus(`Preparing ${index + 1} of ${files.length}: ${file.name}`);
        const response = await fetch(studioUrl("workspace-import", true), {
          method: "POST",
          headers: {
            "content-type": "image/jpeg",
            "x-tour-file-name": encodeURIComponent(file.name),
            "x-tour-room-id": encodeURIComponent(roomId),
            "x-tour-room-label": encodeURIComponent(roomLabel)
          },
          body: file
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Import failed (${response.status})`);
        state.workspaceProject = body.project;
        imported += 1;
      }
      setStatus(`${imported} photo${imported === 1 ? "" : "s"} added`);
      window.sessionStorage.setItem(stageStorageKey, "upload");
      window.location.assign(workspaceEditorUrl());
    } catch (error) {
      setStatus(imported ? `${imported} imported; ${error.message}` : error.message);
      await refreshWorkspaceProject();
      state.importing = false;
      state.importProgress = { current: 0, total: 0 };
      elements.ImportFiles.value = "";
      renderUploadPanel();
    }
  }

  function renderSceneHeading(scene) {
    elements.SceneName.textContent = scene.title;
    elements.RoomName.textContent = scene.spaceLabel || scene.title;
  }

  function renderSceneFields(scene) {
    renderSceneHeading(scene);
  }

  function walkingIconMarkup() {
    return `<svg class="editor-walking-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.8" r="1.9" /><path d="m11.6 8.3 2.1 3.8 3.2 1.4" /><path d="m13.3 12.1-2 3.5-2.7 2.2" /><path d="m13.3 12.1 1.5 4.1 2.9 2.1" /><path d="m11.8 8.7-3.2 2.4" /></svg>`;
  }

  function renderHotspotButtons(container, scene, targetStage) {
    container.replaceChildren();
    if (!scene.hotspots.length) {
      const empty = document.createElement("p");
      empty.className = "editor-empty";
      empty.textContent = "No movement buttons in this view.";
      container.appendChild(empty);
      return;
    }
    scene.hotspots.forEach((hotspot, hotspotIndex) => {
      const button = document.createElement("button");
      button.className = `editor-hotspot${state.selected?.sceneId === scene.id && state.selected.hotspotIndex === hotspotIndex ? " is-selected" : ""}`;
      button.type = "button";
      const pending = targetStage === "links" && hotspot.positionConfirmed === false
        ? "Place button"
        : targetStage === "arrival" && hotspot.arrivalConfirmed === false
          ? "Set arrival"
          : "Ready";
      button.innerHTML = `<span class="editor-hotspot__type">${walkingIconMarkup()}</span><span class="editor-hotspot__label"></span><span class="editor-hotspot__coords"></span>`;
      button.querySelector(".editor-hotspot__label").textContent = hotspot.label;
      button.querySelector(".editor-hotspot__coords").textContent = pending;
      button.addEventListener("click", () => setSelected(scene.id, hotspotIndex, targetStage));
      container.appendChild(button);
    });
  }

  function renderHotspotList(scene) {
    if (state.activeStage !== "links") return;
    const selected = selectedHotspot();
    const source = selected?.scene || api.scenes[state.linkSceneIndex] || scene;
    const allTasks = api.scenes.flatMap((candidate) => candidate.hotspots.map((hotspot, hotspotIndex) => ({ scene: candidate, hotspot, hotspotIndex })));
    const selectedTaskIndex = state.selected
      ? allTasks.findIndex((task) => task.scene.id === state.selected.sceneId && task.hotspotIndex === state.selected.hotspotIndex)
      : -1;
    elements.LinkTaskProgress.textContent = selectedTaskIndex >= 0
      ? `Walking button ${selectedTaskIndex + 1} of ${allTasks.length}`
      : `${allTasks.length} walking button${allTasks.length === 1 ? "" : "s"} placed`;
    elements.HotspotList.replaceChildren();
    source.hotspots.forEach((hotspot, hotspotIndex) => {
      const target = api.sceneById[hotspot.target];
      const row = document.createElement("button");
      const isSelected = state.selected?.sceneId === source.id && state.selected.hotspotIndex === hotspotIndex;
      row.className = `editor-saved-movement${isSelected ? " is-selected" : ""}`;
      row.type = "button";
      row.innerHTML = `<span>${walkingIconMarkup()}</span><strong></strong><small></small>`;
      row.querySelector("strong").textContent = target?.title || hotspot.label;
      row.querySelector("small").textContent = hotspot.positionConfirmed ? "Position saved" : "Needs a position";
      row.addEventListener("click", () => {
        state.selected = { sceneId: source.id, hotspotIndex };
        state.linkStep = "place";
        setStatus(`Place the walking button for ${target?.title || "this place"}`);
        render();
      });
      elements.HotspotList.appendChild(row);
    });
    elements.HotspotList.hidden = source.hotspots.length <= 1;
    elements.PlaceAtCentre.hidden = !selected;
    elements.ConfirmCentre.disabled = !selected || api.viewer.getScene() !== source.id || !api.viewer.isLoaded() || !state.viewerSettled || state.viewportSettling;
    const target = selected ? api.sceneById[selected.hotspot.target] : null;
    elements.LinkGuidance.textContent = selected
      ? `From ${selected.scene.title} to ${target?.title || "the selected place"}.`
      : "Every walking button has an exact position.";
  }

  function renderArrivalPanel(scene) {
    if (state.activeStage !== "arrival") return;
    const viewerReady = Boolean(api.viewer.isLoaded() && state.viewerSettled && !state.viewportSettling);
    const selected = selectedHotspot();
    if (!selected) {
      elements.ArrivalHelp.textContent = "Every first view is saved. Continue to check and publish the tour.";
      elements.EditArrival.disabled = true;
      elements.EditArrival.hidden = true;
      elements.SaveArrival.hidden = true;
      return;
    }
    elements.EditArrival.disabled = !viewerReady || state.arrivalLoading;
    if (state.arrival) {
      const target = api.sceneById[selected.hotspot.target];
      elements.ArrivalHelp.textContent = viewerReady
        ? `You are now in ${target?.title || "the destination"}. Rotate to the clearest, most useful view, then save it.`
        : `Loading ${target?.title || "the destination"}...`;
      elements.EditArrival.hidden = true;
      elements.SaveArrival.hidden = false;
      elements.SaveArrival.disabled = !viewerReady;
      return;
    }
    const target = api.sceneById[selected.hotspot.target];
    elements.ArrivalHelp.textContent = viewerReady
      ? `Next place: ${scene.title} to ${target?.title || "the destination"}. Open it and choose the first view.`
      : "Loading the source photo...";
    elements.EditArrival.textContent = `Open ${target?.title || "destination"}`;
    elements.EditArrival.hidden = false;
    elements.SaveArrival.hidden = true;
  }

  function renderImageControls(sceneId) {
    const adjustment = api.getSceneAdjustment(sceneId);
    const fields = [
      { key: "brightness", label: "Brightness", min: 70, max: 130, unit: "%" },
      { key: "contrast", label: "Contrast", min: 70, max: 130, unit: "%" },
      { key: "saturation", label: "Saturation", min: 0, max: 160, unit: "%" },
      { key: "warmth", label: "Warm / cool", min: -20, max: 20, unit: "" }
    ];
    elements.ImageControls.replaceChildren();
    fields.forEach((field) => {
      const label = document.createElement("label");
      label.className = "editor-image__control";
      const name = document.createElement("span");
      name.textContent = field.label;
      const row = document.createElement("span");
      row.className = "editor-image__slider-row";
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = "1";
      input.value = String(adjustment[field.key]);
      input.setAttribute("aria-label", field.label);
      const output = document.createElement("output");
      output.textContent = `${adjustment[field.key]}${field.unit}`;
      input.addEventListener("input", () => {
        api.setSceneAdjustment(sceneId, { ...api.getSceneAdjustment(sceneId), [field.key]: Number(input.value) });
        output.textContent = `${input.value}${field.unit}`;
        setStatus("Saving picture changes...");
        scheduleDraftSave(`picture-${field.key}`);
      });
      row.append(input, output);
      label.append(name, row);
      elements.ImageControls.appendChild(label);
    });
  }

  function renderImagePresets(sceneId) {
    const presets = [
      { label: "Natural", values: { brightness: 100, contrast: 100, saturation: 100, warmth: 0 } },
      { label: "Bright", values: { brightness: 106, contrast: 102, saturation: 103, warmth: 1 } },
      { label: "Warm", values: { brightness: 103, contrast: 101, saturation: 104, warmth: 5 } }
    ];
    const current = api.getSceneAdjustment(sceneId);
    elements.ImagePresets.replaceChildren();
    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.className = `editor-preset${Object.entries(preset.values).every(([key, value]) => current[key] === value) ? " is-active" : ""}`;
      button.type = "button";
      button.textContent = preset.label;
      button.addEventListener("click", () => {
        api.setSceneAdjustment(sceneId, preset.values);
        setStatus(`${preset.label} look selected`);
        renderImagePresets(sceneId);
        renderImageControls(sceneId);
        queueDraftSave(`picture-preset-${preset.label.toLowerCase()}`);
      });
      elements.ImagePresets.appendChild(button);
    });
  }

  function updateSelectedAdjustment(change) {
    const scene = currentScene();
    const adjustment = selectedAdjustment();
    if (!scene || !adjustment) return;
    api.setLocalAdjustments(scene.id, api.getLocalAdjustments(scene.id).map((item) => item.id === adjustment.id ? { ...item, ...change } : item));
    setStatus("Saving local area...");
    renderLocalAdjustments(scene.id);
    scheduleDraftSave("light-area-changed");
  }

  function createRangeControl(labelText, key, minimum, maximum, unit = "") {
    const adjustment = selectedAdjustment();
    const label = document.createElement("label");
    label.className = "editor-image__control";
    const name = document.createElement("span");
    name.textContent = labelText;
    const row = document.createElement("span");
    row.className = "editor-image__slider-row";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(minimum);
    input.max = String(maximum);
    input.step = "1";
    input.value = String(adjustment[key]);
    input.setAttribute("aria-label", labelText);
    const output = document.createElement("output");
    output.textContent = `${adjustment[key]}${unit}`;
    input.addEventListener("input", () => {
      updateSelectedAdjustment({ [key]: Number(input.value) });
      output.textContent = `${input.value}${unit}`;
    });
    row.append(input, output);
    label.append(name, row);
    return label;
  }

  function renderLocalAdjustments(sceneId) {
    const adjustments = api.getLocalAdjustments(sceneId);
    elements.AdjustmentList.replaceChildren();
    if (state.selectedAdjustmentId && !adjustments.some((adjustment) => adjustment.id === state.selectedAdjustmentId)) state.selectedAdjustmentId = null;
    adjustments.forEach((adjustment, index) => {
      const button = document.createElement("button");
      button.className = `editor-adjustment${adjustment.id === state.selectedAdjustmentId ? " is-selected" : ""}`;
      button.type = "button";
      button.textContent = `Area ${index + 1}`;
      button.addEventListener("click", () => { state.selectedAdjustmentId = adjustment.id; renderLocalAdjustments(sceneId); });
      elements.AdjustmentList.appendChild(button);
    });
    elements.AdjustmentControls.replaceChildren();
    const selected = selectedAdjustment();
    if (!selected) return;

    const shape = document.createElement("label");
    shape.className = "editor-field editor-field--stacked";
    shape.innerHTML = `<span>Shape</span><select aria-label="Adjustment shape"><option value="ellipse">Circle / ellipse</option><option value="rectangle">Square / rectangle</option></select>`;
    const shapeSelect = shape.querySelector("select");
    shapeSelect.value = selected.shape;
    shapeSelect.addEventListener("change", () => updateSelectedAdjustment({ shape: shapeSelect.value }));
    const color = document.createElement("label");
    color.className = "editor-field editor-field--stacked editor-field--color";
    color.innerHTML = `<span>Light color</span><input type="color" aria-label="Light color" />`;
    const colorInput = color.querySelector("input");
    colorInput.value = selected.color;
    colorInput.addEventListener("input", () => updateSelectedAdjustment({ color: colorInput.value }));
    const actions = document.createElement("div");
    actions.className = "editor-panel__actions";
    const place = document.createElement("button");
    place.className = `editor-button${state.placement?.type === "adjustment" ? " is-active" : ""}`;
    place.type = "button";
    place.textContent = state.placement?.type === "adjustment" ? "Click the photo" : "Place area";
    place.addEventListener("click", () => {
      state.placement = state.placement?.type === "adjustment" ? null : { type: "adjustment", id: selected.id };
      setStatus(state.placement ? "Click the photo to position the area" : "Area placement cancelled");
      renderLocalAdjustments(sceneId);
    });
    const remove = document.createElement("button");
    remove.className = "editor-button";
    remove.type = "button";
    remove.textContent = "Remove area";
    remove.addEventListener("click", () => {
      api.setLocalAdjustments(sceneId, adjustments.filter((adjustment) => adjustment.id !== selected.id));
      state.selectedAdjustmentId = null;
      state.placement = null;
      setStatus("Local area removed");
      renderLocalAdjustments(sceneId);
      queueDraftSave("light-area-removed");
    });
    actions.append(place, remove);
    elements.AdjustmentControls.append(
      shape,
      color,
      createRangeControl("Light / shadow", "intensity", -100, 100, "%"),
      createRangeControl("Width", "width", 80, 720, "px"),
      createRangeControl("Height", "height", 80, 520, "px"),
      actions
    );
  }

  function renderExportPanel() {
    const rooms = new Set(api.scenes.map((scene) => scene.space)).size;
    const transitions = api.scenes.reduce((sum, scene) => sum + scene.hotspots.length, 0);
    const adjusted = api.scenes.filter((scene) => {
      const adjustment = api.getSceneAdjustment(scene.id);
      return adjustment.brightness !== 100 || adjustment.contrast !== 100 || adjustment.saturation !== 100 || adjustment.warmth !== 0 || api.getLocalAdjustments(scene.id).length > 0;
    }).length;
    elements.ExportSummary.innerHTML = `<div><strong>${rooms}</strong><span>Rooms</span></div><div><strong>${api.scenes.length}</strong><span>Views</span></div><div><strong>${transitions}</strong><span>Places</span></div><div><strong>${adjusted}</strong><span>Picture changes</span></div>`;
    const readiness = releaseReadiness();
    elements.Readiness.classList.toggle("is-ready", readiness.ready);
    elements.Readiness.textContent = readiness.ready
      ? "Ready to publish"
      : `Finish ${readiness.pendingPositions} point${readiness.pendingPositions === 1 ? "" : "s"} and ${readiness.pendingArrivals} destination view${readiness.pendingArrivals === 1 ? "" : "s"}.`;
    const previewUrl = `${window.location.origin}${window.location.pathname}?preview=1${workspaceMode ? "&workspace=1" : ""}`;
    elements.PreviewLink.href = state.release.ready ? `${endpoint}/release/index.html` : previewUrl;
    elements.PreviewOptionsLabel.textContent = state.release.ready ? "View or test the tour" : "Check the tour first";
    elements.PreviewLink.textContent = state.release.ready ? "Open finished tour" : "Open tour preview";
    elements.Build.disabled = !workspaceMode || state.building || !readiness.ready;
    elements.Build.hidden = state.release.ready;
    elements.Build.textContent = state.building ? "Building tour..." : "Build the tour";
    elements.ReleaseActions.hidden = !state.release.ready;
    elements.EmbedTestLink.href = `${endpoint}/release-embed-test.html`;
    elements.DownloadSingle.href = studioUrl("release-single-download");
    elements.DownloadZip.href = studioUrl("release-download");
    updateEmbedCode();
    elements.ReleaseStatus.textContent = !workspaceMode
      ? "Create a tour before publishing."
      : state.release.ready
        ? `Website file ready${state.release.singleBytes ? ` - ${(state.release.singleBytes / 1024 / 1024).toFixed(1)} MB` : ""}`
        : "The tour has not been built yet.";
  }

  function releaseReadiness() {
    const hotspots = api.scenes.flatMap((scene) => scene.hotspots);
    const pendingPositions = hotspots.filter((hotspot) => hotspot.positionConfirmed === false).length;
    const pendingArrivals = hotspots.filter((hotspot) => hotspot.arrivalConfirmed === false).length;
    return { ready: pendingPositions === 0 && pendingArrivals === 0, pendingPositions, pendingArrivals };
  }

  function updateEmbedCode() {
    const source = (elements.InstallUrl.value.trim() || "./raindigit-360-tour.html").replace(/"/g, "&quot;");
    elements.EmbedCode.value = `<iframe src="${source}" title="360 virtual tour" allow="fullscreen" allowfullscreen loading="lazy" style="width:100%;aspect-ratio:16/9;border:0"></iframe>`;
  }

  async function copyEmbedCode() {
    updateEmbedCode();
    try {
      await navigator.clipboard.writeText(elements.EmbedCode.value);
    } catch {
      elements.EmbedCode.focus();
      elements.EmbedCode.select();
      document.execCommand("copy");
    }
    setStatus("Website code copied");
  }

  function syncSelectedMarker() {
    const activeId = state.selected ? api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex) : "";
    viewerElement.querySelectorAll(".nav-hotspot").forEach((element) => {
      element.classList.toggle("is-editor-selected", element.dataset.editorHotspotId === activeId);
    });
  }

  function render() {
    const scene = currentScene();
    if (!scene) return;
    renderStages();
    renderProjectPanel();
    renderSceneFields(scene);
    renderHotspotList(scene);
    renderArrivalPanel(scene);
    renderImagePresets(scene.id);
    renderImageControls(scene.id);
    renderLocalAdjustments(scene.id);
    renderExportPanel();
    syncSelectedMarker();
    const placing = Boolean(state.placement);
    placementSurface.hidden = !placing;
    placementSurface.setAttribute("aria-label", state.placement?.type === "hotspot" ? "Place selected movement" : "Place light area");
    document.body.classList.toggle("is-editor-placing", placing);
    const centringSelection = selectedHotspot();
    const centring = state.activeStage === "links" && state.linkStep === "place" && centringSelection?.scene.id === api.viewer.getScene();
    centreTarget.hidden = !centring;
    document.body.classList.toggle("is-editor-centre-target", centring);
  }

  async function moveScene(direction) {
    if (state.sceneMoving || api.scenes.length < 2) {
      studioLog("scene-change-ignored", { direction, reason: state.sceneMoving ? "already-moving" : "single-scene" }, true);
      return;
    }
    state.sceneMoving = true;
    const sourceSceneId = api.viewer.getScene();
    studioLog("scene-change-requested", { direction, sourceSceneId }, true);
    try {
      if (!await queueDraftSave("before-scene-change")) return;
      const currentIndex = api.scenes.findIndex((scene) => scene.id === api.viewer.getScene());
      const nextIndex = (currentIndex + direction + api.scenes.length) % api.scenes.length;
      const targetSceneId = api.scenes[nextIndex].id;
      state.arrival = null;
      state.placement = null;
      await new Promise((resolve) => {
        let timeoutId = 0;
        const onSceneChange = (sceneId) => {
          if (sceneId !== targetSceneId) return;
          api.viewer.off("scenechange", onSceneChange);
          window.clearTimeout(timeoutId);
          resolve();
        };
        timeoutId = window.setTimeout(() => {
          api.viewer.off("scenechange", onSceneChange);
          resolve();
        }, 5000);
        api.viewer.on("scenechange", onSceneChange);
        api.viewer.loadScene(targetSceneId);
      });
      studioLog("scene-change-complete", { direction, sourceSceneId, targetSceneId }, true);
    } finally {
      state.sceneMoving = false;
    }
  }

  function applyPlacement(event) {
    const placementType = state.placement?.type;
    const [pitch, yaw] = api.viewer.mouseEventToCoords(event);
    if (state.placement?.type === "hotspot") {
      const selected = selectedHotspot();
      if (!selected) return;
      selected.hotspot.positionConfirmed = true;
      api.updateHotspotCoordinates(state.selected.sceneId, state.selected.hotspotIndex, { pitch: roundCoordinate(pitch), yaw: roundCoordinate(yaw) });
      setStatus("Movement point placed");
      studioLog("movement-placed", {
        id: api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex),
        pitch: roundCoordinate(pitch),
        yaw: roundCoordinate(yaw)
      }, true);
    }
    if (state.placement?.type === "adjustment") {
      const scene = currentScene();
      api.setLocalAdjustments(scene.id, api.getLocalAdjustments(scene.id).map((adjustment) => adjustment.id === state.placement.id
        ? { ...adjustment, pitch: roundCoordinate(pitch), yaw: roundCoordinate(yaw) }
        : adjustment));
      setStatus(`Area positioned at ${roundCoordinate(pitch)} / ${roundCoordinate(yaw)}`);
    }
    state.placement = null;
    render();
    queueDraftSave(placementType === "adjustment" ? "adjustment-placed" : "movement-placed");
  }

  function syncPlannedPlacesToDraft() {
    const projectScenes = new Map((state.workspaceProject?.scenes || []).map((scene) => [scene.id, scene]));
    let changed = false;
    for (const scene of api.scenes) {
      const projectScene = projectScenes.get(scene.id);
      if (!projectScene) continue;
      const existing = api.getAddedHotspots(scene.id);
      if (!Array.isArray(projectScene.plannedTargets)) {
        projectScene.plannedTargets = [...new Set(existing.map((hotspot) => hotspot.target))];
      }
      const existingByTarget = new Map(existing.map((hotspot) => [hotspot.target, hotspot]));
      const desired = plannedTargets(projectScene)
        .filter((targetId) => targetId !== scene.id && api.sceneById[targetId])
        .map((targetId) => {
          const target = api.sceneById[targetId];
          const current = existingByTarget.get(targetId);
          return {
            ...(current || {
              pitch: 0,
              yaw: 0,
              targetPitch: target.pitch,
              targetYaw: target.yaw,
              targetHfov: target.hfov,
              positionConfirmed: false,
              arrivalConfirmed: false
            }),
            kind: "doorway",
            target: targetId,
            label: `Go to ${target.title}`
          };
        });
      if (JSON.stringify(existing) !== JSON.stringify(desired)) {
        api.setAddedHotspots(scene.id, desired);
        changed = true;
      }
    }
    if (changed) studioLog("planned-places-synchronised", {
      places: api.scenes.reduce((total, scene) => total + api.getAddedHotspots(scene.id).length, 0)
    }, true);
    return changed;
  }

  function createDraft() {
    const overrides = {};
    api.scenes.forEach((scene) => {
      scene.hotspots.forEach((hotspot, hotspotIndex) => {
        overrides[api.hotspotId(scene.id, hotspotIndex)] = {
          pitch: roundCoordinate(hotspot.pitch),
          yaw: roundCoordinate(hotspot.yaw),
          targetPitch: roundCoordinate(hotspot.targetPitch),
          targetYaw: roundCoordinate(hotspot.targetYaw),
          targetHfov: roundCoordinate(hotspot.targetHfov)
        };
      });
    });
    return {
      schema: "raindigit-tour-hotspot-overrides/v1",
      updatedAt: new Date().toISOString(),
      overrides,
      addedHotspots: Object.fromEntries(api.scenes.map((scene) => [scene.id, api.getAddedHotspots(scene.id)])),
      sceneMetadata: Object.fromEntries(api.scenes.map((scene) => [scene.id, { title: scene.title, subtitle: scene.subtitle || "" }])),
      sceneViews: Object.fromEntries(api.scenes.map((scene) => [scene.id, api.getSceneView(scene.id)])),
      sceneAdjustments: Object.fromEntries(api.scenes.map((scene) => [scene.id, api.getSceneAdjustment(scene.id)])),
      localAdjustments: Object.fromEntries(api.scenes.map((scene) => [scene.id, api.getLocalAdjustments(scene.id)]))
    };
  }

  function applyDraft(draft) {
    if (!draft || draft.schema !== "raindigit-tour-hotspot-overrides/v1" || typeof draft.overrides !== "object") return;
    Object.entries(draft.addedHotspots || {}).forEach(([sceneId, hotspots]) => api.setAddedHotspots(sceneId, hotspots));
    Object.entries(draft.overrides).forEach(([key, override]) => {
      const [sceneId, hotspotIndex] = key.split("::");
      if (Number(hotspotIndex) >= api.getBaseHotspotCount(sceneId) && Array.isArray(draft.addedHotspots?.[sceneId])) return;
      api.updateHotspotCoordinates(sceneId, Number(hotspotIndex), override);
      if (Number.isFinite(override.targetPitch) && Number.isFinite(override.targetYaw) && Number.isFinite(override.targetHfov)) {
        api.updateHotspotArrival(sceneId, Number(hotspotIndex), { pitch: override.targetPitch, yaw: override.targetYaw, hfov: override.targetHfov });
      }
    });
    Object.entries(draft.sceneMetadata || {}).forEach(([sceneId, metadata]) => api.setSceneMetadata(sceneId, metadata));
    Object.entries(draft.sceneViews || {}).forEach(([sceneId, view]) => api.setSceneView(sceneId, view));
    Object.entries(draft.sceneAdjustments || {}).forEach(([sceneId, adjustment]) => api.setSceneAdjustment(sceneId, adjustment));
    Object.entries(draft.localAdjustments || {}).forEach(([sceneId, adjustments]) => api.setLocalAdjustments(sceneId, adjustments));
    state.savedAt = draft.updatedAt || null;
  }

  async function saveDraft(reason = "manual") {
    const draft = createDraft();
    const hotspotCounts = Object.fromEntries(api.scenes.map((scene) => [scene.id, scene.hotspots.length]));
    studioLog("draft-save-start", { reason, updatedAt: draft.updatedAt, hotspotCounts }, true);
    setStatus("Saving locally...");
    try {
      const response = await fetch(studioUrl("save"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!response.ok) throw new Error((await response.json()).error || `Save failed (${response.status})`);
      state.savedAt = draft.updatedAt;
      state.release = { ready: false };
      setStatus("Saved locally");
      renderExportPanel();
      studioLog("draft-save-success", { reason, updatedAt: draft.updatedAt, hotspotCounts }, true);
      return true;
    } catch (error) {
      setStatus(error.message);
      studioLog("draft-save-failed", { reason, message: error.message, hotspotCounts }, true);
      return false;
    }
  }

  function queueDraftSave(reason) {
    if (draftSaveTimer) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = 0;
    }
    draftSavePromise = draftSavePromise.catch(() => false).then(() => saveDraft(reason));
    return draftSavePromise;
  }

  function scheduleDraftSave(reason, delay = 350) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      draftSaveTimer = 0;
      queueDraftSave(reason);
    }, delay);
  }

  function openSceneAt(index) {
    const target = api.scenes[index];
    if (!target || api.viewer.getScene() === target.id) {
      render();
      return;
    }
    api.viewer.loadScene(target.id);
  }

  function validateTourSetup() {
    const project = state.workspaceProject;
    if (!project?.scenes?.length) return false;
    const rooms = projectRooms(project);
    const roomIds = new Set(rooms.map((room) => room.id));
    const unnamedRoom = rooms.find((room) => !room.label.trim());
    if (unnamedRoom) {
      setStatus("Name every room before continuing");
      return false;
    }
    const incompleteScene = project.scenes.find((scene) => !scene.title.trim() || !roomIds.has(scene.space));
    if (incompleteScene) {
      setStatus(!incompleteScene.title.trim() ? "Name every photo before continuing" : "Put every photo in a room");
      return false;
    }
    if (project.scenes.length > 1) {
      const totalPlaces = project.scenes.reduce((total, scene) => total + plannedTargets(scene).length, 0);
      if (totalPlaces === 0) {
        state.roomPlanSceneId = project.scenes[0].id;
        renderRoomsPanel();
        setStatus("Choose at least one walking route");
        return false;
      }
    }
    studioLog("tour-setup-complete", {
      rooms: rooms.length,
      scenes: project.scenes.length,
      places: project.scenes.reduce((total, scene) => total + plannedTargets(scene).length, 0)
    });
    return true;
  }

  async function backWizard() {
    if (state.activeStage === "light" && state.lookSceneIndex > 0) {
      state.lookSceneIndex -= 1;
      openSceneAt(state.lookSceneIndex);
      return;
    }
    if (state.activeStage === "links") {
      if (!await queueDraftSave("before-leaving-walking-buttons")) return;
      setStage("light");
      return;
    }
    setStage(stageOffset(-1));
  }

  async function continueWizard() {
    if (state.activeStage === "upload") {
      if (!state.workspaceProject?.scenes?.length) {
        setStatus("Add at least one 360 photo first");
        return;
      }
      ensureInitialRoom();
      setStage("rooms");
      return;
    }
    if (state.activeStage === "rooms") {
      if (!validateTourSetup()) return;
      try {
        await saveWorkspaceStructure("light");
      } catch (error) {
        setStatus(error.message);
      }
      return;
    }
    if (state.activeStage === "light") {
      if (!await queueDraftSave("picture-reviewed")) return;
      if (state.lookSceneIndex < api.scenes.length - 1) {
        state.lookSceneIndex += 1;
        openSceneAt(state.lookSceneIndex);
        setStatus("Choose the look for the next photo");
        return;
      }
      const nextPosition = findPendingHotspot("positionConfirmed");
      if (nextPosition) {
        state.linkStep = "place";
        focusHotspotTask(nextPosition, "links");
        setStatus("Place the first walking button");
      } else {
        setStage("links");
      }
      return;
    }
    if (state.activeStage === "links") {
      const nextPosition = findPendingHotspot("positionConfirmed");
      if (nextPosition) {
        state.linkStep = "place";
        focusHotspotTask(nextPosition, "links");
        setStatus("Place every walking button before continuing");
        return;
      }
      if (!await queueDraftSave("all-walking-buttons-placed")) return;
      const nextArrival = findPendingHotspot("arrivalConfirmed");
      if (nextArrival) {
        focusHotspotTask(nextArrival, "arrival");
        setStatus("Open the destination and choose its first view");
      } else {
        setStage("export");
      }
      return;
    }
    const readiness = releaseReadiness();
    if (state.activeStage === "arrival" && readiness.pendingArrivals > 0) {
      focusHotspotTask(findPendingHotspot("arrivalConfirmed"), "arrival");
      setStatus("Open the destination and choose its first view");
      return;
    }
    if (await queueDraftSave("continue")) setStage(stageOffset(1));
  }

  async function beginArrivalEdit() {
    if (state.arrivalLoading) return;
    const selected = selectedHotspot();
    if (!selected) return;
    const selection = { ...state.selected };
    state.arrivalLoading = true;
    setStatus("Opening the destination...");
    renderArrivalPanel(currentScene());
    await waitForViewerSettled();
    if (state.selected?.sceneId !== selection.sceneId || state.selected?.hotspotIndex !== selection.hotspotIndex) {
      state.arrivalLoading = false;
      return;
    }
    state.arrival = { ...state.selected };
    state.placement = null;
    api.viewer.loadScene(selected.hotspot.target);
    state.arrivalLoading = false;
    setStatus("Turn to the best view, then use what you see");
  }

  function saveArrivalView() {
    if (!state.arrival) return;
    const originSceneId = state.arrival.sceneId;
    const selected = selectedHotspot();
    if (selected) selected.hotspot.arrivalConfirmed = true;
    api.updateHotspotArrival(originSceneId, state.arrival.hotspotIndex, {
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      hfov: roundCoordinate(api.viewer.getHfov())
    });
    queueDraftSave("arrival-view-saved");
    state.arrival = null;
    const nextPending = findPendingHotspot("arrivalConfirmed");
    if (nextPending) {
      focusHotspotTask(nextPending, "arrival");
      setStatus("Destination view saved. Next place selected.");
      return;
    }
    state.selected = null;
    setStatus("All destination views saved");
    setStage("export");
  }

  async function refreshReleaseStatus() {
    if (!workspaceMode) return;
    try {
      const response = await fetch(studioUrl("release-status"), { cache: "no-store" });
      if (response.ok) state.release = await response.json();
    } catch {
      state.release = { ready: false };
    }
    renderExportPanel();
  }

  async function buildRelease() {
    if (!workspaceMode || state.building) return;
    if (!await queueDraftSave("before-build")) return;
    state.building = true;
    setStatus("Building tour...");
    renderExportPanel();
    try {
      const response = await fetch(studioUrl("build-release"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Build failed (${response.status})`);
      state.release = body;
      setStatus("Tour ready");
    } catch (error) {
      setStatus(error.message);
    } finally {
      state.building = false;
      renderExportPanel();
    }
  }

  function downloadBlob(blob, fileName) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function restoreProject(replace = false) {
    const file = elements.ProjectBackup.files[0];
    if (!file || state.restoring) return;
    if (state.workspaceProject && !replace && !window.confirm("Replace the current local project with this backup?")) return;
    state.restoring = true;
    elements.RestoreProject.disabled = true;
    setStatus("Opening project backup...");
    try {
      const response = await fetch(studioUrl("project-import", false), {
        method: "POST",
        headers: { "content-type": "application/zip", "x-tour-replace": "true" },
        body: file
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not open project (${response.status})`);
      window.sessionStorage.setItem(stageStorageKey, "upload");
      window.location.assign(workspaceEditorUrl());
    } catch (error) {
      setStatus(error.message);
      state.restoring = false;
      elements.RestoreProject.disabled = false;
    }
  }

  async function downloadEditableProject() {
    if (!workspaceMode || !state.workspaceProject?.scenes?.length) return;
    elements.DownloadProject.disabled = true;
    setStatus("Preparing editable project...");
    try {
      const response = await fetch(studioUrl("project-download"));
      if (!response.ok) throw new Error((await response.json()).error || `Could not prepare project (${response.status})`);
      downloadBlob(await response.blob(), "raindigit-tour-project.rdtour");
      setStatus("Editable project downloaded");
    } catch (error) {
      setStatus(error.message);
    } finally {
      elements.DownloadProject.disabled = false;
    }
  }

  elements.CreateWorkspace.addEventListener("click", async () => {
    studioLog("project-create-requested", { title: elements.ProjectTitle.value });
    try { await createWorkspace(false); } catch (error) { setStatus(error.message); }
  });
  elements.ProjectBackup.addEventListener("change", () => {
    const file = elements.ProjectBackup.files[0];
    elements.ProjectBackupName.textContent = file?.name || "Choose an editable project file";
    elements.RestoreProject.disabled = !file;
    studioLog("project-file-selected", file ? { name: file.name, size: file.size, type: file.type } : { cleared: true });
  });
  elements.RestoreProject.addEventListener("click", () => restoreProject(false));
  elements.ImportFiles.addEventListener("change", importPanoramas);
  elements.ApplyRoomCount.addEventListener("click", setRoomCount);
  elements.RoomCount.addEventListener("change", setRoomCount);
  elements.Home.addEventListener("click", () => setStage("start"));
  elements.Back.addEventListener("click", backWizard);
  elements.Continue.addEventListener("click", continueWizard);
  elements.Build.addEventListener("click", buildRelease);
  elements.DownloadProject.addEventListener("click", downloadEditableProject);
  elements.InstallUrl.addEventListener("input", updateEmbedCode);
  elements.CopyEmbed.addEventListener("click", copyEmbedCode);
  panel.querySelector("#editorClose").addEventListener("click", () => document.body.classList.remove("is-editor-open"));
  editorToggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("is-editor-open");
    editorToggle.setAttribute("aria-label", isOpen ? "Hide tour studio" : "Show tour studio");
    editorToggle.title = editorToggle.getAttribute("aria-label");
  });
  panel.querySelector("#editorPreviousScene").addEventListener("click", () => moveScene(-1));
  panel.querySelector("#editorNextScene").addEventListener("click", () => moveScene(1));
  elements.ConfirmCentre.addEventListener("click", () => {
    const selected = selectedHotspot();
    if (!selected) return;
    const pitch = roundCoordinate(api.viewer.getPitch());
    const yaw = roundCoordinate(api.viewer.getYaw());
    selected.hotspot.positionConfirmed = true;
    api.updateHotspotCoordinates(state.selected.sceneId, state.selected.hotspotIndex, { pitch, yaw });
    studioLog("movement-centre-confirmed", {
      id: api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex), pitch, yaw
    }, true);
    queueDraftSave("movement-centre-confirmed");
    const nextPending = findPendingHotspot("positionConfirmed");
    if (nextPending) {
      state.linkStep = "place";
      focusHotspotTask(nextPending, "links");
      setStatus("Walking button saved. Place the next one.");
      return;
    }
    state.linkStep = "choose";
    state.selected = null;
    setStatus("All walking buttons are placed");
    render();
  });
  elements.CancelCentre.addEventListener("click", () => {
    state.linkStep = "choose";
    state.selected = null;
    setStatus("Change the room board or selected places");
    setStage("rooms");
  });
  elements.EditArrival.addEventListener("click", beginArrivalEdit);
  elements.SaveArrival.addEventListener("click", saveArrivalView);
  elements.SaveSceneView.addEventListener("click", () => {
    const scene = currentScene();
    api.setSceneView(scene.id, {
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      hfov: roundCoordinate(api.viewer.getHfov())
    });
    setStatus("Default viewpoint not saved");
    renderArrivalPanel(scene);
    queueDraftSave("room-opening-view-saved");
  });
  elements.AddAdjustment.addEventListener("click", () => {
    const scene = currentScene();
    const existing = api.getLocalAdjustments(scene.id);
    const next = { id: `area-${Date.now().toString(36)}`, shape: "ellipse", pitch: roundCoordinate(api.viewer.getPitch()), yaw: roundCoordinate(api.viewer.getYaw()), width: 240, height: 180, intensity: 30, color: "#fff1b8" };
    api.setLocalAdjustments(scene.id, [...existing, next]);
    state.selectedAdjustmentId = next.id;
    setStatus("Local area not saved");
    renderLocalAdjustments(scene.id);
    queueDraftSave("light-area-added");
  });

  viewerElement.addEventListener("pointerdown", (event) => {
    const marker = event.target.closest("[data-editor-hotspot-id]");
    if (!marker) return;
    const [sceneId, hotspotIndex] = marker.dataset.editorHotspotId.split("::");
    event.preventDefault();
    event.stopImmediatePropagation();
    setSelected(sceneId, Number(hotspotIndex), state.activeStage === "arrival" ? "arrival" : "links");
  }, true);
  viewerElement.addEventListener("click", (event) => {
    if (event.target.closest("[data-editor-hotspot-id]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  placementSurface.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    placementPointerStart = { x: event.clientX, y: event.clientY };
    suppressPlacementClick = false;
  });
  placementSurface.addEventListener("pointermove", (event) => {
    if (!placementPointerStart) return;
    if (Math.hypot(event.clientX - placementPointerStart.x, event.clientY - placementPointerStart.y) > 6) suppressPlacementClick = true;
  });
  placementSurface.addEventListener("pointerup", () => {
    placementPointerStart = null;
  });
  placementSurface.addEventListener("pointercancel", () => {
    placementPointerStart = null;
    suppressPlacementClick = true;
  });
  placementSurface.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressPlacementClick) {
      suppressPlacementClick = false;
      setStatus("View locked. Click once to place the selected movement.");
      return;
    }
    applyPlacement(event);
  });
  placementSurface.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const bounds = placementSurface.getBoundingClientRect();
    applyPlacement({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 });
  });

  api.viewer.on("scenechange", () => {
    state.viewerSettled = false;
    if (applyPendingFocus()) return;
    const scene = currentScene();
    if (!state.arrival) state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    state.placement = null;
    render();
    studioLog("editor-scene-change", { sceneId: scene?.id || null }, true);
  });

  api.viewer.on("load", async () => {
    studioLog("editor-scene-loaded", { sceneId: api.viewer.getScene() }, true);
    state.viewerSettled = false;
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    await waitForViewerFade();
    state.viewerSettled = true;
    render();
  });

  document.addEventListener("raindigit:tour-debug", (event) => {
    const detail = event.detail || {};
    studioLog(detail.event || "runtime-event", detail.details || {});
  });

  window.addEventListener("error", (event) => {
    studioLog("window-error", {
      message: event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack || ""
    }, true);
    flushStudioLogs();
  });

  window.addEventListener("unhandledrejection", (event) => {
    studioLog("unhandled-rejection", {
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack || ""
    }, true);
    flushStudioLogs();
  });

  window.addEventListener("pagehide", () => {
    if (!studioLogBuffer.length || typeof navigator.sendBeacon !== "function") return;
    const entries = studioLogBuffer.splice(0, studioLogBuffer.length);
    navigator.sendBeacon(studioUrl("studio-log", false), new Blob([JSON.stringify({ entries })], { type: "application/json" }));
  });

  let viewportTimer = 0;
  window.addEventListener("resize", () => {
    state.viewportSettling = true;
    renderStages();
    window.clearTimeout(viewportTimer);
    viewportTimer = window.setTimeout(() => {
      api.viewer.resize();
      window.requestAnimationFrame(() => {
        state.viewportSettling = false;
        state.viewerSettled = Boolean(api.viewer.isLoaded());
        renderStages();
        studioLog("viewer-resized", { width: window.innerWidth, height: window.innerHeight });
      });
    }, 280);
  });

  window.__RAINDIGIT_STUDIO_DEBUG__ = {
    sessionId: studioSessionId,
    snapshot: studioInventory,
    flush: flushStudioLogs
  };

  function waitForViewerPaint() {
    return new Promise((resolve) => {
      const afterPaint = () => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      if (api.viewer.isLoaded()) {
        afterPaint();
        return;
      }
      const onLoad = () => {
        api.viewer.off("load", onLoad);
        afterPaint();
      };
      api.viewer.on("load", onLoad);
    });
  }

  async function waitForViewerFade(timeout = 6000) {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeout) {
      const fading = Array.from(viewerElement.querySelectorAll(".pnlm-fade-img"))
        .some((element) => Number.parseFloat(getComputedStyle(element).opacity || "0") > 0.01);
      if (!fading && api.viewer.isLoaded()) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    studioLog("viewer-settle-timeout", { sceneId: api.viewer.getScene(), timeout }, true);
    return false;
  }

  async function waitForViewerSettled(timeout = 6000) {
    await waitForViewerPaint();
    return waitForViewerFade(timeout);
  }

  Promise.all([
    fetch(studioUrl("status")).then((response) => response.ok ? response.json() : Promise.reject(new Error("Local editor server unavailable"))),
    refreshWorkspaceProject(),
    fetch(studioUrl("overrides")).then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not read draft")))
  ]).then(async ([, , draft]) => {
    await waitForViewerSettled();
    state.viewerSettled = true;
    applyDraft(draft);
    const plannedPlacesChanged = syncPlannedPlacesToDraft();
    const scene = currentScene();
    state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    setStatus(state.activeStage === "start"
      ? "Choose how to begin"
      : !state.workspaceProject
        ? "Ready to create a tour"
      : state.workspaceProject.scenes.length === 0
        ? "Tour ready. Add photos."
        : state.activeStage === "upload"
          ? `${state.workspaceProject.scenes.length} photo${state.workspaceProject.scenes.length === 1 ? "" : "s"} ready`
          : state.savedAt ? "Saved tour loaded" : "Tour ready");
    render();
    if (plannedPlacesChanged) queueDraftSave("planned-places-synchronised");
    studioLog("studio-ready", {
      savedAt: state.savedAt,
      workspaceAvailable: Boolean(state.workspaceProject),
      projectTitle: state.workspaceProject?.title || null
    }, true);
    refreshReleaseStatus();
  }).catch((error) => {
    panel.remove();
    editorToggle.remove();
    console.warn(error.message);
  });
})();
