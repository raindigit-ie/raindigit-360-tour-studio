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
  const hasSessionStage = stageOrder.includes(restoredStage) && restoredStage !== "start";
  const roundCoordinate = (value) => Math.round(value * 10) / 10;
  const state = {
    activeStage: hasSessionStage ? restoredStage : "start",
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
    arrivalQueue: [],
    arrivalQueueIndex: 0,
    arrivalQueueTotal: 0,
    arrivalLoading: false,
    arrivalSaving: false,
    placementGuides: {},
    guidePreferences: { visible: true, snapEnabled: true, snapToleranceDeg: 2.2 },
    showOriginalLook: false,
    initializing: true,
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
            <strong>Continue current tour</strong>
            <p class="editor-start-copy" id="editorCurrentProject">No local tour is open.</p>
            <button class="editor-button editor-button--wide" id="editorContinueWorkspace" type="button" disabled>Continue current tour</button>
          </section>
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
          <strong>Choose camera JPG photos</strong>
          <span>Use ready stitched 2:1 JPG photos from the camera app or desktop export.</span>
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
        <div class="editor-picture-actions"><button class="editor-button" id="editorToggleOriginal" type="button">Show original</button><button class="editor-button" id="editorApplyLookRoom" type="button">Apply look to room</button></div>
        <p class="editor-image-warning" id="editorImageWarning"></p>
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
          <div class="editor-placement-tools"><button class="editor-button" id="editorInspectSource" type="button">Inspect source photo</button><button class="editor-button" id="editorUseRoomHeight" type="button">Use room height</button><label><input id="editorGuideSnap" type="checkbox" checked /> Snap to room height</label></div>
          <details class="editor-disclosure editor-disclosure--compact"><summary>Placement details</summary><p id="editorGuideReadout"></p></details>
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
        <details class="editor-disclosure editor-disclosure--compact" id="editorFloorplanOptions">
          <summary>Optional floorplan</summary>
          <p class="editor-guidance">Add a plan of the property, then drag each numbered view to where its camera stands. This is optional and is included only when switched on.</p>
          <label class="editor-file-picker editor-file-picker--compact">
            <span id="editorMapFileName">Choose a JPG, PNG or WebP floorplan</span>
            <input id="editorMapFile" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" />
          </label>
          <label class="editor-check-row"><input id="editorMapEnabled" type="checkbox" /> Show floorplan in the finished tour</label>
          <p class="editor-empty" id="editorMapStatus"></p>
          <div class="editor-floorplan" id="editorFloorplan" hidden></div>
        </details>
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
              <span>For a website editor, copy or download one paste-in HTML block.</span>
              <a class="editor-button editor-button--primary editor-button--wide" id="editorDownloadEmbed" download="raindigit-360-tour-embed.html">Download paste-in code</a>
              <button class="editor-button editor-button--wide" id="editorCopyEmbedBlock" type="button">Copy paste-in code</button>
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
            <button class="editor-button editor-button--wide" id="editorDownloadDebug" type="button">Download debug bundle</button>
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
    "SceneName", "RoomName", "Home", "ProgressLabel", "ProgressCount", "ProgressFill", "ProjectTitle", "CreateWorkspace", "ContinueWorkspace", "CurrentProject", "ProjectBackup", "ProjectBackupName", "RestoreProject", "ImportFiles", "ProjectEmpty", "UploadList", "RoomCount", "ApplyRoomCount", "RoomList", "AssignmentStatus", "ProjectOrder", "RoomTaskProgress", "RoomChoices", "PlannedPlaces", "PlaceChoices", "HotspotList", "ArrivalList", "LinkTaskProgress", "LinkGuidance", "MovementHeading", "PlaceAtCentre", "ConfirmCentre", "CancelCentre", "InspectSource", "UseRoomHeight", "GuideSnap", "GuideReadout", "EditArrival", "SaveArrival", "ArrivalHelp", "DefaultView", "SaveSceneView", "ImagePresets", "ImageControls", "ImageWarning", "ToggleOriginal", "ApplyLookRoom", "AdjustmentList", "AdjustmentControls", "AddAdjustment", "ExportSummary", "Readiness", "FloorplanOptions", "MapFile", "MapFileName", "MapEnabled", "MapStatus", "Floorplan", "PreviewOptions", "PreviewOptionsLabel", "PreviewLink", "Build", "ReleaseActions", "EmbedTestLink", "DownloadSingle", "DownloadEmbed", "CopyEmbedBlock", "DownloadProject", "DownloadDebug", "InstallUrl", "EmbedCode", "CopyEmbed", "DownloadZip", "ReleaseStatus", "Back", "Status", "Continue"
  ].map((name) => [name, panel.querySelector(`#editor${name}`)]));
  const panelContent = panel.querySelector(".editor-panel__content");
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
  const placementGuides = document.createElement("div");
  placementGuides.className = "editor-placement-guides";
  placementGuides.hidden = true;
  placementGuides.setAttribute("aria-hidden", "true");
  placementGuides.innerHTML = '<i class="editor-placement-guides__eye"></i><i class="editor-placement-guides__floor"></i><b>Room height</b>';
  viewerElement.appendChild(placementGuides);
  const arrivalGuides = document.createElement("div");
  arrivalGuides.className = "editor-arrival-guides";
  arrivalGuides.hidden = true;
  arrivalGuides.setAttribute("aria-hidden", "true");
  arrivalGuides.innerHTML = '<i></i><i></i><span>First view</span>';
  viewerElement.appendChild(arrivalGuides);
  let placementPointerStart = null;
  let hotspotDrag = null;
  let suppressPlacementClick = false;
  let draftSavePromise = Promise.resolve(true);
  let draftSaveTimer = 0;
  const studioSessionId = window.crypto?.randomUUID?.() || `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let studioLogSequence = 0;
  let studioLogBuffer = [];
  let studioLogTimer = 0;
  let roomPointerDrag = null;
  let suppressRoomPhotoClick = false;
  let floorplanDrag = null;

  function trackRoomDragMove(event) {
    if (!roomPointerDrag) return;
    if (Math.hypot(event.clientX - roomPointerDrag.startX, event.clientY - roomPointerDrag.startY) > 8) {
      roomPointerDrag.moved = true;
    }
  }

  function finishRoomDrag(event) {
    if (!roomPointerDrag) return;
    const drag = roomPointerDrag;
    if (!drag.moved) {
      if (event.type === "mouseup") roomPointerDrag = null;
      return;
    }
    roomPointerDrag = null;
    suppressRoomPhotoClick = true;
    window.setTimeout(() => { suppressRoomPhotoClick = false; }, 0);
    const column = document.elementFromPoint(event.clientX, event.clientY)?.closest(".editor-room-column");
    if (column?.dataset.roomId) {
      const targetCard = document.elementFromPoint(event.clientX, event.clientY)?.closest(".editor-room-photo");
      moveSceneToRoomPosition(drag.sceneId, column.dataset.roomId, targetCard?.dataset.sceneId || null);
    }
  }

  document.addEventListener("pointermove", trackRoomDragMove);
  document.addEventListener("mousemove", trackRoomDragMove);
  document.addEventListener("pointerup", finishRoomDrag);
  document.addEventListener("mouseup", finishRoomDrag);
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
      arrivalQueue: {
        index: state.arrivalQueueIndex,
        total: state.arrivalQueueTotal,
        keys: state.arrivalQueue.map(arrivalTaskKey)
      },
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

  function logOperatorStep(action, details = {}) {
    studioLog("operator-step", {
      action,
      stage: state.activeStage,
      sceneId: api.viewer.getScene(),
      selected: state.selected ? { ...state.selected } : null,
      pose: {
        pitch: roundCoordinate(api.viewer.getPitch()),
        yaw: roundCoordinate(api.viewer.getYaw()),
        hfov: roundCoordinate(api.viewer.getHfov())
      },
      ...details
    }, true);
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

  function guideForScene(scene = currentScene()) {
    const roomId = scene?.space;
    const saved = roomId ? state.placementGuides[roomId] : null;
    return {
      roomId,
      defaultPitch: Number.isFinite(saved?.defaultPitch) ? saved.defaultPitch : -8,
      snapEnabled: saved?.snapEnabled ?? state.guidePreferences.snapEnabled,
      snapToleranceDeg: saved?.snapToleranceDeg ?? state.guidePreferences.snapToleranceDeg
    };
  }

  function snappedPitch(scene, pitch, allowSnap = true) {
    const guide = guideForScene(scene);
    if (!allowSnap || !guide.snapEnabled || Math.abs(pitch - guide.defaultPitch) > guide.snapToleranceDeg) return pitch;
    studioLog("guide-snap", { roomId: guide.roomId, fromPitch: roundCoordinate(pitch), toPitch: roundCoordinate(guide.defaultPitch) });
    return guide.defaultPitch;
  }

  function placementWarnings(scene, hotspot) {
    if (!scene || !hotspot) return [];
    const warnings = [];
    if (hotspot.pitch > 18 || hotspot.pitch < -48) warnings.push("The button is unusually high or low. Check the real doorway or camera point.");
    if (Math.abs(Math.abs(hotspot.yaw) - 180) < 8) warnings.push("The button is close to the panorama seam. Check it from both directions.");
    if (hotspot.pitch < -62) warnings.push("The button is near the tripod area. Check that it marks a walking path.");
    return warnings;
  }

  function selectedHotspot() {
    if (!state.selected) return null;
    const scene = api.sceneById[state.selected.sceneId];
    const hotspot = scene?.hotspots[state.selected.hotspotIndex];
    return hotspot ? { scene, hotspot } : null;
  }

  function rerenderRoomsPanelPreservingScroll() {
    const top = panelContent.scrollTop;
    renderRoomsPanel();
    panelContent.scrollTop = top;
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
    if (stage !== "arrival") {
      state.arrival = null;
      state.arrivalQueue = [];
      state.arrivalQueueIndex = 0;
      state.arrivalQueueTotal = 0;
    }
    if (stage === "rooms" && previousStage === "upload") state.roomPlanSceneId = state.workspaceProject?.scenes?.[0]?.id || null;
    if (stage === "light" && previousStage === "rooms") state.lookSceneIndex = 0;
    if (stage === "links" && previousStage === "light") {
      state.linkSceneIndex = 0;
      state.linkStep = "choose";
    }
    studioLog("stage-change", { from: previousStage, to: stage }, true);
    render();
    scheduleUiStateSave(`stage-${stage}`);
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

  function arrivalTasks() {
    return api.scenes.flatMap((scene) => scene.hotspots.map((hotspot, hotspotIndex) => ({ scene, hotspot, hotspotIndex })));
  }

  function hasArrivalView(hotspot) {
    return Number.isFinite(hotspot.targetPitch)
      && Number.isFinite(hotspot.targetYaw)
      && Number.isFinite(hotspot.targetHfov);
  }

  function propagateArrivalViewsByTarget() {
    const confirmedByTarget = new Map();
    for (const task of arrivalTasks()) {
      if (task.hotspot.arrivalConfirmed === true && hasArrivalView(task.hotspot) && !confirmedByTarget.has(task.hotspot.target)) {
        confirmedByTarget.set(task.hotspot.target, {
          pitch: roundCoordinate(task.hotspot.targetPitch),
          yaw: roundCoordinate(task.hotspot.targetYaw),
          hfov: roundCoordinate(task.hotspot.targetHfov),
          sourceSceneId: task.scene.id,
          hotspotIndex: task.hotspotIndex
        });
      }
    }

    const updated = [];
    for (const task of arrivalTasks()) {
      if (task.hotspot.arrivalConfirmed !== false) continue;
      const shared = confirmedByTarget.get(task.hotspot.target);
      if (!shared) continue;
      task.hotspot.arrivalConfirmed = true;
      const saved = api.updateHotspotArrival(task.scene.id, task.hotspotIndex, {
        pitch: shared.pitch,
        yaw: shared.yaw,
        hfov: shared.hfov
      });
      if (!saved) {
        task.hotspot.arrivalConfirmed = false;
        continue;
      }
      updated.push({
        sceneId: task.scene.id,
        hotspotIndex: task.hotspotIndex,
        targetSceneId: task.hotspot.target,
        inheritedFrom: `${shared.sourceSceneId}::${shared.hotspotIndex}`
      });
    }

    if (updated.length) studioLog("shared-arrival-views-applied", { updated, count: updated.length }, true);
    return updated.length;
  }

  function pendingArrivalTasks() {
    return arrivalTasks().filter((task) => task.hotspot.arrivalConfirmed === false);
  }

  function arrivalTaskKey(task) {
    return `${task.sceneId || task.scene?.id}::${task.hotspotIndex}`;
  }

  function arrivalTaskFromRef(reference) {
    if (!reference) return null;
    const scene = api.sceneById[reference.sceneId];
    const hotspot = scene?.hotspots[reference.hotspotIndex];
    return hotspot ? { scene, hotspot, hotspotIndex: reference.hotspotIndex, sceneId: reference.sceneId } : null;
  }

  function resetArrivalQueue() {
    const pending = pendingArrivalTasks();
    state.arrivalQueue = pending.map((task) => ({ sceneId: task.scene.id, hotspotIndex: task.hotspotIndex }));
    state.arrivalQueueIndex = 0;
    state.arrivalQueueTotal = state.arrivalQueue.length;
    studioLog("arrival-queue-reset", { total: state.arrivalQueueTotal, queue: state.arrivalQueue.map(arrivalTaskKey) }, true);
  }

  function nextArrivalQueueTask() {
    while (state.arrivalQueueIndex < state.arrivalQueue.length) {
      const task = arrivalTaskFromRef(state.arrivalQueue[state.arrivalQueueIndex]);
      if (task?.hotspot.arrivalConfirmed === false) return task;
      state.arrivalQueueIndex += 1;
    }
    return null;
  }

  function ensureArrivalQueue() {
    const hasPendingInQueue = state.arrivalQueue
      .slice(state.arrivalQueueIndex)
      .some((reference) => arrivalTaskFromRef(reference)?.hotspot.arrivalConfirmed === false);
    if (!hasPendingInQueue) resetArrivalQueue();
    return nextArrivalQueueTask();
  }

  function advanceArrivalQueuePast(savedReference) {
    const savedKey = arrivalTaskKey(savedReference);
    if (arrivalTaskKey(state.arrivalQueue[state.arrivalQueueIndex] || {}) === savedKey) {
      state.arrivalQueueIndex += 1;
      return;
    }
    state.arrivalQueue = state.arrivalQueue.filter((reference) => arrivalTaskKey(reference) !== savedKey);
    if (state.arrivalQueueIndex > state.arrivalQueue.length) state.arrivalQueueIndex = state.arrivalQueue.length;
  }

  function focusNextArrivalTask(status = "Open the destination and choose its first view") {
    const next = ensureArrivalQueue();
    if (!next) {
      state.selected = null;
      setStatus("All destination views saved");
      setStage("export");
      return false;
    }
    focusHotspotTask(next, "arrival");
    setStatus(status);
    return true;
  }

  function selectedArrivalTask() {
    if (!state.selected) {
      const total = state.arrivalQueueTotal || arrivalTasks().length;
      return { task: null, index: -1, total };
    }
    const tasks = arrivalTasks();
    const task = tasks.find((candidate) => candidate.scene.id === state.selected.sceneId && candidate.hotspotIndex === state.selected.hotspotIndex) || null;
    const queueIndex = state.arrivalQueue.findIndex((reference) => reference.sceneId === state.selected.sceneId && reference.hotspotIndex === state.selected.hotspotIndex);
    const index = queueIndex >= 0 ? queueIndex : tasks.findIndex((candidate) => candidate.scene.id === state.selected.sceneId && candidate.hotspotIndex === state.selected.hotspotIndex);
    const total = state.arrivalQueueTotal || tasks.length;
    return { task, index, total };
  }

  function applyPendingFocus() {
    const focus = state.pendingFocus;
    if (!focus || api.viewer.getScene() !== focus.sceneId) return false;
    state.pendingFocus = null;
    state.activeStage = focus.stage;
    state.selected = { sceneId: focus.sceneId, hotspotIndex: focus.hotspotIndex };
    state.arrival = null;
    state.placement = focus.place ? { type: "hotspot" } : null;
    const selected = selectedHotspot();
    if (focus.lookAtHotspot && selected?.hotspot.positionConfirmed !== false) {
      api.viewer.lookAt(selected.hotspot.pitch, selected.hotspot.yaw, Math.min(api.viewer.getHfov(), 86), 0);
    }
    render();
    return true;
  }

  function focusHotspotTask(task, stage, place = false, lookAtHotspot = false) {
    if (!task) return;
    const taskSceneIndex = api.scenes.findIndex((scene) => scene.id === task.sceneId);
    if (taskSceneIndex >= 0) state.linkSceneIndex = taskSceneIndex;
    state.pendingFocus = { ...task, stage, place, lookAtHotspot };
    state.activeStage = stage;
    state.arrival = null;
    state.placement = null;
    if (api.viewer.getScene() === task.sceneId) applyPendingFocus();
    else api.viewer.loadScene(task.sceneId);
    scheduleUiStateSave(`stage-${stage}`);
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
    const selected = selectedHotspot();
    const linkReviewReady = state.activeStage === "links" && state.linkStep === "review" && selected?.hotspot.positionConfirmed === true;
    elements.Back.hidden = ["start", "upload"].includes(state.activeStage);
    elements.Continue.hidden = ["start", "export"].includes(state.activeStage)
      || (state.activeStage === "links" && readiness.pendingPositions > 0 && !linkReviewReady)
      || (state.activeStage === "arrival" && readiness.pendingArrivals > 0 && !selected);
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
          ? readiness.pendingPositions > 0 ? "Next walking button" : "Choose first views"
          : state.activeStage === "arrival"
            ? readiness.pendingArrivals > 0
              ? state.arrival ? "Save first view" : "Open destination"
              : "Check tour"
            : "Continue";
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
    const project = state.workspaceProject;
    const saved = state.savedAt ? new Date(state.savedAt).toLocaleString() : "not saved yet";
    elements.CurrentProject.textContent = project
      ? `${project.title}: ${project.scenes.length} photo${project.scenes.length === 1 ? "" : "s"}, ${projectRooms(project).length} room${projectRooms(project).length === 1 ? "" : "s"}; saved ${saved}.`
      : "No local tour is open.";
    elements.ContinueWorkspace.disabled = !project;
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
      const thumbButton = document.createElement("button");
      thumbButton.className = "editor-upload-item__preview";
      thumbButton.type = "button";
      thumbButton.setAttribute("aria-label", `Open full preview for ${scene.title}`);
      const thumb = document.createElement("img");
      thumb.src = workspaceAsset(scene.thumb);
      thumb.alt = "";
      thumbButton.appendChild(thumb);
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = scene.title;
      const dimensions = document.createElement("span");
      dimensions.textContent = "360 photo ready";
      details.append(title, dimensions);
      const actions = document.createElement("div");
      actions.className = "editor-upload-item__actions";
      const preview = document.createElement("button");
      preview.className = "editor-button editor-button--small";
      preview.type = "button";
      preview.textContent = "Preview";
      preview.setAttribute("aria-label", `Preview ${scene.title}`);
      const remove = document.createElement("button");
      remove.className = "editor-button editor-button--icon editor-button--danger";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove 360 photo";
      remove.setAttribute("aria-label", `Remove ${scene.title}`);
      thumbButton.addEventListener("click", () => openPhotoPreview(scene.id));
      preview.addEventListener("click", () => openPhotoPreview(scene.id));
      remove.addEventListener("click", () => removeWorkspaceScene(scene.id, scene.title, "upload"));
      actions.append(preview, remove);
      row.append(thumbButton, details, actions);
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
    moveSceneToRoomPosition(sceneId, roomId);
  }

  function moveSceneToRoomPosition(sceneId, roomId, beforeSceneId = null) {
    const project = state.workspaceProject;
    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    const room = projectRooms(project).find((candidate) => candidate.id === roomId);
    if (!scene || !room) return;
    const previousRoomId = scene.space;
    if (isAutoSceneTitle(scene)) scene.titleAutoGenerated = true;
    scene.space = room.id;
    scene.spaceLabel = room.label;
    const withoutScene = project.scenes.filter((candidate) => candidate.id !== scene.id);
    const beforeIndex = beforeSceneId && beforeSceneId !== scene.id
      ? withoutScene.findIndex((candidate) => candidate.id === beforeSceneId)
      : -1;
    if (beforeIndex >= 0) {
      withoutScene.splice(beforeIndex, 0, scene);
    } else {
      let insertIndex = withoutScene.length;
      for (let index = withoutScene.length - 1; index >= 0; index -= 1) {
        if (withoutScene[index].space === room.id) {
          insertIndex = index + 1;
          break;
        }
      }
      withoutScene.splice(insertIndex, 0, scene);
    }
    project.scenes = withoutScene;
    refreshAutoSceneTitles(project, previousRoomId);
    refreshAutoSceneTitles(project, room.id);
    setStatus(`${scene.title} moved to ${room.label}`);
    studioLog("room-selected", { roomId: room.id, sceneId: scene.id, beforeSceneId });
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
    rerenderRoomsPanelPreservingScroll();
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
        roomPointerDrag = null;
        moveSceneToRoomPosition(event.dataTransfer.getData("text/plain"), room.id);
      });
      const photoList = column.querySelector(".editor-room-column__photos");
      roomScenes.forEach((scene) => {
        const card = document.createElement("article");
        card.className = `editor-room-photo${state.roomPlanSceneId === scene.id ? " is-selected" : ""}`;
        card.draggable = false;
        card.dataset.sceneId = scene.id;
        card.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          column.classList.add("is-drag-over");
          card.classList.add("is-drag-over");
        });
        card.addEventListener("dragleave", () => card.classList.remove("is-drag-over"));
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          column.classList.remove("is-drag-over");
          card.classList.remove("is-drag-over");
          roomPointerDrag = null;
          moveSceneToRoomPosition(event.dataTransfer.getData("text/plain"), room.id, scene.id);
        });
        card.innerHTML = `<div class="editor-room-photo__media"><button type="button" class="editor-room-photo__select"><img alt="" /><span>Choose routes</span></button><button class="editor-card-preview" type="button">Preview</button></div><label class="editor-field editor-field--stacked"><span>Photo name</span><input type="text" maxlength="80" autocomplete="off" /></label><label class="editor-field editor-field--stacked"><span>Room</span><select></select></label>`;
        card.querySelector("img").src = workspaceAsset(scene.thumb);
        const choose = card.querySelector("button");
        choose.setAttribute("aria-label", `Choose routes from ${scene.title}`);
        choose.draggable = false;
        choose.addEventListener("pointerdown", (event) => {
          if (event.button && event.button !== 0) return;
          roomPointerDrag = { sceneId: scene.id, startX: event.clientX, startY: event.clientY, moved: false };
        });
        choose.addEventListener("mousedown", (event) => {
          if (event.button !== 0) return;
          roomPointerDrag = { sceneId: scene.id, startX: event.clientX, startY: event.clientY, moved: false };
        });
        choose.addEventListener("click", () => {
          if (suppressRoomPhotoClick) return;
          state.roomPlanSceneId = scene.id;
          setStatus(`Choose where people can walk from ${scene.title}`);
          rerenderRoomsPanelPreservingScroll();
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
          roomPointerDrag = null;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", scene.id);
          card.classList.add("is-dragging");
        };
        card.addEventListener("dragstart", beginDrag);
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
        rerenderRoomsPanelPreservingScroll();
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
        firstScene: project.scenes[0]?.id || null,
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
    const invalid = files.find((file) => !/\.jpe?g$/i.test(file.name) && file.type !== "image/jpeg");
    if (invalid) {
      setStatus(`Use ready stitched JPG photos. ${invalid.name} is not supported.`);
      elements.ImportFiles.value = "";
      return;
    }
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
        state.linkStep = hotspot.positionConfirmed ? "review" : "place";
        if (hotspot.positionConfirmed) {
          api.viewer.lookAt(hotspot.pitch, hotspot.yaw, Math.min(api.viewer.getHfov(), 86), 0);
          setStatus(`Check the walking button for ${target?.title || "this place"}`);
        } else {
          setStatus(`Place the walking button for ${target?.title || "this place"}`);
        }
        render();
      });
      elements.HotspotList.appendChild(row);
    });
    elements.HotspotList.hidden = source.hotspots.length <= 1;
    const showPlacementPanel = Boolean(selected && ["place", "review"].includes(state.linkStep));
    const viewerReady = Boolean(selected && api.viewer.getScene() === source.id && api.viewer.isLoaded() && state.viewerSettled && !state.viewportSettling);
    elements.PlaceAtCentre.hidden = !showPlacementPanel;
    elements.ConfirmCentre.disabled = !viewerReady;
    const target = selected ? api.sceneById[selected.hotspot.target] : null;
    const guide = guideForScene(source);
    elements.GuideSnap.checked = guide.snapEnabled;
    elements.UseRoomHeight.disabled = !selected || !viewerReady;
    elements.GuideReadout.textContent = `Room guide: ${roundCoordinate(guide.defaultPitch)} degrees. Snap range: ${roundCoordinate(guide.snapToleranceDeg)} degrees. Hold Option while dragging to bypass snap.`;
    if (selected && state.linkStep === "review") {
      elements.PlaceAtCentre.querySelector("strong").textContent = "Check the walking button on the photo.";
      elements.PlaceAtCentre.querySelector("span").textContent = "If it is in the right place, continue. If not, adjust it.";
      elements.ConfirmCentre.textContent = "Adjust point";
      elements.ConfirmCentre.classList.remove("editor-button--primary");
      elements.CancelCentre.textContent = "Change rooms and routes";
      const warnings = placementWarnings(selected.scene, selected.hotspot);
      elements.LinkGuidance.textContent = `Check ${selected.scene.title} to ${target?.title || "the selected place"}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`;
      studioLog("movement-review-shown", { sceneId: selected.scene.id, target: selected.hotspot.target, warnings }, true);
    } else if (selected) {
      elements.PlaceAtCentre.querySelector("strong").textContent = "Put the walking button under the door or camera point.";
      elements.PlaceAtCentre.querySelector("span").textContent = "Drag the 360 photo until the target is under the cross, then save.";
      elements.ConfirmCentre.textContent = selected.hotspot.positionConfirmed ? "Update point here" : "Save point here";
      elements.ConfirmCentre.classList.add("editor-button--primary");
      elements.CancelCentre.textContent = "Change rooms and routes";
      elements.LinkGuidance.textContent = `From ${selected.scene.title} to ${target?.title || "the selected place"}. Place the button on the real route, not on furniture or a wall.`;
    } else {
      elements.LinkGuidance.textContent = "Every walking button has an exact position.";
    }
  }

  function renderArrivalPanel(scene) {
    if (state.activeStage !== "arrival") return;
    const viewerReady = Boolean(api.viewer.isLoaded() && state.viewerSettled && !state.viewportSettling);
    const selected = selectedHotspot();
    const arrivalProgress = selectedArrivalTask();
    const progressLabel = arrivalProgress.index >= 0
      ? `First view ${arrivalProgress.index + 1} of ${arrivalProgress.total}`
      : `First views ${arrivalProgress.total} of ${arrivalProgress.total}`;
    if (!selected) {
      elements.ArrivalHelp.textContent = "Every first view is saved. Continue to check and publish the tour.";
      elements.EditArrival.disabled = true;
      elements.EditArrival.hidden = true;
      elements.SaveArrival.hidden = true;
      return;
    }
    elements.EditArrival.disabled = !viewerReady || state.arrivalLoading;
    elements.EditArrival.hidden = true;
    elements.SaveArrival.hidden = true;
    if (state.arrival) {
      const target = api.sceneById[selected.hotspot.target];
      elements.ArrivalHelp.textContent = viewerReady
        ? `${progressLabel}: now showing ${target?.title || "the destination"}. Rotate to the best view, then press Save first view.`
        : `Loading ${target?.title || "the destination"}...`;
      elements.SaveArrival.disabled = !viewerReady || state.arrivalSaving;
      return;
    }
    const target = api.sceneById[selected.hotspot.target];
    elements.ArrivalHelp.textContent = viewerReady
      ? `${progressLabel}: from ${selected.scene.title} to ${target?.title || "the destination"}. Press Open destination, then choose what visitors should see first.`
      : "Loading the source photo...";
    elements.EditArrival.textContent = `Open ${target?.title || "destination"}`;
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
    const adjustment = api.getSceneAdjustment(sceneId);
    const warnings = [];
    if (adjustment.brightness > 120) warnings.push("Very bright settings can lose window detail.");
    if (adjustment.saturation > 135) warnings.push("High saturation can make interior colours look unnatural.");
    if (api.getLocalAdjustments(sceneId).length > 12) warnings.push("Many light areas can be hard to review.");
    elements.ImageWarning.textContent = warnings.join(" ");
    elements.ToggleOriginal.textContent = state.showOriginalLook ? "Show edited" : "Show original";
    elements.ApplyLookRoom.textContent = `Apply look to ${currentScene()?.spaceLabel || "room"}`;
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
    elements.DownloadEmbed.href = studioUrl("release-embed-download");
    elements.DownloadZip.href = studioUrl("release-download");
    updateEmbedCode();
    renderFloorplanEditor();
    elements.ReleaseStatus.textContent = !workspaceMode
      ? "Create a tour before publishing."
      : state.release.ready
        ? `Website files ready${state.release.singleBytes ? ` - single ${(state.release.singleBytes / 1024 / 1024).toFixed(1)} MB` : ""}${state.release.embedBytes ? `, paste-in ${(state.release.embedBytes / 1024 / 1024).toFixed(1)} MB` : ""}`
        : "The tour has not been built yet.";
  }

  function floorplanPosition(event) {
    const bounds = elements.Floorplan.getBoundingClientRect();
    return {
      x: roundCoordinate(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100))),
      y: roundCoordinate(Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)))
    };
  }

  function updateFloorplanPin(sceneId, position) {
    const map = state.workspaceProject?.map;
    if (!map?.pins?.[sceneId]) return;
    map.pins[sceneId] = position;
    const pin = elements.Floorplan.querySelector(`[data-floorplan-scene="${sceneId}"]`);
    if (pin) {
      pin.style.left = `${position.x}%`;
      pin.style.top = `${position.y}%`;
    }
  }

  async function saveFloorplanMap(reason = "floorplan-saved") {
    const map = state.workspaceProject?.map;
    if (!workspaceMode || !map?.asset) return;
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "map", enabled: map.enabled === true, pins: map.pins })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Could not save floorplan (${response.status})`);
    state.workspaceProject = body;
    state.release = { ready: false };
    studioLog(reason, { enabled: body.map?.enabled === true, pins: Object.keys(body.map?.pins || {}).length }, true);
  }

  async function uploadFloorplan() {
    const file = elements.MapFile.files[0];
    if (!file || !workspaceMode || !state.workspaceProject) return;
    elements.MapFile.disabled = true;
    setStatus("Preparing floorplan...");
    try {
      const response = await fetch(studioUrl("workspace-map", false), {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-tour-file-name": encodeURIComponent(file.name) },
        body: file
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not add floorplan (${response.status})`);
      state.workspaceProject = body.project;
      state.release = { ready: false };
      elements.MapFileName.textContent = file.name;
      setStatus("Floorplan added. Drag the numbered views to their camera positions.");
      studioLog("floorplan-uploaded", { name: file.name, size: file.size, pins: Object.keys(body.map?.pins || {}).length }, true);
    } catch (error) {
      setStatus(error.message);
      studioLog("floorplan-upload-failed", { name: file.name, message: error.message }, true);
    } finally {
      elements.MapFile.disabled = false;
      elements.MapFile.value = "";
      renderExportPanel();
    }
  }

  function renderFloorplanEditor() {
    const map = state.workspaceProject?.map;
    const hasMap = map?.asset === "floorplan/map.jpg";
    elements.FloorplanOptions.hidden = !workspaceMode || !state.workspaceProject?.scenes?.length;
    elements.MapEnabled.checked = Boolean(hasMap && map.enabled === true);
    elements.MapEnabled.disabled = !hasMap;
    elements.MapStatus.textContent = !hasMap
      ? "No floorplan is attached to this tour."
      : `Drag each number to the camera position. ${map.enabled ? "It will appear in the finished tour." : "It is saved but hidden from the finished tour."}`;
    elements.Floorplan.hidden = !hasMap;
    elements.Floorplan.replaceChildren();
    if (!hasMap) return;
    const image = document.createElement("img");
    image.src = workspaceAsset(map.asset);
    image.alt = "Uploaded floorplan";
    elements.Floorplan.appendChild(image);
    api.scenes.forEach((scene, index) => {
      const position = map.pins?.[scene.id];
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "editor-floorplan__pin";
      pin.dataset.floorplanScene = scene.id;
      pin.style.left = `${position.x}%`;
      pin.style.top = `${position.y}%`;
      pin.textContent = String(index + 1);
      pin.setAttribute("aria-label", `Move ${scene.title} on floorplan`);
      pin.title = `${index + 1}. ${scene.title}`;
      pin.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        floorplanDrag = { sceneId: scene.id, pointerId: event.pointerId };
        pin.setPointerCapture?.(event.pointerId);
        elements.Floorplan.classList.add("is-dragging");
        setStatus(`Moving ${scene.title}`);
      });
      elements.Floorplan.appendChild(pin);
    });
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

  async function copyEmbedBlock() {
    if (!workspaceMode || !state.release.ready) return;
    elements.CopyEmbedBlock.disabled = true;
    setStatus("Copying paste-in code...");
    try {
      const response = await fetch(studioUrl("release-embed-download"));
      if (!response.ok) throw new Error((await response.json()).error || `Could not read paste-in code (${response.status})`);
      await navigator.clipboard.writeText(await response.text());
      setStatus("Paste-in code copied");
    } catch (error) {
      setStatus(error.message);
    } finally {
      elements.CopyEmbedBlock.disabled = false;
    }
  }

  function syncSelectedMarker() {
    const activeId = state.selected ? api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex) : "";
    viewerElement.querySelectorAll("[data-editor-hotspot-id]").forEach((element) => {
      element.classList.toggle("is-editor-selected", element.dataset.editorHotspotId === activeId);
    });
  }

  function selectedMarkerScreenCenter() {
    const element = viewerElement.querySelector(".nav-hotspot-anchor.is-editor-selected .nav-hotspot");
    const box = element?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: roundCoordinate(box.left + box.width / 2),
      y: roundCoordinate(box.top + box.height / 2)
    };
  }

  function viewerCoordinatesAtElementCenter(element) {
    const box = element?.getBoundingClientRect();
    if (!box) return null;
    const [pitch, yaw] = api.viewer.mouseEventToCoords({
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2
    });
    if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) return null;
    return { pitch: roundCoordinate(pitch), yaw: roundCoordinate(yaw) };
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
    placementGuides.hidden = !centring || !state.guidePreferences.visible;
    arrivalGuides.hidden = !(state.activeStage === "arrival" && state.arrival && api.viewer.isLoaded());
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

  function saveSelectedHotspotAtViewerCenter(reason = "movement-centre-confirmed") {
    const selected = selectedHotspot();
    if (!selected) return false;
    api.viewer.stopMovement?.();
    const centreCoordinates = viewerCoordinatesAtElementCenter(centreTarget);
    const pitch = roundCoordinate(centreCoordinates?.pitch ?? api.viewer.getPitch());
    const yaw = roundCoordinate(centreCoordinates?.yaw ?? api.viewer.getYaw());
    selected.hotspot.positionConfirmed = true;
    api.updateHotspotCoordinates(state.selected.sceneId, state.selected.hotspotIndex, { pitch, yaw });
    const guide = guideForScene(selected.scene);
    if (guide.roomId) state.placementGuides[guide.roomId] = { ...guide, defaultPitch: pitch };
    studioLog(reason, {
      id: api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex),
      pitch,
      yaw,
      pose: { pitch, yaw, hfov: roundCoordinate(api.viewer.getHfov()) }
    }, true);
    return true;
  }

  function moveHotspotToPointer(sceneId, hotspotIndex, event, reason = "movement-dragged") {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const scene = api.sceneById[sceneId];
    const hotspot = scene?.hotspots[hotspotIndex];
    if (!hotspot) return false;
    const [pointerPitch, yaw] = api.viewer.mouseEventToCoords(event);
    const coordinates = { pitch: roundCoordinate(snappedPitch(scene, pointerPitch, !event.altKey)), yaw: roundCoordinate(yaw) };
    hotspot.positionConfirmed = true;
    api.updateHotspotCoordinates(sceneId, hotspotIndex, coordinates);
    studioLog(reason, {
      id: api.hotspotId(sceneId, hotspotIndex),
      ...coordinates,
      pointer: { x: Math.round(event.clientX), y: Math.round(event.clientY) }
    }, true);
    return true;
  }

  function beginHotspotDrag(event, marker) {
    if (event.button !== undefined && event.button !== 0) return false;
    const [sceneId, hotspotIndex] = marker.dataset.editorHotspotId.split("::");
    const index = Number(hotspotIndex);
    if (state.activeStage !== "links" || api.viewer.getScene() !== sceneId) {
      setSelected(sceneId, index, state.activeStage === "arrival" ? "arrival" : "links");
      return true;
    }
    state.selected = { sceneId, hotspotIndex: index };
    state.linkStep = "review";
    state.placement = null;
    hotspotDrag = {
      pointerId: event.pointerId ?? "mouse",
      sceneId,
      hotspotIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    marker.setPointerCapture?.(event.pointerId);
    logOperatorStep("point-drag-start", { hotspotId: api.hotspotId(sceneId, index) });
    render();
    return true;
  }

  function updateHotspotDrag(event) {
    if (!hotspotDrag) return false;
    if (event.pointerId !== undefined && hotspotDrag.pointerId !== event.pointerId) return false;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    if (Math.hypot(event.clientX - hotspotDrag.startX, event.clientY - hotspotDrag.startY) > 3) hotspotDrag.moved = true;
    if (!hotspotDrag.moved) return true;
    if (moveHotspotToPointer(hotspotDrag.sceneId, hotspotDrag.hotspotIndex, event, "movement-drag-update")) {
      state.selected = { sceneId: hotspotDrag.sceneId, hotspotIndex: hotspotDrag.hotspotIndex };
      state.linkStep = "review";
      setStatus("Point moved. Release to save it.");
      syncSelectedMarker();
    }
    return true;
  }

  function finishHotspotDrag(event) {
    if (!hotspotDrag) return false;
    if (event.pointerId !== undefined && hotspotDrag.pointerId !== event.pointerId) return false;
    const completed = hotspotDrag;
    hotspotDrag = null;
    if (completed.moved) {
      moveHotspotToPointer(completed.sceneId, completed.hotspotIndex, event, "movement-drag-end-coordinate");
      logOperatorStep("point-drag-end", { hotspotId: api.hotspotId(completed.sceneId, completed.hotspotIndex) });
      queueDraftSave("movement-dragged");
      setStatus("Point moved and saved. Check it, then continue.");
      render();
      window.requestAnimationFrame(() => {
        studioLog("movement-drag-screen-check", {
          hotspotId: api.hotspotId(completed.sceneId, completed.hotspotIndex),
          pointer: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
          marker: selectedMarkerScreenCenter()
        }, true);
      });
    }
    return true;
  }

  function applyPlacement(event) {
    const placementType = state.placement?.type;
    if (state.placement?.type === "hotspot") {
      if (!saveSelectedHotspotAtViewerCenter("movement-centre-placed-from-overlay")) return;
      setStatus("Movement point placed at the centre target");
      state.placement = null;
      render();
      queueDraftSave("movement-placed");
      return;
    }
    const [pitch, yaw] = api.viewer.mouseEventToCoords(event);
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
      localAdjustments: Object.fromEntries(api.scenes.map((scene) => [scene.id, api.getLocalAdjustments(scene.id)])),
      placementGuides: state.placementGuides,
      uiState: {
        stage: state.activeStage,
        selected: state.selected ? { ...state.selected } : null,
        linkStep: state.linkStep,
        lookSceneIndex: state.lookSceneIndex,
        guidePreferences: state.guidePreferences
      }
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
    state.placementGuides = draft.placementGuides && typeof draft.placementGuides === "object" ? { ...draft.placementGuides } : {};
    if (draft.uiState?.guidePreferences && typeof draft.uiState.guidePreferences === "object") {
      state.guidePreferences = { ...state.guidePreferences, ...draft.uiState.guidePreferences };
    }
    if (!hasSessionStage && workspaceMode && stageOrder.includes(draft.uiState?.stage)) {
      state.activeStage = draft.uiState.stage;
      if (draft.uiState?.linkStep === "place" || draft.uiState?.linkStep === "review" || draft.uiState?.linkStep === "choose") {
        state.linkStep = draft.uiState.linkStep;
      }
      if (Number.isInteger(draft.uiState?.lookSceneIndex)) {
        state.lookSceneIndex = Math.max(0, Math.min(api.scenes.length - 1, draft.uiState.lookSceneIndex));
      }
      if (draft.uiState?.selected && typeof draft.uiState.selected.sceneId === "string" && Number.isInteger(draft.uiState.selected.hotspotIndex)) {
        const scene = api.sceneById[draft.uiState.selected.sceneId];
        if (scene?.hotspots[draft.uiState.selected.hotspotIndex]) state.selected = { ...draft.uiState.selected };
      }
      studioLog("ui-state-restored", { stage: state.activeStage, selected: state.selected }, true);
    }
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

  function scheduleUiStateSave(reason) {
    if (state.initializing || !workspaceMode || !state.workspaceProject?.scenes?.length || state.activeStage === "start") return;
    scheduleDraftSave(reason, 120);
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
        resetArrivalQueue();
        focusNextArrivalTask("Open the destination and choose its first view");
      } else {
        setStage("export");
      }
      return;
    }
    const readiness = releaseReadiness();
    if (state.activeStage === "arrival" && readiness.pendingArrivals > 0) {
      if (state.arrival) await saveArrivalView();
      else await beginArrivalEdit();
      return;
    }
    if (await queueDraftSave("continue")) setStage(stageOffset(1));
  }

  async function beginArrivalEdit() {
    if (state.arrivalLoading) return;
    const selected = selectedHotspot();
    if (!selected) return;
    const selection = { ...state.selected };
    const target = api.sceneById[selected.hotspot.target];
    logOperatorStep("open-destination-first-view", {
      sourceSceneId: selected.scene.id,
      targetSceneId: selected.hotspot.target,
      targetTitle: target?.title || "destination"
    });
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

  async function saveArrivalView() {
    if (!state.arrival || state.arrivalSaving) return;
    const originSceneId = state.arrival.sceneId;
    const selected = selectedHotspot();
    const savedSelection = state.selected ? { ...state.selected } : null;
    logOperatorStep("save-first-view", {
      sourceSceneId: originSceneId,
      targetSceneId: selected?.hotspot?.target,
      targetPitch: roundCoordinate(api.viewer.getPitch()),
      targetYaw: roundCoordinate(api.viewer.getYaw()),
      targetHfov: roundCoordinate(api.viewer.getHfov())
    });
    state.arrivalSaving = true;
    elements.SaveArrival.disabled = true;
    setStatus("Saving first view...");
    if (selected) selected.hotspot.arrivalConfirmed = true;
    const updated = api.updateHotspotArrival(originSceneId, state.arrival.hotspotIndex, {
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      hfov: roundCoordinate(api.viewer.getHfov())
    });
    if (!updated) {
      state.arrivalSaving = false;
      setStatus("Could not save this first view");
      renderArrivalPanel(currentScene());
      return;
    }
    const inheritedCount = propagateArrivalViewsByTarget();
    state.arrival = null;
    if (!await queueDraftSave(inheritedCount ? "arrival-view-saved-with-shared-destinations" : "arrival-view-saved")) {
      state.arrivalSaving = false;
      renderArrivalPanel(currentScene());
      return;
    }
    state.arrivalSaving = false;
    advanceArrivalQueuePast(savedSelection || { sceneId: originSceneId, hotspotIndex: state.arrival?.hotspotIndex });
    if (focusNextArrivalTask("Destination view saved. Next place selected.")) {
      return;
    }
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
  elements.ContinueWorkspace.addEventListener("click", () => {
    if (!state.workspaceProject) return;
    logOperatorStep("continue-current-tour", { title: state.workspaceProject.title });
    window.location.assign(workspaceEditorUrl());
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
  elements.Home.addEventListener("click", () => {
    logOperatorStep("home");
    setStage("start");
  });
  elements.Back.addEventListener("click", () => {
    logOperatorStep("back");
    backWizard();
  });
  elements.Continue.addEventListener("click", () => {
    logOperatorStep("continue", { label: elements.Continue.textContent.trim() });
    continueWizard();
  });
  elements.Build.addEventListener("click", buildRelease);
  elements.DownloadProject.addEventListener("click", downloadEditableProject);
  elements.MapFile.addEventListener("change", uploadFloorplan);
  elements.MapEnabled.addEventListener("change", async () => {
    const map = state.workspaceProject?.map;
    if (!map?.asset) return;
    map.enabled = elements.MapEnabled.checked;
    setStatus(map.enabled ? "Showing floorplan in the finished tour..." : "Hiding floorplan from the finished tour...");
    try {
      await saveFloorplanMap("floorplan-visibility-changed");
      setStatus(map.enabled ? "Floorplan will be shown in the finished tour." : "Floorplan will be hidden from the finished tour.");
    } catch (error) {
      setStatus(error.message);
    }
    renderExportPanel();
  });
  elements.DownloadDebug.addEventListener("click", async () => {
    try {
      const response = await fetch(studioUrl("debug-bundle"));
      if (!response.ok) throw new Error("Could not prepare debug bundle");
      downloadBlob(new Blob([JSON.stringify(await response.json(), null, 2)], { type: "application/json" }), "raindigit-tour-debug.json");
      setStatus("Debug bundle downloaded");
      logOperatorStep("debug-bundle-downloaded");
    } catch (error) {
      setStatus(error.message);
    }
  });
  elements.InstallUrl.addEventListener("input", updateEmbedCode);
  elements.CopyEmbed.addEventListener("click", copyEmbedCode);
  elements.CopyEmbedBlock.addEventListener("click", copyEmbedBlock);
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
    if (state.activeStage === "links" && state.linkStep === "review" && selected?.hotspot.positionConfirmed) {
      logOperatorStep("adjust-point", {
        hotspotId: api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex),
        pitch: selected.hotspot.pitch,
        yaw: selected.hotspot.yaw
      });
      state.linkStep = "place";
      api.viewer.lookAt(selected.hotspot.pitch, selected.hotspot.yaw, Math.min(api.viewer.getHfov(), 86), 0);
      setStatus("Move the view until the right place is under the cross");
      render();
      return;
    }
    if (!saveSelectedHotspotAtViewerCenter()) return;
    logOperatorStep("save-point-here", selected ? {
      hotspotId: api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex),
      target: selected.hotspot.target
    } : {});
    queueDraftSave("movement-centre-confirmed");
    state.linkStep = "review";
    setStatus("Point saved. Check it on the photo, then continue.");
    render();
  });
  elements.CancelCentre.addEventListener("click", () => {
    state.linkStep = "choose";
    state.selected = null;
    setStatus("Change the room board or selected places");
    setStage("rooms");
  });
  elements.InspectSource.addEventListener("click", () => {
    const selected = selectedHotspot();
    if (selected) openPhotoPreview(selected.scene.id);
  });
  elements.UseRoomHeight.addEventListener("click", () => {
    const selected = selectedHotspot();
    if (!selected) return;
    const guide = guideForScene(selected.scene);
    api.viewer.lookAt(guide.defaultPitch, api.viewer.getYaw(), api.viewer.getHfov(), 0);
    setStatus("Room height aligned. Check the cross, then save the point.");
    logOperatorStep("movement-room-height-used", { roomId: guide.roomId, pitch: guide.defaultPitch });
  });
  elements.GuideSnap.addEventListener("change", () => {
    const selected = selectedHotspot();
    const guide = guideForScene(selected?.scene);
    if (guide.roomId) state.placementGuides[guide.roomId] = { ...guide, snapEnabled: elements.GuideSnap.checked };
    state.guidePreferences.snapEnabled = elements.GuideSnap.checked;
    scheduleDraftSave("placement-guide-snap-changed");
    logOperatorStep("placement-guide-snap-changed", { enabled: elements.GuideSnap.checked, roomId: guide.roomId });
  });
  elements.ToggleOriginal.addEventListener("click", () => {
    const scene = currentScene();
    if (!scene) return;
    state.showOriginalLook = !state.showOriginalLook;
    api.setSceneAdjustmentPreview(scene.id, state.showOriginalLook);
    renderImagePresets(scene.id);
    logOperatorStep("picture-before-after", { sceneId: scene.id, original: state.showOriginalLook });
  });
  elements.ApplyLookRoom.addEventListener("click", () => {
    const scene = currentScene();
    if (!scene) return;
    const adjustment = api.getSceneAdjustment(scene.id);
    api.scenes.filter((candidate) => candidate.space === scene.space).forEach((candidate) => api.setSceneAdjustment(candidate.id, adjustment));
    renderImagePresets(scene.id);
    renderImageControls(scene.id);
    scheduleDraftSave("picture-look-applied-to-room");
    setStatus(`Look applied to ${scene.spaceLabel}`);
    logOperatorStep("picture-look-applied-to-room", { roomId: scene.space });
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

  function handleHotspotDragStart(event) {
    const marker = event.target.closest("[data-editor-hotspot-id]");
    if (!marker || hotspotDrag) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginHotspotDrag(event, marker);
    return true;
  }

  viewerElement.addEventListener("pointerdown", handleHotspotDragStart, true);
  viewerElement.addEventListener("mousedown", handleHotspotDragStart, true);
  document.addEventListener("pointerdown", handleHotspotDragStart, true);
  document.addEventListener("mousedown", handleHotspotDragStart, true);
  document.addEventListener("pointermove", (event) => {
    if (!updateHotspotDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("mousemove", (event) => {
    if (!updateHotspotDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (!finishHotspotDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!floorplanDrag || event.pointerId !== floorplanDrag.pointerId) return;
    updateFloorplanPin(floorplanDrag.sceneId, floorplanPosition(event));
    event.preventDefault();
  }, true);
  document.addEventListener("pointerup", async (event) => {
    if (!floorplanDrag || event.pointerId !== floorplanDrag.pointerId) return;
    const drag = floorplanDrag;
    floorplanDrag = null;
    elements.Floorplan.classList.remove("is-dragging");
    try {
      await saveFloorplanMap("floorplan-pin-moved");
      setStatus("Floorplan position saved");
    } catch (error) {
      setStatus(error.message);
      await refreshWorkspaceProject();
      renderExportPanel();
    }
    studioLog("floorplan-pin-drag-finished", { sceneId: drag.sceneId }, true);
    event.preventDefault();
  }, true);
  document.addEventListener("pointercancel", async (event) => {
    if (!floorplanDrag || event.pointerId !== floorplanDrag.pointerId) return;
    floorplanDrag = null;
    elements.Floorplan.classList.remove("is-dragging");
    await refreshWorkspaceProject();
    renderExportPanel();
    setStatus("Floorplan move cancelled");
  }, true);
  document.addEventListener("mouseup", (event) => {
    if (!finishHotspotDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("pointercancel", (event) => {
    if (!finishHotspotDrag(event)) return;
    hotspotDrag = null;
    setStatus("Point drag cancelled");
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
    if (state.activeStage !== "arrival" && !state.arrival) {
      state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    }
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
    const sharedArrivalChanged = propagateArrivalViewsByTarget();
    const scene = currentScene();
    if (state.activeStage !== "arrival") {
      state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    } else {
      resetArrivalQueue();
      focusNextArrivalTask("Open the destination and choose its first view");
    }
    state.initializing = false;
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
    if (plannedPlacesChanged || sharedArrivalChanged) {
      queueDraftSave(sharedArrivalChanged ? "shared-arrival-views-applied" : "planned-places-synchronised");
    }
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
