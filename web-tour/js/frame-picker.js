(() => {
  "use strict";

  const endpoint = "/__tour-editor";
  const asset = (path) => `${endpoint}/workspace/${path}`;
  const frameSlots = [
    ["cover", "Story cover"],
    ["card", "Stories card"],
    ["gallery-1", "Gallery 1"],
    ["gallery-2", "Gallery 2"],
    ["gallery-3", "Gallery 3"],
    ["detail-1", "Detail 1"],
    ["detail-2", "Detail 2"]
  ];
  const defaultAdjustment = Object.freeze({ brightness: 100, contrast: 100, saturation: 100, warmth: 0 });

  const state = {
    project: null,
    draft: null,
    selections: null,
    activeSceneId: null,
    viewer: null,
    saving: false
  };

  function normaliseNumber(value, fallback) {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : fallback;
  }

  function sceneById(sceneId) {
    return state.project?.scenes?.find((scene) => scene.id === sceneId) || null;
  }

  function selectedSlot() {
    return document.querySelector("#framePickerSlot")?.value || "cover";
  }

  function setStatus(message, tone = "neutral") {
    const element = document.querySelector("#framePickerStatus");
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function showToast(message, tone = "success") {
    const toast = document.querySelector("#framePickerToast");
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  function canvasFilter(sceneId) {
    const adjustment = {
      ...defaultAdjustment,
      ...(state.draft?.sceneAdjustments?.[sceneId] || {})
    };
    if (
      adjustment.brightness === 100 &&
      adjustment.contrast === 100 &&
      adjustment.saturation === 100 &&
      adjustment.warmth === 0
    ) {
      return "none";
    }
    const warmTint = Math.max(0, adjustment.warmth) / 100;
    const coolHueShift = Math.min(18, Math.max(0, -adjustment.warmth) * 0.9);
    return `brightness(${adjustment.brightness}%) contrast(${adjustment.contrast}%) saturate(${adjustment.saturation}%) sepia(${warmTint.toFixed(2)}) hue-rotate(${-coolHueShift.toFixed(1)}deg)`;
  }

  function applyCurrentFilter() {
    const canvas = document.querySelector("#framePickerViewer .pnlm-render-container canvas");
    if (canvas) canvas.style.filter = canvasFilter(state.activeSceneId);
  }

  function createShell() {
    document.body.classList.add("frame-picker-mode");
    document.querySelector(".tour-shell")?.setAttribute("hidden", "");
    const app = document.createElement("section");
    app.className = "frame-picker-app";
    app.innerHTML = `
      <header class="frame-picker-header">
        <div>
          <p class="frame-picker-kicker">RainDigit 360 Tour Studio</p>
          <h1>Frame picker</h1>
          <p>Choose a scene, rotate to the strongest composition, select a slot, then save the view.</p>
        </div>
        <nav class="frame-picker-header__actions" aria-label="Frame picker actions">
          <a class="frame-picker-button frame-picker-button--ghost" href="?edit=1&workspace=1">Open editor</a>
          <a class="frame-picker-button frame-picker-button--ghost" href="?preview=1&workspace=1">Open preview</a>
        </nav>
      </header>
      <main class="frame-picker-layout">
        <section class="frame-picker-stage" aria-label="Selected 360 frame">
          <div id="framePickerViewer" class="frame-picker-viewer"></div>
          <div id="framePickerToast" class="frame-picker-toast" hidden role="status" aria-live="polite"></div>
          <div class="frame-picker-savebar">
            <label>
              <span>Save as</span>
              <select id="framePickerSlot"></select>
            </label>
            <label>
              <span>Label</span>
              <input id="framePickerLabel" type="text" maxlength="120" placeholder="Short note for this frame" />
            </label>
            <button id="framePickerSave" class="frame-picker-button" type="button">Save current view</button>
            <p id="framePickerStatus" data-tone="neutral">Loading workspace...</p>
          </div>
        </section>
        <aside class="frame-picker-sidebar" aria-label="Tour scenes and saved frames">
          <section>
            <div class="frame-picker-section-title">
              <h2>All tour frames</h2>
              <small id="framePickerSceneCount"></small>
            </div>
            <div id="framePickerScenes" class="frame-picker-scene-list"></div>
          </section>
          <section>
            <div class="frame-picker-section-title">
              <h2>Saved choices</h2>
              <small id="framePickerSavedCount"></small>
            </div>
            <div id="framePickerSaved" class="frame-picker-saved-list"></div>
          </section>
        </aside>
      </main>
    `;
    document.body.appendChild(app);

    const slotSelect = app.querySelector("#framePickerSlot");
    frameSlots.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      slotSelect.append(option);
    });
    slotSelect.addEventListener("change", syncLabelFromSlot);
    app.querySelector("#framePickerSave").addEventListener("click", saveCurrentFrame);
  }

  function sceneMeta(scene) {
    return [scene.spaceLabel, scene.floorLabel].filter(Boolean).join(" · ");
  }

  function renderScenes() {
    const list = document.querySelector("#framePickerScenes");
    const count = document.querySelector("#framePickerSceneCount");
    if (!list || !count) return;
    list.textContent = "";
    count.textContent = `${state.project.scenes.length} photos`;
    state.project.scenes.forEach((scene, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `frame-picker-scene${scene.id === state.activeSceneId ? " is-active" : ""}`;
      button.innerHTML = `
        <img alt="" loading="lazy" decoding="async" />
        <span>
          <strong></strong>
          <small></small>
        </span>
      `;
      button.querySelector("img").src = asset(scene.thumb || scene.panorama);
      button.querySelector("strong").textContent = scene.title || `View ${index + 1}`;
      button.querySelector("small").textContent = sceneMeta(scene) || scene.id;
      button.addEventListener("click", () => loadScene(scene.id));
      list.append(button);
    });
  }

  function renderSaved() {
    const list = document.querySelector("#framePickerSaved");
    const count = document.querySelector("#framePickerSavedCount");
    if (!list || !count) return;
    const frames = state.selections?.frames || {};
    const entries = frameSlots.map(([slot, label]) => [slot, label, frames[slot]]).filter(([, , frame]) => frame);
    list.textContent = "";
    count.textContent = entries.length ? `${entries.length} saved` : "none yet";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "frame-picker-empty";
      empty.textContent = "No saved frames yet.";
      list.append(empty);
      return;
    }
    entries.forEach(([slot, slotLabel, frame]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "frame-picker-saved";
      button.innerHTML = `
        <img alt="" loading="lazy" decoding="async" />
        <span>
          <strong></strong>
          <small></small>
        </span>
      `;
      button.querySelector("img").src = asset(frame.thumb || frame.panorama);
      button.querySelector("strong").textContent = `${slotLabel}: ${frame.label || frame.sceneTitle}`;
      button.querySelector("small").textContent = `yaw ${frame.yaw}, pitch ${frame.pitch}, hfov ${frame.hfov}`;
      button.addEventListener("click", () => {
        document.querySelector("#framePickerSlot").value = slot;
        document.querySelector("#framePickerLabel").value = frame.label || "";
        loadScene(frame.sceneId, frame);
      });
      list.append(button);
    });
  }

  function syncLabelFromSlot() {
    const scene = sceneById(state.activeSceneId);
    const input = document.querySelector("#framePickerLabel");
    if (!scene || !input || input.value.trim()) return;
    const [, slotLabel] = frameSlots.find(([slot]) => slot === selectedSlot()) || frameSlots[0];
    input.value = `${slotLabel} - ${scene.title || scene.id}`;
  }

  function loadScene(sceneId, view = null) {
    const scene = sceneById(sceneId);
    if (!scene) return;
    state.activeSceneId = scene.id;
    const savedView = view || state.selections?.frames?.[selectedSlot()];
    const useSavedView = savedView?.sceneId === scene.id;
    const config = {
      type: "equirectangular",
      panorama: asset(scene.panorama),
      autoLoad: true,
      showControls: true,
      compass: false,
      keyboardZoom: false,
      mouseZoom: true,
      doubleClickZoom: false,
      pitch: normaliseNumber(useSavedView ? savedView.pitch : scene.pitch, -8),
      yaw: normaliseNumber(useSavedView ? savedView.yaw : scene.yaw, 0),
      hfov: normaliseNumber(useSavedView ? savedView.hfov : scene.hfov, 92)
    };
    if (state.viewer) state.viewer.destroy();
    state.viewer = window.pannellum.viewer("framePickerViewer", config);
    state.viewer.on("load", applyCurrentFilter);
    state.viewer.on("render", applyCurrentFilter);
    document.querySelector("#framePickerLabel").value = useSavedView ? savedView.label : "";
    syncLabelFromSlot();
    renderScenes();
    setStatus(`Viewing ${scene.title || scene.id}. Rotate and save when the composition is right.`);
  }

  function currentFramePayload() {
    const scene = sceneById(state.activeSceneId);
    if (!scene || !state.viewer) return null;
    const slot = selectedSlot();
    const [, slotLabel] = frameSlots.find(([value]) => value === slot) || frameSlots[0];
    const label = document.querySelector("#framePickerLabel").value.trim() || `${slotLabel} - ${scene.title || scene.id}`;
    return {
      sceneId: scene.id,
      sceneTitle: scene.title || scene.id,
      label,
      panorama: scene.panorama,
      thumb: scene.thumb || null,
      yaw: normaliseNumber(state.viewer.getYaw(), 0),
      pitch: normaliseNumber(state.viewer.getPitch(), 0),
      hfov: normaliseNumber(state.viewer.getHfov(), 92),
      savedAt: new Date().toISOString()
    };
  }

  async function saveCurrentFrame() {
    if (state.saving) return;
    const frame = currentFramePayload();
    if (!frame) {
      setStatus("Select a tour frame first.", "error");
      return;
    }
    state.saving = true;
    const saveButton = document.querySelector("#framePickerSave");
    saveButton.disabled = true;
    const nextSelections = {
      schema: "raindigit-tour-frame-selections/v1",
      tourTitle: state.project.title || "Untitled 3D Tour",
      updatedAt: new Date().toISOString(),
      frames: {
        ...(state.selections?.frames || {}),
        [selectedSlot()]: frame
      }
    };
    try {
      const response = await fetch(`${endpoint}/frame-selections?workspace=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextSelections)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Save failed (${response.status})`);
      state.selections = body.selections;
      renderSaved();
      setStatus(`Saved ${frame.label}.`, "success");
      showToast(`Saved: ${frame.label}`);
      saveButton.textContent = "Saved";
      window.setTimeout(() => {
        if (!state.saving) saveButton.textContent = "Save current view";
      }, 1400);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not save this frame.", "error");
      showToast(error.message || "Could not save this frame.", "error");
    } finally {
      state.saving = false;
      saveButton.disabled = false;
    }
  }

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Could not load ${path}`);
    return body;
  }

  async function init() {
    createShell();
    try {
      const [projectResponse, draft, selectionsResponse] = await Promise.all([
        loadJson(`${endpoint}/workspace-project`),
        loadJson(`${endpoint}/overrides?workspace=1`).catch(() => null),
        loadJson(`${endpoint}/frame-selections?workspace=1`)
      ]);
      state.project = projectResponse.project;
      state.draft = draft;
      state.selections = selectionsResponse.selections;
      if (!state.project?.scenes?.length) throw new Error("Create a tour and add 360 photos first.");
      state.activeSceneId = state.selections?.frames?.cover?.sceneId || state.project.firstScene || state.project.scenes[0].id;
      renderSaved();
      loadScene(state.activeSceneId, state.selections?.frames?.cover || null);
      window.__RAINDIGIT_FRAME_PICKER_DEBUG__ = {
        snapshot: () => ({
          activeSceneId: state.activeSceneId,
          frameCount: state.project.scenes.length,
          selections: state.selections
        })
      };
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Frame picker could not start.", "error");
    }
  }

  init();
})();
