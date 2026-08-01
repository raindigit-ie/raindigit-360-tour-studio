(() => {
  "use strict";

  const api = window.__TOUR_EDITOR_API;
  if (!api) return;

  const endpoint = "__tour-editor";
  const roundCoordinate = (value) => Math.round(value * 10) / 10;
  const workspaceMode = new URLSearchParams(window.location.search).get("workspace") === "1";
  const state = {
    activeStage: "project",
    selected: null,
    selectedAdjustmentId: null,
    placement: null,
    arrival: null,
    savedAt: null,
    workspaceProject: null,
    importing: false
  };

  const panel = document.createElement("aside");
  panel.className = "editor-panel";
  panel.setAttribute("aria-label", "Tour studio editor");
  panel.innerHTML = `
    <div class="editor-panel__header">
      <p class="editor-panel__title">Tour studio</p>
      <button class="editor-button editor-button--icon" id="editorClose" type="button" aria-label="Hide tour studio" title="Hide tour studio">&times;</button>
    </div>
    <div class="editor-workflow" role="tablist" aria-label="Tour preparation steps">
      <button class="editor-stage" data-stage="project" type="button" role="tab">Project</button>
      <button class="editor-stage" data-stage="scenes" type="button" role="tab">Scenes</button>
      <button class="editor-stage" data-stage="links" type="button" role="tab">Links</button>
      <button class="editor-stage" data-stage="arrival" type="button" role="tab">Arrival</button>
      <button class="editor-stage" data-stage="light" type="button" role="tab">Light</button>
    </div>
    <div class="editor-panel__scene">
      <button class="editor-button editor-button--icon" id="editorPreviousScene" type="button" aria-label="Previous scene" title="Previous scene">&larr;</button>
      <strong class="editor-panel__scene-name" id="editorSceneName"></strong>
      <button class="editor-button editor-button--icon" id="editorNextScene" type="button" aria-label="Next scene" title="Next scene">&rarr;</button>
    </div>
    <section class="editor-stage-panel" data-stage-panel="project">
      <p class="editor-help" id="editorProjectHelp"></p>
      <label class="editor-field">
        <span>Project title</span>
        <input id="editorProjectTitle" type="text" maxlength="100" autocomplete="off" value="Untitled 3D Tour" />
      </label>
      <div class="editor-panel__actions">
        <button class="editor-button" id="editorCreateWorkspace" type="button">Create local workspace</button>
        <button class="editor-button" id="editorOpenWorkspace" type="button">Open workspace</button>
      </div>
      <label class="editor-field">
        <span>Stitched 2:1 JPEG panoramas</span>
        <input id="editorImportFiles" type="file" accept="image/jpeg,.jpg,.jpeg" multiple />
      </label>
      <div class="editor-panel__actions">
        <button class="editor-button" id="editorImport" type="button">Import selected panoramas</button>
      </div>
      <div class="editor-project-order" id="editorProjectOrder" aria-label="Workspace scene order"></div>
    </section>
    <section class="editor-stage-panel" data-stage-panel="scenes">
      <label class="editor-field">
        <span>Location name</span>
        <input id="editorSceneTitle" type="text" maxlength="80" autocomplete="off" />
      </label>
      <label class="editor-field">
        <span>View description</span>
        <input id="editorSceneSubtitle" type="text" maxlength="120" autocomplete="off" />
      </label>
    </section>
    <section class="editor-stage-panel" data-stage-panel="links">
      <div class="editor-hotspot-list" id="editorHotspotList"></div>
      <div class="editor-panel__actions">
        <button class="editor-button" id="editorPlace" type="button">Place selected point</button>
        <button class="editor-button" id="editorRemoveLink" type="button">Remove local link</button>
      </div>
      <details class="editor-new-link">
        <summary>Add transition</summary>
        <label class="editor-field"><span>Destination</span><select id="editorLinkTarget" aria-label="Transition destination"></select></label>
        <label class="editor-field"><span>Marker type</span><select id="editorLinkKind" aria-label="Transition marker type"><option value="doorway">Walk through</option><option value="viewpoint">Other camera view</option></select></label>
        <label class="editor-field"><span>Label</span><input id="editorLinkLabel" type="text" maxlength="80" autocomplete="off" /></label>
        <div class="editor-panel__actions"><button class="editor-button" id="editorAddLink" type="button">Add transition</button></div>
      </details>
    </section>
    <section class="editor-stage-panel" data-stage-panel="arrival">
      <p class="editor-help" id="editorArrivalHelp"></p>
      <div class="editor-panel__actions">
        <button class="editor-button" id="editorEditArrival" type="button">Set arrival view</button>
        <button class="editor-button" id="editorSaveArrival" type="button">Save arrival view</button>
      </div>
    </section>
    <section class="editor-stage-panel" data-stage-panel="light">
      <details class="editor-image" open>
        <summary>Whole panorama</summary>
        <div class="editor-image__controls" id="editorImageControls"></div>
      </details>
      <div class="editor-local-header">
        <strong>Soft light and color areas</strong>
        <button class="editor-button" id="editorAddAdjustment" type="button">Add area</button>
      </div>
      <div class="editor-adjustment-list" id="editorAdjustmentList"></div>
      <div class="editor-adjustment-controls" id="editorAdjustmentControls"></div>
    </section>
    <div class="editor-panel__footer">
      <span class="editor-panel__status" id="editorStatus">Loading draft</span>
      <button class="editor-button" id="editorSave" type="button">Save</button>
    </div>
  `;
  document.body.appendChild(panel);
  document.body.classList.add("is-editor-open");

  const sceneName = panel.querySelector("#editorSceneName");
  const projectHelp = panel.querySelector("#editorProjectHelp");
  const projectTitleInput = panel.querySelector("#editorProjectTitle");
  const createWorkspaceButton = panel.querySelector("#editorCreateWorkspace");
  const openWorkspaceButton = panel.querySelector("#editorOpenWorkspace");
  const importFilesInput = panel.querySelector("#editorImportFiles");
  const importButton = panel.querySelector("#editorImport");
  const projectOrder = panel.querySelector("#editorProjectOrder");
  const sceneTitleInput = panel.querySelector("#editorSceneTitle");
  const sceneSubtitleInput = panel.querySelector("#editorSceneSubtitle");
  const hotspotList = panel.querySelector("#editorHotspotList");
  const placeButton = panel.querySelector("#editorPlace");
  const removeLinkButton = panel.querySelector("#editorRemoveLink");
  const linkTarget = panel.querySelector("#editorLinkTarget");
  const linkKind = panel.querySelector("#editorLinkKind");
  const linkLabel = panel.querySelector("#editorLinkLabel");
  const addLinkButton = panel.querySelector("#editorAddLink");
  const editArrivalButton = panel.querySelector("#editorEditArrival");
  const saveArrivalButton = panel.querySelector("#editorSaveArrival");
  const arrivalHelp = panel.querySelector("#editorArrivalHelp");
  const imageControls = panel.querySelector("#editorImageControls");
  const adjustmentList = panel.querySelector("#editorAdjustmentList");
  const adjustmentControls = panel.querySelector("#editorAdjustmentControls");
  const addAdjustmentButton = panel.querySelector("#editorAddAdjustment");
  const saveButton = panel.querySelector("#editorSave");
  const status = panel.querySelector("#editorStatus");
  const viewerElement = api.viewer.getContainer();

  const editorToggle = document.createElement("button");
  editorToggle.className = "icon-button";
  editorToggle.type = "button";
  editorToggle.setAttribute("aria-label", "Hide tour studio");
  editorToggle.title = "Hide tour studio";
  editorToggle.innerHTML = "&#9678;";
  document.querySelector(".toolbar").appendChild(editorToggle);

  function setStatus(message) {
    status.textContent = message;
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

  function setStage(stage) {
    state.activeStage = stage;
    render();
  }

  function setSelected(sceneId, hotspotIndex) {
    state.selected = { sceneId, hotspotIndex };
    state.placement = null;
    state.arrival = null;
    setStage("links");
    focusSelectedMarker();
  }

  function selectedAdjustment() {
    const scene = currentScene();
    if (!scene || !state.selectedAdjustmentId) return null;
    return api.getLocalAdjustments(scene.id).find((adjustment) => adjustment.id === state.selectedAdjustmentId) || null;
  }

  function syncSelectedMarker() {
    const activeId = state.selected ? api.hotspotId(state.selected.sceneId, state.selected.hotspotIndex) : "";
    viewerElement.querySelectorAll(".nav-hotspot").forEach((element) => {
      element.classList.toggle("is-editor-selected", element.dataset.editorHotspotId === activeId);
    });
  }

  function renderStages() {
    panel.querySelectorAll(".editor-stage").forEach((button) => {
      const active = button.dataset.stage === state.activeStage;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    panel.querySelectorAll(".editor-stage-panel").forEach((section) => {
      section.hidden = section.dataset.stagePanel !== state.activeStage;
    });
  }

  function renderProjectPanel() {
    const project = state.workspaceProject;
    projectTitleInput.disabled = Boolean(project);
    createWorkspaceButton.textContent = project ? "Replace local workspace" : "Create local workspace";
    openWorkspaceButton.hidden = !project || workspaceMode;
    importFilesInput.disabled = !project || state.importing;
    importButton.disabled = !project || state.importing || importFilesInput.files.length === 0;
    importButton.textContent = state.importing ? "Importing panoramas" : "Import selected panoramas";
    projectOrder.replaceChildren();
    if (!project) {
      projectHelp.textContent = "Create an isolated local workspace, then import stitched 2:1 JPEG panoramas. Existing review files remain untouched.";
      return;
    }
    projectHelp.textContent = workspaceMode
      ? "This workspace is isolated from the existing tour. Reorder scenes here before marking links and saving the draft."
      : "Workspace is ready. Import panoramas, then open it to name rooms, set links and compose the tour.";
    projectTitleInput.value = project.title;
    project.scenes.forEach((scene, index) => {
      const currentTitle = api.sceneById[scene.id]?.title || scene.title;
      const row = document.createElement("div");
      row.className = "editor-project-scene";
      const label = document.createElement("span");
      label.textContent = `${index + 1}. ${currentTitle}`;
      const up = document.createElement("button");
      up.className = "editor-button editor-button--icon";
      up.type = "button";
      up.textContent = "↑";
      up.title = "Move scene earlier";
      up.setAttribute("aria-label", `Move ${currentTitle} earlier`);
      up.disabled = index === 0 || !workspaceMode;
      up.addEventListener("click", () => moveWorkspaceScene(index, -1));
      const down = document.createElement("button");
      down.className = "editor-button editor-button--icon";
      down.type = "button";
      down.textContent = "↓";
      down.title = "Move scene later";
      down.setAttribute("aria-label", `Move ${currentTitle} later`);
      down.disabled = index === project.scenes.length - 1 || !workspaceMode;
      down.addEventListener("click", () => moveWorkspaceScene(index, 1));
      row.append(label, up, down);
      projectOrder.appendChild(row);
    });
  }

  async function refreshWorkspaceProject() {
    const response = await fetch(studioUrl("workspace-project", false));
    if (!response.ok) throw new Error(`Could not read workspace (${response.status})`);
    const body = await response.json();
    state.workspaceProject = body.project || null;
    return state.workspaceProject;
  }

  async function createWorkspace(replace = false) {
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", title: projectTitleInput.value, replace })
    });
    if (response.status === 409 && !replace) {
      if (window.confirm("Replace the existing local workspace? Its workspace images and draft will be removed; the current tour and source panoramas will not change.")) {
        return createWorkspace(true);
      }
      return null;
    }
    if (!response.ok) throw new Error(`Could not create workspace (${response.status})`);
    state.workspaceProject = await response.json();
    return state.workspaceProject;
  }

  async function moveWorkspaceScene(index, direction) {
    const project = state.workspaceProject;
    const target = index + direction;
    if (!project || target < 0 || target >= project.scenes.length) return;
    const sceneIds = project.scenes.map((scene) => scene.id);
    [sceneIds[index], sceneIds[target]] = [sceneIds[target], sceneIds[index]];
    setStatus("Saving scene order");
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reorder", sceneIds })
    });
    if (!response.ok) {
      setStatus(`Could not reorder scenes (${response.status})`);
      return;
    }
    state.workspaceProject = await response.json();
    setStatus("Scene order saved; reloading workspace");
    window.location.reload();
  }

  async function importPanoramas() {
    const files = [...importFilesInput.files];
    if (files.length === 0) return;
    try {
      if (!state.workspaceProject) await createWorkspace();
      if (!state.workspaceProject) return;
      state.importing = true;
      renderProjectPanel();
      for (const [index, file] of files.entries()) {
        setStatus(`Importing ${index + 1} of ${files.length}`);
        const response = await fetch(studioUrl("workspace-import", true), {
          method: "POST",
          headers: {
            "content-type": "image/jpeg",
            "x-tour-file-name": encodeURIComponent(file.name)
          },
          body: file
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Import failed (${response.status})`);
        state.workspaceProject = body.project;
      }
      importFilesInput.value = "";
      setStatus("Panoramas imported; opening workspace");
      window.location.assign(workspaceEditorUrl());
    } catch (error) {
      setStatus(error.message);
    } finally {
      state.importing = false;
      renderProjectPanel();
    }
  }

  function renderSceneFields(scene) {
    sceneTitleInput.value = scene.title;
    sceneSubtitleInput.value = scene.subtitle || "";
  }

  function renderHotspotList(scene) {
    hotspotList.replaceChildren();
    scene.hotspots.forEach((hotspot, hotspotIndex) => {
      const button = document.createElement("button");
      const selected = state.selected?.sceneId === scene.id && state.selected.hotspotIndex === hotspotIndex;
      button.className = `editor-hotspot${selected ? " is-selected" : ""}`;
      button.type = "button";
      button.innerHTML = `
        <span class="editor-hotspot__type" aria-hidden="true">${hotspot.kind === "viewpoint" ? "V" : "W"}</span>
        <span class="editor-hotspot__label"></span>
        <span class="editor-hotspot__coords"></span>
      `;
      button.querySelector(".editor-hotspot__label").textContent = hotspot.label;
      button.querySelector(".editor-hotspot__coords").textContent = `${hotspot.pitch.toFixed(1)} / ${hotspot.yaw.toFixed(1)}`;
      button.addEventListener("click", () => setSelected(scene.id, hotspotIndex));
      hotspotList.appendChild(button);
    });
    placeButton.disabled = !selectedHotspot();
    placeButton.classList.toggle("is-active", state.placement?.type === "hotspot");
    placeButton.textContent = state.placement?.type === "hotspot" ? "Click panorama to place" : "Place selected point";
    const selectedIndex = state.selected?.sceneId === scene.id ? state.selected.hotspotIndex : -1;
    removeLinkButton.hidden = selectedIndex < api.getBaseHotspotCount(scene.id);
    renderLinkCreator(scene);
  }

  function suggestedLinkLabel() {
    const targetScene = api.sceneById[linkTarget.value];
    return `${linkKind.value === "viewpoint" ? "View" : "Walk"} to ${targetScene?.title || "destination"}`;
  }

  function renderLinkCreator(scene) {
    const selectedTarget = linkTarget.value;
    linkTarget.replaceChildren();
    api.scenes.filter((candidate) => candidate.id !== scene.id).forEach((candidate) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.title;
      linkTarget.appendChild(option);
    });
    if ([...linkTarget.options].some((option) => option.value === selectedTarget)) linkTarget.value = selectedTarget;
    if (!linkLabel.value) linkLabel.value = suggestedLinkLabel();
  }

  function renderArrivalPanel() {
    const selected = selectedHotspot();
    if (!selected) {
      arrivalHelp.textContent = "Select a transition in Links first.";
      editArrivalButton.disabled = true;
      saveArrivalButton.hidden = true;
      return;
    }
    editArrivalButton.disabled = false;
    if (state.arrival) {
      arrivalHelp.textContent = `Adjust the destination view for ${selected.hotspot.label}, then save it.`;
      editArrivalButton.hidden = true;
      saveArrivalButton.hidden = false;
      return;
    }
    arrivalHelp.textContent = `Choose the exact first view after ${selected.hotspot.label}.`;
    editArrivalButton.hidden = false;
    saveArrivalButton.hidden = true;
  }

  function renderImageControls(sceneId) {
    const adjustment = api.getSceneAdjustment(sceneId);
    const fields = [
      { key: "brightness", label: "Brightness", min: 70, max: 130, unit: "%" },
      { key: "contrast", label: "Contrast", min: 70, max: 130, unit: "%" },
      { key: "saturation", label: "Saturation", min: 0, max: 160, unit: "%" },
      { key: "warmth", label: "Warm/cool tint", min: -20, max: 20, unit: "" }
    ];
    imageControls.replaceChildren();
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
        setStatus("Unsaved image changes");
      });
      row.append(input, output);
      label.append(name, row);
      imageControls.appendChild(label);
    });
  }

  function updateSelectedAdjustment(change) {
    const scene = currentScene();
    const adjustment = selectedAdjustment();
    if (!scene || !adjustment) return;
    const next = api.getLocalAdjustments(scene.id).map((item) => item.id === adjustment.id ? { ...item, ...change } : item);
    api.setLocalAdjustments(scene.id, next);
    setStatus("Unsaved local adjustment");
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
    adjustmentList.replaceChildren();
    if (state.selectedAdjustmentId && !adjustments.some((adjustment) => adjustment.id === state.selectedAdjustmentId)) {
      state.selectedAdjustmentId = null;
    }
    adjustments.forEach((adjustment, index) => {
      const button = document.createElement("button");
      button.className = `editor-adjustment${adjustment.id === state.selectedAdjustmentId ? " is-selected" : ""}`;
      button.type = "button";
      button.textContent = `Area ${index + 1}`;
      button.addEventListener("click", () => {
        state.selectedAdjustmentId = adjustment.id;
        renderLocalAdjustments(sceneId);
      });
      adjustmentList.appendChild(button);
    });
    adjustmentControls.replaceChildren();
    const selected = selectedAdjustment();
    if (!selected) return;

    const shape = document.createElement("label");
    shape.className = "editor-field";
    shape.innerHTML = `<span>Shape</span><select aria-label="Adjustment shape"><option value="ellipse">Circle / ellipse</option><option value="rectangle">Square / rectangle</option></select>`;
    const shapeSelect = shape.querySelector("select");
    shapeSelect.value = selected.shape;
    shapeSelect.addEventListener("change", () => updateSelectedAdjustment({ shape: shapeSelect.value }));

    const color = document.createElement("label");
    color.className = "editor-field editor-field--color";
    color.innerHTML = `<span>Light color</span><input type="color" aria-label="Light color" />`;
    const colorInput = color.querySelector("input");
    colorInput.value = selected.color;
    colorInput.addEventListener("input", () => updateSelectedAdjustment({ color: colorInput.value }));

    const actions = document.createElement("div");
    actions.className = "editor-panel__actions";
    const place = document.createElement("button");
    place.className = "editor-button";
    place.type = "button";
    place.textContent = state.placement?.type === "adjustment" ? "Click panorama to place" : "Place area";
    place.classList.toggle("is-active", state.placement?.type === "adjustment");
    place.addEventListener("click", () => {
      state.placement = state.placement?.type === "adjustment" ? null : { type: "adjustment", id: selected.id };
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
      setStatus("Unsaved local adjustment");
      renderLocalAdjustments(sceneId);
    });
    actions.append(place, remove);

    adjustmentControls.append(
      shape,
      color,
      createRangeControl("Light / shadow", "intensity", -100, 100, "%"),
      createRangeControl("Width", "width", 80, 720, "px"),
      createRangeControl("Height", "height", 80, 520, "px"),
      actions
    );
  }

  function render() {
    const scene = currentScene();
    if (!scene) return;
    sceneName.textContent = scene.title;
    renderStages();
    renderProjectPanel();
    renderSceneFields(scene);
    renderHotspotList(scene);
    renderArrivalPanel();
    renderImageControls(scene.id);
    renderLocalAdjustments(scene.id);
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
      api.updateHotspotCoordinates(state.selected.sceneId, state.selected.hotspotIndex, { pitch: roundCoordinate(pitch), yaw: roundCoordinate(yaw) });
      setStatus("Unsaved point placement");
    }
    if (state.placement?.type === "adjustment") {
      const scene = currentScene();
      const next = api.getLocalAdjustments(scene.id).map((adjustment) => adjustment.id === state.placement.id
        ? { ...adjustment, pitch: roundCoordinate(pitch), yaw: roundCoordinate(yaw) }
        : adjustment);
      api.setLocalAdjustments(scene.id, next);
      setStatus("Unsaved local adjustment");
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
    Object.entries(draft.sceneAdjustments || {}).forEach(([sceneId, adjustment]) => api.setSceneAdjustment(sceneId, adjustment));
    Object.entries(draft.localAdjustments || {}).forEach(([sceneId, adjustments]) => api.setLocalAdjustments(sceneId, adjustments));
    state.savedAt = draft.updatedAt || null;
  }

  async function saveDraft() {
    const draft = createDraft();
    saveButton.disabled = true;
    setStatus("Saving locally");
    try {
      const response = await fetch(studioUrl("save"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      state.savedAt = draft.updatedAt;
      setStatus("Saved locally");
    } catch (error) {
      setStatus(error.message);
    } finally {
      saveButton.disabled = false;
    }
  }

  function beginArrivalEdit() {
    const selected = selectedHotspot();
    if (!selected) return;
    state.arrival = { ...state.selected };
    state.placement = null;
    api.viewer.loadScene(selected.hotspot.target);
    setStatus("Adjust destination view, then save arrival");
  }

  function saveArrivalView() {
    if (!state.arrival) return;
    api.updateHotspotArrival(state.arrival.sceneId, state.arrival.hotspotIndex, {
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      hfov: roundCoordinate(api.viewer.getHfov())
    });
    state.arrival = null;
    setStatus("Unsaved arrival view");
    render();
  }

  panel.querySelectorAll(".editor-stage").forEach((button) => button.addEventListener("click", () => setStage(button.dataset.stage)));
  createWorkspaceButton.addEventListener("click", async () => {
    try {
      await createWorkspace(Boolean(state.workspaceProject));
      setStatus("Local workspace ready");
      renderProjectPanel();
    } catch (error) {
      setStatus(error.message);
    }
  });
  openWorkspaceButton.addEventListener("click", () => window.location.assign(workspaceEditorUrl()));
  importFilesInput.addEventListener("change", renderProjectPanel);
  importButton.addEventListener("click", importPanoramas);
  panel.querySelector("#editorClose").addEventListener("click", () => document.body.classList.remove("is-editor-open"));
  editorToggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("is-editor-open");
    editorToggle.setAttribute("aria-label", isOpen ? "Hide tour studio" : "Show tour studio");
    editorToggle.title = editorToggle.getAttribute("aria-label");
  });
  panel.querySelector("#editorPreviousScene").addEventListener("click", () => moveScene(-1));
  panel.querySelector("#editorNextScene").addEventListener("click", () => moveScene(1));
  sceneTitleInput.addEventListener("input", () => {
    const scene = currentScene();
    api.setSceneMetadata(scene.id, { title: sceneTitleInput.value, subtitle: sceneSubtitleInput.value });
    sceneName.textContent = api.sceneById[scene.id].title;
    setStatus("Unsaved scene name");
  });
  sceneSubtitleInput.addEventListener("input", () => {
    const scene = currentScene();
    api.setSceneMetadata(scene.id, { title: sceneTitleInput.value, subtitle: sceneSubtitleInput.value });
    setStatus("Unsaved scene name");
  });
  placeButton.addEventListener("click", () => {
    if (!selectedHotspot()) return;
    state.placement = state.placement?.type === "hotspot" ? null : { type: "hotspot" };
    render();
  });
  removeLinkButton.addEventListener("click", () => {
    const scene = currentScene();
    const selected = state.selected;
    if (!scene || !selected || selected.sceneId !== scene.id || selected.hotspotIndex < api.getBaseHotspotCount(scene.id)) return;
    const localIndex = selected.hotspotIndex - api.getBaseHotspotCount(scene.id);
    api.setAddedHotspots(scene.id, api.getAddedHotspots(scene.id).filter((_, index) => index !== localIndex));
    state.selected = scene.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    setStatus("Unsaved local link change");
    render();
  });
  linkTarget.addEventListener("change", () => { linkLabel.value = suggestedLinkLabel(); });
  linkKind.addEventListener("change", () => { linkLabel.value = suggestedLinkLabel(); });
  addLinkButton.addEventListener("click", () => {
    const scene = currentScene();
    const targetScene = api.sceneById[linkTarget.value];
    if (!scene || !targetScene) return;
    const additions = api.getAddedHotspots(scene.id);
    api.setAddedHotspots(scene.id, [...additions, {
      kind: linkKind.value,
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      target: targetScene.id,
      label: linkLabel.value.trim() || suggestedLinkLabel(),
      targetPitch: targetScene.pitch,
      targetYaw: targetScene.yaw,
      targetHfov: targetScene.hfov
    }]);
    state.selected = { sceneId: scene.id, hotspotIndex: api.getBaseHotspotCount(scene.id) + additions.length };
    state.placement = { type: "hotspot" };
    setStatus("Click panorama to place new transition");
    render();
  });
  editArrivalButton.addEventListener("click", beginArrivalEdit);
  saveArrivalButton.addEventListener("click", saveArrivalView);
  addAdjustmentButton.addEventListener("click", () => {
    const scene = currentScene();
    const existing = api.getLocalAdjustments(scene.id);
    const next = {
      id: `area-${Date.now().toString(36)}`,
      shape: "ellipse",
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      width: 240,
      height: 180,
      intensity: 30,
      color: "#fff1b8"
    };
    api.setLocalAdjustments(scene.id, [...existing, next]);
    state.selectedAdjustmentId = next.id;
    setStatus("Unsaved local adjustment");
    renderLocalAdjustments(scene.id);
  });
  saveButton.addEventListener("click", saveDraft);

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
    setSelected(sceneId, Number(hotspotIndex));
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
    if (!state.arrival) {
      state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
    }
    state.placement = null;
    render();
  });

  fetch(studioUrl("status"))
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Local editor server unavailable")))
    .then(() => refreshWorkspaceProject())
    .then(() => fetch(studioUrl("overrides")))
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not read draft")))
    .then((draft) => {
      applyDraft(draft);
      const scene = currentScene();
      state.selected = scene?.hotspots.length ? { sceneId: scene.id, hotspotIndex: 0 } : null;
      setStatus(state.savedAt ? "Saved draft loaded" : "New draft");
      render();
      focusSelectedMarker();
    })
    .catch((error) => {
      panel.remove();
      editorToggle.remove();
      console.warn(error.message);
    });
})();
