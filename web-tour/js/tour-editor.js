(() => {
  "use strict";

  const api = window.__TOUR_EDITOR_API;
  if (!api) return;

  const endpoint = "__tour-editor";
  const workspaceMode = new URLSearchParams(window.location.search).get("workspace") === "1";
  const stageOrder = ["start", "upload", "rooms", "light", "links", "arrival", "export"];
  const stageLabels = {
    start: "Start",
    upload: "Upload",
    rooms: "Rooms",
    light: "Color",
    links: "Transitions",
    arrival: "Arrival",
    export: "Export"
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
    linkDraftSceneId: null,
    release: { ready: false }
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
        <button class="editor-button" id="editorHome" type="button">Projects</button>
        <button class="editor-button editor-button--icon" id="editorClose" type="button" aria-label="Hide tour studio" title="Hide tour studio">&times;</button>
      </div>
    </div>
    <div class="editor-progress" aria-label="Tour production progress">
      <div><strong id="editorProgressLabel">Start</strong><span id="editorProgressCount">1 of 7</span></div>
      <div class="editor-progress__track"><i id="editorProgressFill"></i></div>
    </div>
    <div class="editor-panel__scene">
      <button class="editor-button editor-button--icon" id="editorPreviousScene" type="button" aria-label="Previous panorama" title="Previous panorama">&larr;</button>
      <div>
        <span id="editorRoomName"></span>
        <strong class="editor-panel__scene-name" id="editorSceneName"></strong>
      </div>
      <button class="editor-button editor-button--icon" id="editorNextScene" type="button" aria-label="Next panorama" title="Next panorama">&rarr;</button>
    </div>
    <div class="editor-panel__content">
      <section class="editor-stage-panel" data-stage-panel="start">
        <div class="editor-step-heading"><span>Start</span><h2>Create or open a tour</h2></div>
        <div class="editor-current-project" id="editorCurrentProject" hidden>
          <div><strong id="editorCurrentProjectTitle"></strong><span id="editorCurrentProjectMeta"></span></div>
          <button class="editor-button editor-button--primary editor-button--wide" id="editorOpenWorkspace" type="button">Continue current project</button>
        </div>
        <div class="editor-start-block">
          <strong>New project</strong>
          <label class="editor-field editor-field--stacked">
            <span>Project title</span>
            <input id="editorProjectTitle" type="text" maxlength="100" autocomplete="off" value="Untitled 3D Tour" />
          </label>
          <button class="editor-button editor-button--primary editor-button--wide" id="editorCreateWorkspace" type="button">Create new project</button>
        </div>
        <div class="editor-start-block">
          <strong>Open editable project</strong>
          <label class="editor-file-picker">
            <span id="editorProjectBackupName">Choose .rdtour file</span>
            <input id="editorProjectBackup" type="file" accept=".rdtour,application/zip" />
          </label>
          <button class="editor-button editor-button--wide" id="editorRestoreProject" type="button" disabled>Open project backup</button>
        </div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="upload">
        <div class="editor-step-heading"><span>Step 1</span><h2>Upload panoramas</h2></div>
        <label class="editor-upload-zone">
          <strong>Add stitched Insta360 panoramas</strong>
          <span>Original 2:1 JPG files. Paired DNG files stay in your camera archive.</span>
          <input id="editorImportFiles" type="file" accept="image/jpeg,.jpg,.jpeg" multiple />
        </label>
        <p class="editor-empty" id="editorProjectEmpty"></p>
        <div class="editor-upload-list" id="editorUploadList" aria-label="Uploaded panoramas"></div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="rooms">
        <div class="editor-step-heading"><span>Step 2</span><h2>Organize rooms</h2></div>
        <div class="editor-section-label"><strong>Rooms</strong></div>
        <div class="editor-room-list" id="editorRoomList" aria-label="Project rooms"></div>
        <div class="editor-add-room">
          <label class="editor-field editor-field--stacked">
            <span>Room name</span>
            <input id="editorNewRoomName" type="text" maxlength="80" autocomplete="off" value="Room 2" />
          </label>
          <button class="editor-button" id="editorAddRoom" type="button">Add room</button>
        </div>
        <div class="editor-section-label"><strong>Panoramas</strong><span id="editorAssignmentStatus"></span></div>
        <div class="editor-project-order" id="editorProjectOrder" aria-label="Panorama room assignments"></div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="light">
        <div class="editor-step-heading"><span>Step 3</span><h2>Color and light</h2></div>
        <div class="editor-image__controls" id="editorImageControls"></div>
        <div class="editor-local-header">
          <strong>Local areas</strong>
          <button class="editor-button" id="editorAddAdjustment" type="button">Add area</button>
        </div>
        <div class="editor-adjustment-list" id="editorAdjustmentList"></div>
        <div class="editor-adjustment-controls" id="editorAdjustmentControls"></div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="links">
        <div class="editor-step-heading"><span>Step 4</span><h2>Transitions</h2></div>
        <div class="editor-hotspot-list" id="editorHotspotList"></div>
        <div class="editor-panel__actions">
          <button class="editor-button editor-button--primary" id="editorPlace" type="button">Place selected point</button>
          <button class="editor-button" id="editorRemoveLink" type="button">Remove</button>
        </div>
        <div class="editor-new-link">
          <label class="editor-field editor-field--stacked"><span>Destination</span><select id="editorLinkTarget" aria-label="Transition destination"></select></label>
          <label class="editor-field editor-field--stacked"><span>Marker type</span><select id="editorLinkKind" aria-label="Transition marker type"><option value="doorway">Walk through</option><option value="viewpoint">Other camera viewpoint</option></select></label>
          <label class="editor-field editor-field--stacked"><span>Label</span><input id="editorLinkLabel" type="text" maxlength="80" autocomplete="off" /></label>
          <button class="editor-button editor-button--wide" id="editorAddLink" type="button">Add transition</button>
        </div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="arrival">
        <div class="editor-step-heading"><span>Step 5</span><h2>Arrival views</h2></div>
        <div class="editor-default-view">
          <div><strong>Default viewpoint</strong><span id="editorDefaultView"></span></div>
          <button class="editor-button editor-button--wide" id="editorSaveSceneView" type="button">Use current view as default</button>
        </div>
        <div class="editor-hotspot-list" id="editorArrivalList"></div>
        <p class="editor-empty" id="editorArrivalHelp"></p>
        <div class="editor-panel__actions">
          <button class="editor-button editor-button--primary" id="editorEditArrival" type="button">Set arrival view</button>
          <button class="editor-button editor-button--primary" id="editorSaveArrival" type="button">Save arrival view</button>
        </div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="export">
        <div class="editor-step-heading"><span>Step 6</span><h2>Review and export</h2></div>
        <div class="editor-export-summary" id="editorExportSummary"></div>
        <div class="editor-readiness" id="editorReadiness" role="status"></div>
        <a class="editor-button editor-button--wide" id="editorPreviewLink" target="_blank" rel="noopener">Open review preview</a>
        <button class="editor-button editor-button--primary editor-button--wide" id="editorBuild" type="button">Prepare final files</button>
        <div class="editor-release-actions" id="editorReleaseActions" hidden>
          <div class="editor-publish-card">
            <strong>1. Test the finished tour</strong>
            <a class="editor-button editor-button--wide" id="editorEmbedTestLink" target="_blank" rel="noopener">Open website embed test</a>
          </div>
          <div class="editor-publish-card">
            <strong>2. Download the two delivery files</strong>
            <a class="editor-button editor-button--primary editor-button--wide" id="editorDownloadSingle" download="raindigit-360-tour.html">Download tour website (.html)</a>
            <button class="editor-button editor-button--wide" id="editorDownloadProject" type="button">Download editable backup (.rdtour)</button>
          </div>
          <div class="editor-publish-card">
            <strong>3. Install on a website</strong>
            <span>Upload the HTML file, enter its public URL, then paste the generated iframe into the page.</span>
            <label class="editor-field editor-field--stacked">
              <span>Published tour URL</span>
              <input id="editorInstallUrl" type="url" value="./raindigit-360-tour.html" autocomplete="off" />
            </label>
            <textarea class="editor-embed-code" id="editorEmbedCode" readonly aria-label="Website embed code"></textarea>
            <button class="editor-button editor-button--wide" id="editorCopyEmbed" type="button">Copy embed code</button>
          </div>
          <details class="editor-advanced">
            <summary>Advanced hosting</summary>
            <a class="editor-button editor-button--wide" id="editorDownloadZip" download="raindigit-360-tour.zip">Download folder package (.zip)</a>
          </details>
        </div>
        <p class="editor-empty" id="editorReleaseStatus"></p>
      </section>
    </div>
    <div class="editor-panel__footer">
      <button class="editor-button" id="editorBack" type="button">Back</button>
      <span class="editor-panel__status" id="editorStatus" role="status">Loading project</span>
      <button class="editor-button editor-button--primary" id="editorContinue" type="button">Continue</button>
    </div>
  `;
  document.body.appendChild(panel);
  document.body.classList.add("is-editor-open");

  const elements = Object.fromEntries([
    "SceneName", "RoomName", "Home", "ProgressLabel", "ProgressCount", "ProgressFill", "CurrentProject", "CurrentProjectTitle", "CurrentProjectMeta", "ProjectTitle", "CreateWorkspace", "OpenWorkspace", "ProjectBackup", "ProjectBackupName", "RestoreProject", "ImportFiles", "ProjectEmpty", "UploadList", "NewRoomName", "AddRoom", "RoomList", "AssignmentStatus", "ProjectOrder", "HotspotList", "ArrivalList", "Place", "RemoveLink", "LinkTarget", "LinkKind", "LinkLabel", "AddLink", "EditArrival", "SaveArrival", "ArrivalHelp", "DefaultView", "SaveSceneView", "ImageControls", "AdjustmentList", "AdjustmentControls", "AddAdjustment", "ExportSummary", "Readiness", "PreviewLink", "Build", "ReleaseActions", "EmbedTestLink", "DownloadSingle", "DownloadProject", "InstallUrl", "EmbedCode", "CopyEmbed", "DownloadZip", "ReleaseStatus", "Back", "Status", "Continue"
  ].map((name) => [name, panel.querySelector(`#editor${name}`)]));
  const viewerElement = api.viewer.getContainer();

  const editorToggle = document.createElement("button");
  editorToggle.className = "icon-button";
  editorToggle.type = "button";
  editorToggle.setAttribute("aria-label", "Hide tour studio");
  editorToggle.title = "Hide tour studio";
  editorToggle.innerHTML = "&#9678;";
  document.querySelector(".toolbar").appendChild(editorToggle);

  function setStatus(message) {
    elements.Status.textContent = message;
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

  function workspaceAsset(path) {
    return `/${endpoint}/workspace/${path}`;
  }

  function setStage(stage) {
    if (!stageOrder.includes(stage)) return;
    state.activeStage = stage;
    state.placement = null;
    if (stage !== "arrival") state.arrival = null;
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
    setStage(stage);
    focusSelectedMarker();
  }

  function renderStages() {
    panel.dataset.stage = state.activeStage;
    document.body.dataset.editorStage = state.activeStage;
    panel.querySelectorAll(".editor-stage-panel").forEach((section) => {
      section.hidden = section.dataset.stagePanel !== state.activeStage;
    });
    const index = stageOrder.indexOf(state.activeStage);
    elements.ProgressLabel.textContent = stageLabels[state.activeStage];
    elements.ProgressCount.textContent = `${index + 1} of ${stageOrder.length}`;
    elements.ProgressFill.style.width = `${(index + 1) / stageOrder.length * 100}%`;
    elements.Home.hidden = state.activeStage === "start";
    elements.Back.hidden = ["start", "upload"].includes(state.activeStage);
    elements.Continue.hidden = ["start", "export"].includes(state.activeStage);
    elements.Continue.disabled = state.activeStage === "upload" && !state.workspaceProject?.scenes?.length;
    elements.Continue.textContent = state.activeStage === "arrival" ? "Review" : "Continue";
  }

  function moveWorkspaceScene(index, direction) {
    const project = state.workspaceProject;
    const target = index + direction;
    if (!project || target < 0 || target >= project.scenes.length) return;
    [project.scenes[index], project.scenes[target]] = [project.scenes[target], project.scenes[index]];
    renderProjectPanel();
  }

  function renderStartPanel() {
    const project = state.workspaceProject;
    elements.CurrentProject.hidden = !project;
    if (project) {
      elements.ProjectTitle.value = project.title;
      elements.CurrentProjectTitle.textContent = project.title;
      const rooms = new Set(project.scenes.filter((scene) => scene.space !== "room-unassigned").map((scene) => scene.space)).size;
      elements.CurrentProjectMeta.textContent = `${project.scenes.length} panorama${project.scenes.length === 1 ? "" : "s"} · ${rooms} room${rooms === 1 ? "" : "s"}`;
      elements.OpenWorkspace.textContent = project.scenes.length ? "Continue current project" : "Continue setup";
    }
  }

  function renderUploadPanel() {
    const project = state.workspaceProject;
    elements.ImportFiles.disabled = !project || state.importing;
    elements.ProjectEmpty.hidden = Boolean(project?.scenes?.length);
    elements.ProjectEmpty.textContent = state.importing
      ? `Preparing ${state.importProgress.current} of ${state.importProgress.total}`
      : project ? "No panoramas uploaded yet." : "Create a project first.";
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
      dimensions.textContent = "2:1 panorama ready";
      details.append(title, dimensions);
      const remove = document.createElement("button");
      remove.className = "editor-button editor-button--icon editor-button--danger";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove panorama";
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
    elements.NewRoomName.value = "Room 2";
  }

  function nextRoomName() {
    return `Room ${projectRooms().length + 1}`;
  }

  function addRoom() {
    const project = state.workspaceProject;
    const label = elements.NewRoomName.value.trim();
    if (!project || !label) {
      setStatus("Enter a room name");
      return;
    }
    const id = `room-${Date.now().toString(36)}`;
    projectRooms(project).push({ id, label });
    elements.NewRoomName.value = nextRoomName();
    setStatus(`${label} added`);
    renderRoomsPanel();
  }

  function removeRoom(roomId) {
    const project = state.workspaceProject;
    const rooms = projectRooms(project);
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!project || !room) return;
    if (rooms.length === 1) {
      setStatus("A project needs at least one room");
      return;
    }
    if (project.scenes.some((scene) => scene.space === roomId)) {
      setStatus(`Move panoramas out of ${room.label} first`);
      return;
    }
    project.rooms = rooms.filter((candidate) => candidate.id !== roomId);
    setStatus(`${room.label} removed`);
    renderRoomsPanel();
  }

  function updateRoomSummary() {
    const project = state.workspaceProject;
    if (!project) return;
    const roomIds = new Set(projectRooms(project).map((room) => room.id));
    const assigned = project.scenes.filter((scene) => roomIds.has(scene.space)).length;
    elements.AssignmentStatus.textContent = `${assigned} of ${project.scenes.length} assigned`;
    elements.RoomList.querySelectorAll("[data-room-id]").forEach((row) => {
      const count = project.scenes.filter((scene) => scene.space === row.dataset.roomId).length;
      const output = row.querySelector("[data-room-count]");
      if (output) output.textContent = `${count} view${count === 1 ? "" : "s"}`;
      const remove = row.querySelector("[data-remove-room]");
      if (remove) {
        remove.disabled = count > 0 || projectRooms(project).length === 1;
        remove.title = count > 0 ? "Move its panoramas before removing" : "Remove empty room";
      }
    });
  }

  function renderRoomsPanel() {
    const project = state.workspaceProject;
    elements.RoomList.replaceChildren();
    elements.ProjectOrder.replaceChildren();
    if (!project) return;
    ensureInitialRoom();
    const rooms = projectRooms(project);

    for (const room of rooms) {
      const section = document.createElement("section");
      section.className = "editor-room";
      section.dataset.roomId = room.id;
      const header = document.createElement("div");
      header.className = "editor-room__header";
      const roomName = document.createElement("input");
      roomName.value = room.label;
      roomName.maxLength = 80;
      roomName.setAttribute("aria-label", `Room name: ${room.label}`);
      roomName.addEventListener("input", () => {
        room.label = roomName.value;
        project.scenes.filter((scene) => scene.space === room.id).forEach((scene) => { scene.spaceLabel = roomName.value; });
        roomName.setAttribute("aria-label", `Room name: ${roomName.value}`);
        removeRoomButton.setAttribute("aria-label", `Remove ${roomName.value}`);
        elements.ProjectOrder.querySelectorAll(`option[value="${room.id}"]`).forEach((option) => { option.textContent = roomName.value; });
        setStatus("Room structure changed");
      });
      const count = document.createElement("span");
      const roomScenes = project.scenes.filter((scene) => scene.space === room.id);
      count.textContent = `${roomScenes.length} view${roomScenes.length === 1 ? "" : "s"}`;
      count.dataset.roomCount = "";
      const removeRoomButton = document.createElement("button");
      removeRoomButton.className = "editor-button editor-button--icon editor-button--danger";
      removeRoomButton.type = "button";
      removeRoomButton.textContent = "×";
      removeRoomButton.dataset.removeRoom = "";
      removeRoomButton.setAttribute("aria-label", `Remove ${room.label}`);
      removeRoomButton.addEventListener("click", () => removeRoom(room.id));
      header.append(roomName, count, removeRoomButton);
      section.appendChild(header);
      elements.RoomList.appendChild(section);
    }

    for (const scene of project.scenes) {
        const row = document.createElement("div");
        row.className = "editor-project-scene";
        const thumb = document.createElement("img");
        thumb.src = workspaceAsset(scene.thumb);
        thumb.alt = "";
        const fields = document.createElement("div");
        fields.className = "editor-project-scene__fields";
        const title = document.createElement("input");
        title.value = scene.title;
        title.maxLength = 80;
        title.setAttribute("aria-label", "Viewpoint name");
        title.addEventListener("input", () => { scene.title = title.value; setStatus("Viewpoint changed"); });
        const subtitle = document.createElement("input");
        subtitle.value = scene.subtitle || "";
        subtitle.maxLength = 120;
        subtitle.placeholder = "View description";
        subtitle.setAttribute("aria-label", "Viewpoint description");
        subtitle.addEventListener("input", () => { scene.subtitle = subtitle.value; setStatus("Viewpoint changed"); });
        fields.append(title, subtitle);
        const controls = document.createElement("div");
        controls.className = "editor-project-scene__controls";
        const roomSelect = document.createElement("select");
        roomSelect.setAttribute("aria-label", `Move ${scene.title} to room`);
        for (const candidate of rooms) {
          const option = document.createElement("option");
          option.value = candidate.id;
          option.textContent = candidate.label;
          roomSelect.appendChild(option);
        }
        roomSelect.value = scene.space;
        roomSelect.addEventListener("change", () => {
          const targetRoom = rooms.find((candidate) => candidate.id === roomSelect.value);
          scene.space = targetRoom.id;
          scene.spaceLabel = targetRoom.label;
          setStatus(`${scene.title} assigned to ${targetRoom.label}`);
          updateRoomSummary();
        });
        const index = project.scenes.indexOf(scene);
        const up = document.createElement("button");
        up.className = "editor-button editor-button--icon";
        up.type = "button";
        up.textContent = "↑";
        up.title = "Move earlier";
        up.setAttribute("aria-label", `Move ${scene.title} earlier`);
        up.disabled = index === 0;
        up.addEventListener("click", () => moveWorkspaceScene(index, -1));
        const down = document.createElement("button");
        down.className = "editor-button editor-button--icon";
        down.type = "button";
        down.textContent = "↓";
        down.title = "Move later";
        down.setAttribute("aria-label", `Move ${scene.title} later`);
        down.disabled = index === project.scenes.length - 1;
        down.addEventListener("click", () => moveWorkspaceScene(index, 1));
        const start = document.createElement("button");
        start.className = `editor-button editor-button--icon${project.firstScene === scene.id ? " is-active" : ""}`;
        start.type = "button";
        start.textContent = "★";
        start.title = "Use as opening view";
        start.setAttribute("aria-label", `Use ${scene.title} as opening view`);
        start.addEventListener("click", () => { project.firstScene = scene.id; renderProjectPanel(); });
        const remove = document.createElement("button");
        remove.className = "editor-button editor-button--icon editor-button--danger";
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "Remove viewpoint";
        remove.setAttribute("aria-label", `Remove ${scene.title}`);
        remove.addEventListener("click", () => removeWorkspaceScene(scene.id, scene.title, "rooms"));
        controls.append(roomSelect, up, down, start, remove);
        row.append(thumb, fields, controls);
        elements.ProjectOrder.appendChild(row);
    }
    updateRoomSummary();
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
      if (window.confirm("Replace the existing local project? Its imported workspace and draft will be removed. Camera originals and the Killarney source tour remain unchanged.")) return createWorkspace(true);
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
    if (!project?.scenes?.length) throw new Error("Import at least one panorama first.");
    const rooms = projectRooms(project).filter((room) => room.label.trim());
    if (!rooms.length) throw new Error("Create at least one room.");
    const roomIds = new Set(rooms.map((room) => room.id));
    if (project.scenes.some((scene) => !roomIds.has(scene.space))) throw new Error("Assign every panorama to a room.");
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "structure",
        title: elements.ProjectTitle.value,
        rooms,
        firstScene: project.firstScene,
        sceneIds: project.scenes.map((scene) => scene.id),
        scenes: project.scenes.map(({ id, title, subtitle, space, spaceLabel }) => ({ id, title, subtitle, space, spaceLabel }))
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
      setStatus(`${imported} panorama${imported === 1 ? "" : "s"} imported`);
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

  function renderHotspotButtons(container, scene, targetStage) {
    container.replaceChildren();
    if (!scene.hotspots.length) {
      const empty = document.createElement("p");
      empty.className = "editor-empty";
      empty.textContent = "No transitions in this panorama.";
      container.appendChild(empty);
      return;
    }
    scene.hotspots.forEach((hotspot, hotspotIndex) => {
      const button = document.createElement("button");
      button.className = `editor-hotspot${state.selected?.sceneId === scene.id && state.selected.hotspotIndex === hotspotIndex ? " is-selected" : ""}`;
      button.type = "button";
      const pending = targetStage === "links" && hotspot.positionConfirmed === false
        ? "Place point"
        : targetStage === "arrival" && hotspot.arrivalConfirmed === false
          ? "Set arrival"
          : `${roundCoordinate(hotspot.pitch)} / ${roundCoordinate(hotspot.yaw)}`;
      button.innerHTML = `<span class="editor-hotspot__type">${hotspot.kind === "viewpoint" ? "V" : "W"}</span><span class="editor-hotspot__label"></span><span class="editor-hotspot__coords"></span>`;
      button.querySelector(".editor-hotspot__label").textContent = hotspot.label;
      button.querySelector(".editor-hotspot__coords").textContent = pending;
      button.addEventListener("click", () => setSelected(scene.id, hotspotIndex, targetStage));
      container.appendChild(button);
    });
  }

  function renderHotspotList(scene) {
    renderHotspotButtons(elements.HotspotList, scene, "links");
    elements.Place.disabled = !selectedHotspot();
    elements.Place.classList.toggle("is-active", state.placement?.type === "hotspot");
    elements.Place.textContent = state.placement?.type === "hotspot" ? "Click panorama to place" : "Place selected point";
    const selectedIndex = state.selected?.sceneId === scene.id ? state.selected.hotspotIndex : -1;
    elements.RemoveLink.hidden = selectedIndex < api.getBaseHotspotCount(scene.id);
    renderLinkCreator(scene);
  }

  function suggestedLinkKind(scene = currentScene(), targetScene = api.sceneById[elements.LinkTarget.value]) {
    return scene && targetScene && scene.space === targetScene.space ? "viewpoint" : "doorway";
  }

  function suggestedLinkLabel() {
    const targetScene = api.sceneById[elements.LinkTarget.value];
    if (elements.LinkKind.value === "viewpoint") return `View ${targetScene?.title || "destination"}`;
    return `Walk to ${targetScene?.spaceLabel || targetScene?.title || "destination"}`;
  }

  function renderLinkCreator(scene) {
    const selectedTarget = elements.LinkTarget.value;
    elements.LinkTarget.replaceChildren();
    api.scenes.filter((candidate) => candidate.id !== scene.id).forEach((candidate) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = `${candidate.spaceLabel || candidate.title} - ${candidate.title}`;
      elements.LinkTarget.appendChild(option);
    });
    if ([...elements.LinkTarget.options].some((option) => option.value === selectedTarget)) elements.LinkTarget.value = selectedTarget;
    if (state.linkDraftSceneId !== scene.id) {
      state.linkDraftSceneId = scene.id;
      elements.LinkKind.value = suggestedLinkKind(scene);
      elements.LinkLabel.value = suggestedLinkLabel();
    } else if (!elements.LinkLabel.value) {
      elements.LinkLabel.value = suggestedLinkLabel();
    }
    elements.AddLink.disabled = elements.LinkTarget.options.length === 0;
  }

  function renderArrivalPanel(scene) {
    const view = api.getSceneView(scene.id);
    elements.DefaultView.textContent = `${roundCoordinate(view.pitch)}° / ${roundCoordinate(view.yaw)}° / ${roundCoordinate(view.hfov)}°`;
    renderHotspotButtons(elements.ArrivalList, scene, "arrival");
    const selected = selectedHotspot();
    if (!selected) {
      elements.ArrivalHelp.textContent = "Select a transition above.";
      elements.EditArrival.disabled = true;
      elements.SaveArrival.hidden = true;
      return;
    }
    elements.EditArrival.disabled = false;
    if (state.arrival) {
      const target = api.sceneById[selected.hotspot.target];
      elements.ArrivalHelp.textContent = `Arrival in ${target?.title || "destination"}`;
      elements.EditArrival.hidden = true;
      elements.SaveArrival.hidden = false;
      return;
    }
    const target = api.sceneById[selected.hotspot.target];
    elements.ArrivalHelp.textContent = `${selected.hotspot.label} · ${target?.title || "destination"}`;
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
        setStatus("Color changes not saved");
      });
      row.append(input, output);
      label.append(name, row);
      elements.ImageControls.appendChild(label);
    });
  }

  function updateSelectedAdjustment(change) {
    const scene = currentScene();
    const adjustment = selectedAdjustment();
    if (!scene || !adjustment) return;
    api.setLocalAdjustments(scene.id, api.getLocalAdjustments(scene.id).map((item) => item.id === adjustment.id ? { ...item, ...change } : item));
    setStatus("Local area not saved");
    renderLocalAdjustments(scene.id);
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
    place.textContent = state.placement?.type === "adjustment" ? "Click panorama to place" : "Place area";
    place.addEventListener("click", () => {
      state.placement = state.placement?.type === "adjustment" ? null : { type: "adjustment", id: selected.id };
      setStatus(state.placement ? "Click the panorama to position the area" : "Area placement cancelled");
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
    elements.ExportSummary.innerHTML = `<div><strong>${rooms}</strong><span>Rooms</span></div><div><strong>${api.scenes.length}</strong><span>Views</span></div><div><strong>${transitions}</strong><span>Transitions</span></div><div><strong>${adjusted}</strong><span>Color edits</span></div>`;
    const readiness = releaseReadiness();
    elements.Readiness.classList.toggle("is-ready", readiness.ready);
    elements.Readiness.textContent = readiness.ready
      ? "Ready to publish"
      : `${readiness.pendingPositions} transition point${readiness.pendingPositions === 1 ? "" : "s"} and ${readiness.pendingArrivals} arrival view${readiness.pendingArrivals === 1 ? "" : "s"} still need review.`;
    const previewUrl = `${window.location.origin}${window.location.pathname}?preview=1${workspaceMode ? "&workspace=1" : ""}`;
    elements.PreviewLink.href = state.release.ready ? `${endpoint}/release/index.html` : previewUrl;
    elements.PreviewLink.textContent = state.release.ready ? "Open final tour" : "Open review preview";
    elements.Build.disabled = !workspaceMode || state.building || !readiness.ready;
    elements.Build.textContent = state.building ? "Preparing files..." : "Prepare final files";
    elements.ReleaseActions.hidden = !state.release.ready;
    elements.EmbedTestLink.href = `${endpoint}/release-embed-test.html`;
    elements.DownloadSingle.href = studioUrl("release-single-download");
    elements.DownloadZip.href = studioUrl("release-download");
    updateEmbedCode();
    elements.ReleaseStatus.textContent = !workspaceMode
      ? "Create a workspace project before export."
      : state.release.ready
        ? `Website file ready${state.release.singleBytes ? ` - ${(state.release.singleBytes / 1024 / 1024).toFixed(1)} MB` : ""}`
        : "No current package built.";
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
    setStatus("Embed code copied");
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
    renderImageControls(scene.id);
    renderLocalAdjustments(scene.id);
    renderExportPanel();
    syncSelectedMarker();
  }

  function focusSelectedMarker() {
    const selected = selectedHotspot();
    if (!selected || api.viewer.getScene() !== state.selected.sceneId) return;
    api.viewer.lookAt(Math.max(-85, Math.min(85, selected.hotspot.pitch + 14)), selected.hotspot.yaw, api.viewer.getHfov(), 240);
  }

  function moveScene(direction) {
    const currentIndex = api.scenes.findIndex((scene) => scene.id === api.viewer.getScene());
    const nextIndex = (currentIndex + direction + api.scenes.length) % api.scenes.length;
    state.arrival = null;
    state.placement = null;
    api.viewer.loadScene(api.scenes[nextIndex].id);
  }

  function applyPlacement(event) {
    const [pitch, yaw] = api.viewer.mouseEventToCoords(event);
    if (state.placement?.type === "hotspot") {
      const selected = selectedHotspot();
      if (!selected) return;
      selected.hotspot.positionConfirmed = true;
      api.updateHotspotCoordinates(state.selected.sceneId, state.selected.hotspotIndex, { pitch: roundCoordinate(pitch), yaw: roundCoordinate(yaw) });
      setStatus(`Transition positioned at ${roundCoordinate(pitch)} / ${roundCoordinate(yaw)}`);
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

  async function saveDraft() {
    const draft = createDraft();
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
      return true;
    } catch (error) {
      setStatus(error.message);
      return false;
    }
  }

  async function continueWizard() {
    if (state.activeStage === "upload") {
      if (!state.workspaceProject?.scenes?.length) {
        setStatus("Upload at least one panorama first");
        return;
      }
      ensureInitialRoom();
      setStage("rooms");
      return;
    }
    if (state.activeStage === "rooms") {
      try {
        await saveWorkspaceStructure("light");
      } catch (error) {
        setStatus(error.message);
      }
      return;
    }
    const readiness = releaseReadiness();
    if (state.activeStage === "links" && readiness.pendingPositions > 0) {
      setStatus(`Place ${readiness.pendingPositions} transition point${readiness.pendingPositions === 1 ? "" : "s"} before continuing`);
      return;
    }
    if (state.activeStage === "arrival" && readiness.pendingArrivals > 0) {
      setStatus(`Save ${readiness.pendingArrivals} arrival view${readiness.pendingArrivals === 1 ? "" : "s"} before review`);
      return;
    }
    if (await saveDraft()) setStage(stageOffset(1));
  }

  function beginArrivalEdit() {
    const selected = selectedHotspot();
    if (!selected) return;
    state.arrival = { ...state.selected };
    state.placement = null;
    api.viewer.loadScene(selected.hotspot.target);
    setStatus("Rotate to the arrival view, then save it");
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
    state.arrival = null;
    setStatus("Arrival view updated");
    if (api.viewer.getScene() !== originSceneId) api.viewer.loadScene(originSceneId);
    else render();
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
    if (!await saveDraft()) return;
    state.building = true;
    setStatus("Building release package...");
    renderExportPanel();
    try {
      const response = await fetch(studioUrl("build-release"), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Build failed (${response.status})`);
      state.release = body;
      setStatus("Release package ready");
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
    try { await createWorkspace(false); } catch (error) { setStatus(error.message); }
  });
  elements.OpenWorkspace.addEventListener("click", () => {
    window.sessionStorage.setItem(stageStorageKey, "upload");
    window.location.assign(state.workspaceProject?.scenes?.length ? workspaceEditorUrl() : `${window.location.pathname}?edit=1`);
  });
  elements.ProjectBackup.addEventListener("change", () => {
    const file = elements.ProjectBackup.files[0];
    elements.ProjectBackupName.textContent = file?.name || "Choose .rdtour file";
    elements.RestoreProject.disabled = !file;
  });
  elements.RestoreProject.addEventListener("click", () => restoreProject(false));
  elements.ImportFiles.addEventListener("change", importPanoramas);
  elements.AddRoom.addEventListener("click", addRoom);
  elements.Home.addEventListener("click", () => setStage("start"));
  elements.Back.addEventListener("click", () => setStage(stageOffset(-1)));
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
  elements.Place.addEventListener("click", () => {
    if (!selectedHotspot()) return;
    state.placement = state.placement?.type === "hotspot" ? null : { type: "hotspot" };
    render();
  });
  elements.RemoveLink.addEventListener("click", () => {
    const scene = currentScene();
    const selected = state.selected;
    if (!scene || !selected || selected.sceneId !== scene.id || selected.hotspotIndex < api.getBaseHotspotCount(scene.id)) return;
    const localIndex = selected.hotspotIndex - api.getBaseHotspotCount(scene.id);
    api.setAddedHotspots(scene.id, api.getAddedHotspots(scene.id).filter((_, index) => index !== localIndex));
    state.selected = scene.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    setStatus("Transition removed");
    render();
  });
  elements.LinkTarget.addEventListener("change", () => {
    elements.LinkKind.value = suggestedLinkKind();
    elements.LinkLabel.value = suggestedLinkLabel();
  });
  elements.LinkKind.addEventListener("change", () => { elements.LinkLabel.value = suggestedLinkLabel(); });
  elements.AddLink.addEventListener("click", () => {
    const scene = currentScene();
    const targetScene = api.sceneById[elements.LinkTarget.value];
    if (!scene || !targetScene) return;
    const additions = api.getAddedHotspots(scene.id);
    api.setAddedHotspots(scene.id, [...additions, {
      kind: elements.LinkKind.value,
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      target: targetScene.id,
      label: elements.LinkLabel.value.trim() || suggestedLinkLabel(),
      targetPitch: targetScene.pitch,
      targetYaw: targetScene.yaw,
      targetHfov: targetScene.hfov,
      positionConfirmed: false,
      arrivalConfirmed: false
    }]);
    state.selected = { sceneId: scene.id, hotspotIndex: api.getBaseHotspotCount(scene.id) + additions.length };
    state.placement = { type: "hotspot" };
    setStatus("Click panorama to place transition");
    render();
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
  });
  elements.AddAdjustment.addEventListener("click", () => {
    const scene = currentScene();
    const existing = api.getLocalAdjustments(scene.id);
    const next = { id: `area-${Date.now().toString(36)}`, shape: "ellipse", pitch: roundCoordinate(api.viewer.getPitch()), yaw: roundCoordinate(api.viewer.getYaw()), width: 240, height: 180, intensity: 30, color: "#fff1b8" };
    api.setLocalAdjustments(scene.id, [...existing, next]);
    state.selectedAdjustmentId = next.id;
    setStatus("Local area not saved");
    renderLocalAdjustments(scene.id);
  });

  viewerElement.addEventListener("pointerdown", (event) => {
    if (state.placement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const marker = event.target.closest("[data-editor-hotspot-id]");
    if (!marker) return;
    const [sceneId, hotspotIndex] = marker.dataset.editorHotspotId.split("::");
    event.preventDefault();
    event.stopImmediatePropagation();
    setSelected(sceneId, Number(hotspotIndex), state.activeStage === "arrival" ? "arrival" : "links");
  }, true);
  viewerElement.addEventListener("click", (event) => {
    if (state.placement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyPlacement(event);
      return;
    }
    if (event.target.closest("[data-editor-hotspot-id]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  api.viewer.on("scenechange", () => {
    const scene = currentScene();
    if (!state.arrival) state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    state.placement = null;
    render();
  });

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

  Promise.all([
    fetch(studioUrl("status")).then((response) => response.ok ? response.json() : Promise.reject(new Error("Local editor server unavailable"))),
    refreshWorkspaceProject(),
    fetch(studioUrl("overrides")).then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not read draft")))
  ]).then(async ([, , draft]) => {
    await waitForViewerPaint();
    applyDraft(draft);
    const scene = currentScene();
    state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    setStatus(!state.workspaceProject
      ? "Ready to create a project"
      : state.workspaceProject.scenes.length === 0
        ? "Project ready. Upload panoramas."
        : state.activeStage === "upload"
          ? `${state.workspaceProject.scenes.length} panorama${state.workspaceProject.scenes.length === 1 ? "" : "s"} ready`
          : state.savedAt ? "Saved project loaded" : "Project ready");
    render();
    refreshReleaseStatus();
  }).catch((error) => {
    panel.remove();
    editorToggle.remove();
    console.warn(error.message);
  });
})();
