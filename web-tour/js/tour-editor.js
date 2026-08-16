(() => {
  "use strict";

  const api = window.__TOUR_EDITOR_API;
  if (!api) return;

  const endpoint = "__tour-editor";
  const viewParams = new URLSearchParams(window.location.search);
  const workspaceMode = viewParams.get("workspace") === "1";
  const resumeMode = viewParams.get("resume") === "1";
  const stageOrder = ["start", "upload", "rooms", "light", "links", "arrival", "polish", "export"];
  const stageLabels = {
    start: "Start",
    upload: "Photos",
    rooms: "Spaces",
    light: "Look",
    links: "Walking buttons",
    arrival: "First views",
    polish: "Polish",
    export: "Publish"
  };
  const spaceNameTemplates = [
    { label: "Driveway", hint: "подъезд к дому" },
    { label: "Front of house", hint: "фасад и вход" },
    { label: "Entrance hall", hint: "входная зона" },
    { label: "Hallway", hint: "коридор" },
    { label: "Stairs / landing", hint: "лестница и площадка" },
    { label: "Living room", hint: "гостиная" },
    { label: "Kitchen", hint: "кухня" },
    { label: "Dining area", hint: "обеденная зона" },
    { label: "Bedroom", hint: "спальня" },
    { label: "Bathroom", hint: "ванная" },
    { label: "Ensuite", hint: "ванная при спальне" },
    { label: "Utility room", hint: "техническая зона" },
    { label: "Home office", hint: "рабочий кабинет" },
    { label: "Garage", hint: "гараж" },
    { label: "Patio / terrace", hint: "терраса" },
    { label: "Back garden", hint: "задний двор" }
  ];
  const defaultFloorNames = ["First floor", "Second floor", "Third floor", "Fourth floor", "Fifth floor", "Sixth floor", "Seventh floor", "Eighth floor", "Ninth floor", "Tenth floor"];
  const stageStorageKey = "raindigit-tour-studio-stage";
  const restoredStage = window.sessionStorage.getItem(stageStorageKey);
  const hasSessionStage = stageOrder.includes(restoredStage) && restoredStage !== "start";
  const roundCoordinate = (value) => Math.round(value * 10) / 10;
  const hotspotDragStartDistance = 10;
  const studioDefaultHfov = 94;
  const viewerStageSet = new Set(["light", "links", "arrival", "polish"]);
  const state = {
    activeStage: hasSessionStage ? restoredStage : "start",
    selected: null,
    selectedAdjustmentId: null,
    placement: null,
    arrival: null,
    savedAt: null,
    workspaceProject: null,
    archives: [],
    importing: false,
    restoring: false,
    importProgress: { current: 0, total: 0 },
    building: false,
    buildingMode: null,
    buildProgress: { phase: "idle", percent: 0, message: "" },
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
    polishEditing: false,
    addRouteOpen: false,
    placementGuides: {},
    guidePreferences: { visible: true, snapEnabled: true, snapToleranceDeg: 2.2 },
    showOriginalLook: false,
    draftDirty: false,
    draftRevision: 0,
    structureDirty: false,
    initializing: true,
    routeReferenceMigrated: false,
    viewportSettling: false,
    viewerSettled: false,
    roomPlanTargetId: null,
    roomPlanTargetAction: null,
    statusMessage: "Loading project",
    saveStatus: { phase: "idle", message: "Not saved yet" },
    draftRetryAttempts: 0,
    structureRetryAttempts: 0
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
            <strong id="editorNewProjectHeading">New tour</strong>
            <p class="editor-start-copy" id="editorNewProjectHelp">Create one active working tour. Downloads never remove the editable project.</p>
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
          <section class="editor-start-block">
            <strong>Recent archived tours</strong>
            <p class="editor-start-copy">Open a finished editable project without looking for its file.</p>
            <div class="editor-archive-list" id="editorArchiveList"></div>
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
        <div class="editor-step-heading"><span>Step 2</span><h2>Set up spaces and walking routes</h2></div>
        <section class="editor-setup-section">
          <div class="editor-setup-section__heading"><span>1</span><div><strong>Spaces</strong><small>Name rooms, floors and outside areas in this tour.</small></div></div>
          <div class="editor-room-count">
            <label class="editor-field editor-field--stacked"><span>Number of spaces</span><input id="editorRoomCount" type="number" min="1" max="100" step="1" value="1" inputmode="numeric" /></label>
            <button class="editor-button" id="editorApplyRoomCount" type="button">Update spaces</button>
            <label class="editor-field editor-field--stacked"><span>Number of floors</span><input id="editorFloorCount" type="number" min="1" max="20" step="1" value="1" inputmode="numeric" /></label>
            <button class="editor-button" id="editorApplyFloorCount" type="button">Update floors</button>
          </div>
          <div class="editor-room-configs">
            <div><strong>Space names</strong><div class="editor-room-list" id="editorRoomList"></div></div>
            <div><strong>Floor names</strong><div class="editor-room-list editor-floor-list" id="editorFloorList"></div></div>
          </div>
        </section>
        <section class="editor-setup-section">
          <div class="editor-setup-section__heading"><span>2</span><div><strong>Photos</strong><small>Drag each photo into its space.</small></div></div>
          <label class="editor-upload-zone editor-upload-zone--compact">
            <strong>Add missing 360 photo</strong>
            <span>Add a forgotten room photo without leaving this setup step.</span>
            <input id="editorRoomImportFiles" type="file" accept="image/jpeg,.jpg,.jpeg" multiple data-return-stage="rooms" />
          </label>
          <div class="editor-room-board" id="editorProjectOrder" aria-label="Photos grouped by space"></div>
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
        <div class="editor-add-route" id="editorAddRoutePanel">
          <button class="editor-button editor-button--wide" id="editorAddRouteToggle" type="button">Add walking button</button>
          <div class="editor-add-route-menu" id="editorAddRouteMenu" hidden>
            <strong>Choose where this photo should go</strong>
            <div class="editor-add-route-options" id="editorAddRouteOptions"></div>
          </div>
        </div>
        <div class="editor-place-at-centre" id="editorPlaceAtCentre" hidden>
          <strong>Put the walking button under the door or camera point.</strong>
          <span>Drag the 360 photo, then save the walking button.</span>
          <button class="editor-button editor-button--primary editor-button--wide" id="editorConfirmCentre" type="button">Save point here</button>
          <details class="editor-disclosure editor-disclosure--compact editor-placement-advanced"><summary>Other actions</summary><button class="editor-button editor-button--wide editor-button--danger" id="editorRemoveMovement" type="button">Remove this walking button</button><button class="editor-button editor-button--wide" id="editorCancelCentre" type="button">Back to rooms setup</button><div class="editor-placement-tools"><button class="editor-button" id="editorInspectSource" type="button">Preview this photo</button><button class="editor-button" id="editorUseRoomHeight" type="button">Align to room height</button><label><input id="editorGuideSnap" type="checkbox" checked /> Keep the same height</label></div><p id="editorGuideReadout"></p></details>
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
      <section class="editor-stage-panel" data-stage-panel="polish">
        <div class="editor-step-heading"><span>Step 6</span><h2>Final view and polish</h2></div>
        <p class="editor-guidance" id="editorPolishHelp"></p>
        <div class="editor-opening-view-card">
          <span>Opening view</span>
          <strong id="editorPolishOpeningTitle">Current photo</strong>
          <p id="editorPolishOpeningHelp">Rotate the camera to the view this photo should open with, then save it.</p>
          <button class="editor-button editor-button--primary editor-button--wide" id="editorPolishSaveView" type="button">Save this photo opening view</button>
        </div>
        <div class="editor-polish-actions" aria-label="Walking button corrections">
          <button class="editor-button" id="editorPolishEditToggle" type="button">Correct walking buttons</button>
          <button class="editor-button" id="editorPolishFocusToggle" type="button">Correct in full final view</button>
        </div>
        <div class="editor-hotspot-list editor-hotspot-list--polish" id="editorPolishHotspotList" aria-label="Walking buttons in this preview"></div>
      </section>
      <section class="editor-stage-panel" data-stage-panel="export">
        <div class="editor-step-heading"><span>Step 7</span><h2>Check and publish</h2></div>
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
          <button class="editor-button editor-button--wide" id="editorOpenPolish" type="button">Polish inside studio</button>
        </details>
        <label class="editor-field editor-field--stacked editor-web-name">
          <span>Tour web name</span>
          <input id="editorReleaseSlug" type="text" inputmode="url" autocomplete="off" maxlength="72" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="editorReleaseSlugHelp" />
          <small id="editorReleaseSlugHelp">Used in the permanent address: raindigit.ie/tours/<b>tour-name</b>/</small>
        </label>
          <button class="editor-button editor-button--primary editor-button--wide" id="editorBuild" type="button">Build the tour</button>
          <div class="editor-build-progress" id="editorBuildProgress" hidden role="status" aria-live="polite">
            <div><span id="editorBuildProgressLabel">Preparing build</span><strong id="editorBuildProgressPercent">0%</strong></div>
            <div class="editor-build-progress__track"><i id="editorBuildProgressBar"></i></div>
          </div>
        <div class="editor-release-actions" id="editorReleaseActions" hidden>
          <div class="editor-publish-card">
            <strong>Optimized website tour is ready</strong>
            <span id="editorMultiresSummary">Versioned tiles, manifest and rollback pointer are included.</span>
            <a class="editor-button editor-button--primary editor-button--wide" id="editorDownloadMultires" download="raindigit-tour-web-package.zip">Download web package</a>
            <a class="editor-button editor-button--wide" id="editorPreviewMultires" target="_blank" rel="noopener">Open optimized preview</a>
          </div>
          <details class="editor-disclosure editor-disclosure--compact">
            <summary>Test on a website</summary>
            <a class="editor-button editor-button--wide" id="editorEmbedTestLink" target="_blank" rel="noopener">Open sample website</a>
          </details>
          <details class="editor-disclosure editor-disclosure--compact">
            <summary>Add it to a website</summary>
            <div class="editor-publish-card">
              <button class="editor-button editor-button--wide" id="editorBuildPortable" type="button">Prepare embed & portable files</button>
              <span id="editorPortableStatus">Optional: prepare these only for another website or offline handover.</span>
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
            <summary>Portable, backup and advanced files</summary>
            <span class="editor-advanced__hint">Use these only when the tour must work outside the Rain Digit website.</span>
            <a class="editor-button editor-button--wide" id="editorDownloadSingle" download="raindigit-360-tour.html">Download portable website file</a>
            <button class="editor-button editor-button--wide" id="editorDownloadDebug" type="button">Download debug bundle</button>
            <button class="editor-button editor-button--wide" id="editorDownloadProject" type="button">Download editable backup</button>
            <a class="editor-button editor-button--wide" id="editorDownloadZip" download="raindigit-360-tour.zip">Download folder package (.zip)</a>
          </details>
          <section class="editor-publish-card editor-publish-card--finish">
            <strong>Finished with this tour?</strong>
            <span>First archive the editable project, then clear this computer for the next tour. Downloading files never deletes your work.</span>
            <button class="editor-button editor-button--wide" id="editorArchiveWorkspace" type="button">Archive and finish tour</button>
          </section>
        </div>
        <p class="editor-empty" id="editorReleaseStatus"></p>
      </section>
    </div>
    <div class="editor-panel__footer">
      <button class="editor-button" id="editorBack" type="button">Back</button>
      <div class="editor-panel__status-group">
        <span class="editor-panel__status" id="editorStatus" role="status">Loading project</span>
        <span class="editor-save-status" id="editorSaveStatus" data-state="idle" role="status"><i aria-hidden="true"></i><span>Not saved yet</span></span>
      </div>
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
      <div class="editor-photo-preview__modes" role="group" aria-label="Preview mode">
        <button class="editor-button editor-button--small is-active" id="editorPreviewFlat" type="button">Photo</button>
        <button class="editor-button editor-button--small" id="editorPreview360" type="button">360 view</button>
      </div>
      <div class="editor-photo-preview__viewport">
        <img id="editorPreviewImage" alt="" />
        <div class="editor-photo-preview__viewer" id="editorPreviewViewer" hidden></div>
      </div>
      <p id="editorPreviewHelp">Use the photo view to compare duplicates, then use 360 view to inspect the room naturally.</p>
    </div>
  `;
  document.body.appendChild(previewDialog);

  const elements = Object.fromEntries([
    "SceneName", "RoomName", "Home", "ProgressLabel", "ProgressCount", "ProgressFill", "ProjectTitle", "NewProjectHeading", "NewProjectHelp", "CreateWorkspace", "ContinueWorkspace", "CurrentProject", "ProjectBackup", "ProjectBackupName", "RestoreProject", "ArchiveList", "ImportFiles", "RoomImportFiles", "ProjectEmpty", "UploadList", "RoomCount", "ApplyRoomCount", "FloorCount", "ApplyFloorCount", "RoomList", "FloorList", "AssignmentStatus", "ProjectOrder", "RoomTaskProgress", "RoomChoices", "PlannedPlaces", "PlaceChoices", "HotspotList", "AddRoutePanel", "AddRouteToggle", "AddRouteMenu", "AddRouteOptions", "ArrivalList", "LinkTaskProgress", "LinkGuidance", "MovementHeading", "PlaceAtCentre", "ConfirmCentre", "RemoveMovement", "CancelCentre", "InspectSource", "UseRoomHeight", "GuideSnap", "GuideReadout", "EditArrival", "SaveArrival", "ArrivalHelp", "DefaultView", "SaveSceneView", "PolishHelp", "PolishOpeningTitle", "PolishOpeningHelp", "PolishEditToggle", "PolishSaveView", "PolishFocusToggle", "PolishHotspotList", "OpenPolish", "ImagePresets", "ImageControls", "ImageWarning", "ToggleOriginal", "ApplyLookRoom", "AdjustmentList", "AdjustmentControls", "AddAdjustment", "ExportSummary", "Readiness", "FloorplanOptions", "MapFile", "MapFileName", "MapEnabled", "MapStatus", "Floorplan", "PreviewOptions", "PreviewOptionsLabel", "PreviewLink", "ReleaseSlug", "Build", "BuildPortable", "PortableStatus", "BuildProgress", "BuildProgressLabel", "BuildProgressPercent", "BuildProgressBar", "ReleaseActions", "MultiresSummary", "DownloadMultires", "PreviewMultires", "EmbedTestLink", "DownloadSingle", "DownloadEmbed", "CopyEmbedBlock", "DownloadProject", "DownloadDebug", "InstallUrl", "EmbedCode", "CopyEmbed", "DownloadZip", "ArchiveWorkspace", "ReleaseStatus", "Back", "Status", "SaveStatus", "Continue"
  ].map((name) => [name, panel.querySelector(`#editor${name}`)]));
  const panelContent = panel.querySelector(".editor-panel__content");
  const previewElements = {
    close: previewDialog.querySelector("#editorPreviewClose"),
    flat: previewDialog.querySelector("#editorPreviewFlat"),
    sphere: previewDialog.querySelector("#editorPreview360"),
    image: previewDialog.querySelector("#editorPreviewImage"),
    viewer: previewDialog.querySelector("#editorPreviewViewer"),
    help: previewDialog.querySelector("#editorPreviewHelp"),
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
  let draftRetryTimer = 0;
  let structureSavePromise = Promise.resolve(true);
  let structureSaveTimer = 0;
  let structureRetryTimer = 0;
  let structureRevision = 0;
  const studioSessionId = window.crypto?.randomUUID?.() || `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let studioLogSequence = 0;
  let studioLogBuffer = [];
  let studioLogTimer = 0;
  let roomPointerDrag = null;
  let suppressRoomPhotoClick = false;
  let floorplanDrag = null;
  let photoPreviewViewer = null;
  let photoPreviewMode = "flat";

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
  previewElements.flat.addEventListener("click", () => setPhotoPreviewMode("flat"));
  previewElements.sphere.addEventListener("click", () => setPhotoPreviewMode("sphere"));
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
      viewportSettling: state.viewportSettling,
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

  function setSaveStatus(phase, message) {
    state.saveStatus = { phase, message };
    elements.SaveStatus.dataset.state = phase;
    elements.SaveStatus.querySelector("span").textContent = message;
    studioLog("save-status", { phase, message });
  }

  function retryDelay(attempt) {
    return Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempt - 1)));
  }

  function scheduleDraftRetry() {
    if (!state.draftDirty || draftRetryTimer || !navigator.onLine) return;
    state.draftRetryAttempts += 1;
    const delay = retryDelay(state.draftRetryAttempts);
    draftRetryTimer = window.setTimeout(() => {
      draftRetryTimer = 0;
      if (state.draftDirty) queueDraftSave("automatic-save-retry");
    }, delay);
    setSaveStatus("error", `Save failed · retrying in ${Math.ceil(delay / 1000)}s`);
  }

  function scheduleStructureRetry() {
    if (!state.structureDirty || structureRetryTimer || !navigator.onLine || !canPersistWorkspaceStructure()) return;
    state.structureRetryAttempts += 1;
    const delay = retryDelay(state.structureRetryAttempts);
    structureRetryTimer = window.setTimeout(() => {
      structureRetryTimer = 0;
      if (state.structureDirty) queueWorkspaceStructureSave("automatic-setup-save-retry", { updateState: false, bumpRevision: false });
    }, delay);
    setSaveStatus("error", `Setup not saved · retrying in ${Math.ceil(delay / 1000)}s`);
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

  function resizeViewerAfterEditorLayoutChange(reason = "editor-layout-change") {
    state.viewportSettling = true;
    window.requestAnimationFrame(() => {
      api.viewer.resize?.();
      window.setTimeout(() => {
        api.viewer.resize?.();
        state.viewportSettling = false;
        state.viewerSettled = Boolean(api.viewer.isLoaded());
        renderStages();
        studioLog("editor-layout-resized-viewer", {
          reason,
          editorOpen: document.body.classList.contains("is-editor-open")
        }, true);
      }, 220);
    });
  }

  function resizeViewerForStage(reason = "stage-viewer-layout") {
    if (!viewerStageSet.has(state.activeStage)) return;
    resizeViewerAfterEditorLayoutChange(reason);
  }

  function setEditorOpen(open, reason = "editor-toggle") {
    document.body.classList.toggle("is-editor-open", open);
    editorToggle.setAttribute("aria-label", open ? "Hide tour studio" : "Show tour studio");
    editorToggle.title = editorToggle.getAttribute("aria-label");
    resizeViewerAfterEditorLayoutChange(reason);
  }

  function slugifyTourTitle(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .replace(/-+$/g, "") || "new-tour";
  }

  function workspaceEditorUrl(resume = false) {
    return `${window.location.pathname}?edit=1&workspace=1${resume ? "&resume=1" : ""}`;
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

  function resolveHotspotIndex(sceneId, reference = {}) {
    const scene = api.sceneById[sceneId];
    if (!scene) return -1;
    if (reference.target) {
      const targetIndex = scene.hotspots.findIndex((hotspot) => hotspot.target === reference.target);
      if (targetIndex >= 0) return targetIndex;
    }
    const fallbackIndex = Number(reference.hotspotIndex);
    return Number.isInteger(fallbackIndex) && scene.hotspots[fallbackIndex] ? fallbackIndex : -1;
  }

  function hotspotReference(sceneId, hotspotIndex) {
    const scene = api.sceneById[sceneId];
    const hotspot = scene?.hotspots[hotspotIndex];
    return hotspot ? { sceneId, hotspotIndex, target: hotspot.target } : null;
  }

  function selectHotspot(sceneId, hotspotIndex) {
    state.selected = hotspotReference(sceneId, hotspotIndex);
    return state.selected;
  }

  function sameHotspotReference(left, right) {
    if (!left || !right || left.sceneId !== right.sceneId) return false;
    if (left.target && right.target) return left.target === right.target;
    return left.hotspotIndex === right.hotspotIndex;
  }

  function selectedHotspot() {
    if (!state.selected) return null;
    const hotspotIndex = resolveHotspotIndex(state.selected.sceneId, state.selected);
    if (hotspotIndex < 0) return null;
    const scene = api.sceneById[state.selected.sceneId];
    const hotspot = scene?.hotspots[hotspotIndex];
    if (!hotspot) return null;
    if (state.selected.hotspotIndex !== hotspotIndex || state.selected.target !== hotspot.target) {
      state.selected = { sceneId: scene.id, hotspotIndex, target: hotspot.target };
    }
    return { scene, hotspot, hotspotIndex };
  }

  function lookAtSelectedMovement(reason = "movement-focused") {
    const selected = selectedHotspot();
    if (!selected || api.viewer.getScene() !== selected.scene.id || !api.viewer.isLoaded()) return false;
    const hfov = studioDefaultHfov;
    api.viewer.lookAt(selected.hotspot.pitch, selected.hotspot.yaw, hfov, 0);
    studioLog(reason, {
      sceneId: selected.scene.id,
      target: selected.hotspot.target,
      hotspotIndex: selected.hotspotIndex,
      pitch: roundCoordinate(selected.hotspot.pitch),
      yaw: roundCoordinate(selected.hotspot.yaw),
      hfov: roundCoordinate(hfov)
    }, true);
    return true;
  }

  function rerenderRoomsPanelPreservingScroll() {
    const scroll = {
      top: panelContent.scrollTop,
      projectOrderLeft: elements.ProjectOrder?.scrollLeft || 0,
      roomChoicesLeft: elements.RoomChoices?.scrollLeft || 0,
      placeChoicesLeft: elements.PlaceChoices?.scrollLeft || 0
    };
    renderRoomsPanel();
    panelContent.scrollTop = scroll.top;
    if (elements.ProjectOrder) elements.ProjectOrder.scrollLeft = scroll.projectOrderLeft;
    if (elements.RoomChoices) elements.RoomChoices.scrollLeft = scroll.roomChoicesLeft;
    if (elements.PlaceChoices) elements.PlaceChoices.scrollLeft = scroll.placeChoicesLeft;
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

  function defaultFloorLabel(index) {
    return defaultFloorNames[index] || `Floor ${index + 1}`;
  }

  function uniqueRoomLabel(project, label, roomId) {
    const trimmed = (label || "").trim();
    if (!project || !trimmed) return trimmed;
    const used = new Set(projectRooms(project)
      .filter((room) => room.id !== roomId)
      .map((room) => room.label.trim().toLowerCase())
      .filter(Boolean));
    if (!used.has(trimmed.toLowerCase())) return trimmed;
    const base = trimmed.replace(/\s+\d+$/u, "").trim() || trimmed;
    let suffix = 2;
    while (used.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
    return `${base} ${suffix}`;
  }

  function isDefaultRoomLabel(room, index) {
    return room.label.trim().toLowerCase() === `room ${index + 1}`.toLowerCase();
  }

  function isDefaultFloorLabel(floor, index) {
    return floor.label.trim().toLowerCase() === defaultFloorLabel(index).toLowerCase();
  }

  function floorMap(project = state.workspaceProject) {
    const floors = new Map();
    for (const floor of project?.floors || []) floors.set(floor.id, { ...floor, scenes: [] });
    for (const scene of project?.scenes || []) {
      const floorId = scene.floor || "floor-1";
      const floorLabel = scene.floorLabel || defaultFloorLabel(0);
      if (!floors.has(floorId)) floors.set(floorId, { id: floorId, label: floorLabel, scenes: [] });
      floors.get(floorId).scenes.push(scene);
    }
    return floors;
  }

  function projectFloors(project = state.workspaceProject) {
    if (!project) return [];
    if (!Array.isArray(project.floors)) {
      project.floors = [...floorMap(project).values()]
        .map(({ id, label }) => ({ id, label }));
    }
    return project.floors;
  }

  function looksLikeAutoSceneTitle(title) {
    return /^View\s+\d+$/i.test(title) || /^.+\s+view\s+\d+$/i.test(title);
  }

  function sceneTitleBase(value) {
    return (value || "")
      .trim()
      .replace(/\s+view\s+\d+$/iu, "")
      .replace(/\s+\d+$/u, "")
      .trim()
      .toLowerCase();
  }

  function looksLikeRoomDerivedSceneTitle(project, scene, title = scene?.title) {
    const titleBase = sceneTitleBase(title);
    const room = projectRooms(project).find((candidate) => candidate.id === scene?.space);
    const roomBase = sceneTitleBase(room?.label || scene?.spaceLabel);
    return Boolean(titleBase && roomBase && titleBase === roomBase);
  }

  function isAutoSceneTitle(scene, project = state.workspaceProject) {
    const title = (scene?.title || "").trim();
    return looksLikeAutoSceneTitle(title)
      || scene?.titleAutoGenerated === true
      || looksLikeRoomDerivedSceneTitle(project, scene, title);
  }

  function refreshAutoSceneTitles(project = state.workspaceProject, roomId = null) {
    if (!project) return false;
    let changed = false;
    for (const room of projectRooms(project)) {
      if (roomId && room.id !== roomId) continue;
      const roomScenes = project.scenes.filter((scene) => scene.space === room.id);
      roomScenes.forEach((scene, index) => {
        if (!isAutoSceneTitle(scene, project)) return;
        const nextTitle = roomScenes.length === 1 ? room.label : `${room.label} view ${index + 1}`;
        if (scene.title !== nextTitle || scene.titleAutoGenerated !== true) changed = true;
        scene.title = nextTitle;
        scene.titleAutoGenerated = true;
      });
    }
    return changed;
  }

  function expectedAutoSceneTitle(project, scene) {
    const roomScenes = project.scenes.filter((candidate) => candidate.space === scene.space);
    const index = roomScenes.findIndex((candidate) => candidate.id === scene.id);
    return roomScenes.length === 1 ? scene.spaceLabel : `${scene.spaceLabel} view ${index + 1}`;
  }

  function syncStructureRevision(project = state.workspaceProject) {
    const value = Number.isSafeInteger(project?.editorStructureRevision) ? project.editorStructureRevision : 0;
    structureRevision = Math.max(structureRevision, value);
  }

  function updateSceneLabelDom(scene) {
    panel.querySelectorAll(`[data-scene-title-for="${scene.id}"]`).forEach((node) => { node.textContent = scene.title; });
    panel.querySelectorAll(`[data-scene-room-for="${scene.id}"]`).forEach((node) => { node.textContent = scene.spaceLabel; });
    panel.querySelectorAll(`[data-scene-floor-for="${scene.id}"]`).forEach((node) => { node.textContent = scene.floorLabel || ""; });
    panel.querySelectorAll(`[data-scene-title-input-for="${scene.id}"]`).forEach((node) => {
      if (document.activeElement !== node) node.value = scene.title;
      node.setAttribute("aria-label", `Name for ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-preview-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Preview ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-source-preview-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Preview source ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-destination-preview-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Preview destination ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-remove-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Remove ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-choose-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Choose routes from ${scene.title}`);
    });
    panel.querySelectorAll(`[data-scene-space-move-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Move ${scene.title} to ${Number(node.dataset.spaceDirection) < 0 ? "previous" : "next"} space`);
    });
    panel.querySelectorAll(`[data-scene-order-move-for="${scene.id}"]`).forEach((node) => {
      node.setAttribute("aria-label", `Move ${scene.title} ${Number(node.dataset.orderDirection) < 0 ? "up" : "down"}`);
    });
  }

  function syncWorkspaceSceneMetadata(reason = "workspace-scene-metadata-sync") {
    if (!workspaceMode || !state.workspaceProject?.scenes?.length) return false;
    let changed = false;
    state.workspaceProject.scenes.forEach((scene) => {
      const runtimeScene = api.sceneById[scene.id];
      if (!runtimeScene) return;
      const title = scene.title.trim();
      const subtitle = scene.subtitle || "";
      if (runtimeScene.title === title && runtimeScene.subtitle === subtitle) return;
      if (api.setSceneMetadata(scene.id, { title, subtitle })) changed = true;
    });
    if (changed) studioLog("workspace-scene-metadata-synchronised", { reason }, true);
    return changed;
  }

  function destroyPhotoPreviewViewer() {
    if (photoPreviewViewer?.destroy) photoPreviewViewer.destroy();
    photoPreviewViewer = null;
    previewElements.viewer.replaceChildren();
  }

  function renderPhotoPreviewMode() {
    const scene = state.workspaceProject?.scenes.find((candidate) => candidate.id === state.previewSceneId);
    if (!scene) return;
    const is360 = photoPreviewMode === "sphere";
    previewElements.flat.classList.toggle("is-active", !is360);
    previewElements.sphere.classList.toggle("is-active", is360);
    previewElements.flat.setAttribute("aria-pressed", String(!is360));
    previewElements.sphere.setAttribute("aria-pressed", String(is360));
    previewElements.image.hidden = is360;
    previewElements.viewer.hidden = !is360;
    previewElements.help.textContent = is360
      ? "Drag inside the 360 view to inspect the room naturally."
      : "Use this full photo view to compare duplicates and choose the clearest camera points.";
    if (!is360) {
      destroyPhotoPreviewViewer();
      return;
    }
    const pannellumApi = window.pannellum || (typeof pannellum !== "undefined" ? pannellum : null);
    if (photoPreviewViewer || typeof pannellumApi?.viewer !== "function") return;
    photoPreviewViewer = pannellumApi.viewer(previewElements.viewer, {
      type: "equirectangular",
      panorama: workspaceAsset(scene.panorama || scene.thumb),
      autoLoad: true,
      showFullscreenCtrl: false,
      showZoomCtrl: false,
      compass: false,
      keyboardZoom: false,
      mouseZoom: false,
      doubleClickZoom: false,
      pitch: scene.pitch,
      yaw: scene.yaw,
      hfov: studioDefaultHfov,
      minHfov: studioDefaultHfov,
      maxHfov: studioDefaultHfov
    });
    studioLog("photo-preview-360-opened", { sceneId: scene.id });
  }

  function setPhotoPreviewMode(mode) {
    photoPreviewMode = mode === "sphere" ? "sphere" : "flat";
    renderPhotoPreviewMode();
  }

  function openPhotoPreview(sceneId, mode = "flat") {
    const scene = state.workspaceProject?.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return;
    state.previewSceneId = scene.id;
    photoPreviewMode = mode === "sphere" ? "sphere" : "flat";
    destroyPhotoPreviewViewer();
    previewElements.title.textContent = scene.title;
    previewElements.room.textContent = scene.spaceLabel || "360 photo";
    previewElements.image.src = workspaceAsset(scene.panorama || scene.thumb);
    previewElements.image.alt = scene.title;
    previewDialog.hidden = false;
    document.body.classList.add("is-photo-preview-open");
    renderPhotoPreviewMode();
    previewElements.close.focus();
    studioLog("photo-preview-opened", { sceneId: scene.id, mode: photoPreviewMode });
  }

  function closePhotoPreview() {
    if (previewDialog.hidden) return;
    previewDialog.hidden = true;
    destroyPhotoPreviewViewer();
    previewElements.image.removeAttribute("src");
    document.body.classList.remove("is-photo-preview-open");
    studioLog("photo-preview-closed", { sceneId: state.previewSceneId });
    state.previewSceneId = null;
  }

  function workspaceAsset(path) {
    return `/${endpoint}/workspace/${path}`;
  }

  function editorAsset(path) {
    if (!path) return "";
    if (/^(?:https?:|data:|blob:|\/)/.test(path)) return path;
    return workspaceAsset(path);
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
    if (stage !== "links") state.addRouteOpen = false;
    if (stage === "rooms" && previousStage === "upload") state.roomPlanSceneId = state.workspaceProject?.scenes?.[0]?.id || null;
    if (stage === "light" && previousStage === "rooms") state.lookSceneIndex = 0;
    if (stage === "links" && previousStage === "light") {
      state.linkSceneIndex = 0;
      state.linkStep = "choose";
    }
    if (stage !== "polish") state.polishEditing = false;
    studioLog("stage-change", { from: previousStage, to: stage }, true);
    render();
    resizeViewerForStage(`stage-${stage}`);
    scheduleUiStateSave(`stage-${stage}`);
  }

  function stageOffset(offset) {
    const index = stageOrder.indexOf(state.activeStage);
    return stageOrder[Math.max(0, Math.min(stageOrder.length - 1, index + offset))];
  }

  function setSelected(sceneId, hotspotIndex, stage = "links") {
    selectHotspot(sceneId, hotspotIndex);
    state.placement = null;
    state.arrival = null;
    studioLog("movement-selected", { ...state.selected, requestedStage: stage }, true);
    setStage(stage);
  }

  function findPendingHotspot(field) {
    for (const scene of api.scenes) {
      const hotspotIndex = scene.hotspots.findIndex((hotspot) => hotspot[field] === false);
      if (hotspotIndex >= 0) return hotspotReference(scene.id, hotspotIndex);
    }
    return null;
  }

  function arrivalTasks() {
    return api.scenes.flatMap((scene) => scene.hotspots.map((hotspot, hotspotIndex) => ({
      scene,
      hotspot,
      hotspotIndex,
      sceneId: scene.id,
      target: hotspot.target
    })));
  }

  function arrivalDestinationTasks() {
    const grouped = new Map();
    for (const task of arrivalTasks()) {
      const group = grouped.get(task.target) || {
        representative: task,
        pendingRepresentative: null,
        incomingCount: 0,
        pendingCount: 0
      };
      group.incomingCount += 1;
      if (task.hotspot.arrivalConfirmed === false) {
        group.pendingCount += 1;
        if (!group.pendingRepresentative) group.pendingRepresentative = task;
      }
      grouped.set(task.target, group);
    }
    return [...grouped.entries()].map(([targetSceneId, group]) => ({
      ...(group.pendingRepresentative || group.representative),
      targetSceneId,
      incomingCount: group.incomingCount,
      pendingCount: group.pendingCount
    }));
  }

  function movementTasks() {
    return api.scenes.flatMap((scene) => scene.hotspots.map((hotspot, hotspotIndex) => ({
      scene,
      hotspot,
      hotspotIndex,
      sceneId: scene.id,
      target: hotspot.target
    })));
  }

  function selectedMovementTaskProgress() {
    const tasks = movementTasks();
    if (!state.selected) return { task: null, index: -1, total: tasks.length, tasks };
    const selected = selectedHotspot();
    const selectedReference = selected ? hotspotReference(selected.scene.id, selected.hotspotIndex) : state.selected;
    const index = tasks.findIndex((task) => sameHotspotReference(task, selectedReference));
    return { task: index >= 0 ? tasks[index] : null, index, total: tasks.length, tasks };
  }

  function focusMovementTask(task, status = "Selected walking button") {
    if (!task) return false;
    const reference = hotspotReference(task.scene.id, task.hotspotIndex);
    if (!reference) return false;
    state.linkStep = task.hotspot.positionConfirmed ? "review" : "place";
    focusHotspotTask(reference, "links", false, true);
    const target = api.sceneById[task.hotspot.target];
    setStatus(`${status}: ${task.scene.title} to ${target?.title || task.hotspot.label}`);
    return true;
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

  function saveDestinationArrivalView(targetSceneId, view) {
    const target = api.sceneById[targetSceneId];
    if (!target || !Number.isFinite(view.pitch) || !Number.isFinite(view.yaw) || !Number.isFinite(view.hfov)) return 0;
    api.setSceneView(targetSceneId, view);
    let updated = 0;
    for (const task of arrivalTasks()) {
      if (task.hotspot.target !== targetSceneId) continue;
      if (!api.updateHotspotArrival(task.scene.id, task.hotspotIndex, view)) continue;
      task.hotspot.arrivalConfirmed = true;
      updated += 1;
    }
    studioLog("destination-arrival-view-saved", {
      targetSceneId,
      targetTitle: target.title,
      incomingRoutes: updated,
      view
    }, true);
    return updated;
  }

  function pendingArrivalTasks() {
    return arrivalDestinationTasks().filter((task) => task.pendingCount > 0);
  }

  function arrivalTaskKey(task) {
    return `target::${task?.targetSceneId || task?.target || task?.hotspot?.target || task?.sceneId || task?.scene?.id || task?.hotspotIndex}`;
  }

  function arrivalTaskFromRef(reference) {
    if (!reference) return null;
    const scene = api.sceneById[reference.sceneId];
    const hotspotIndex = resolveHotspotIndex(reference.sceneId, reference);
    const hotspot = scene?.hotspots[hotspotIndex];
    return hotspot ? { scene, hotspot, hotspotIndex, sceneId: reference.sceneId, target: hotspot.target } : null;
  }

  function resetArrivalQueue() {
    const pending = pendingArrivalTasks();
    state.arrivalQueue = pending.map((task) => hotspotReference(task.scene.id, task.hotspotIndex));
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
      setStage("polish");
      return false;
    }
    focusHotspotTask(next, "arrival");
    setStatus(status);
    return true;
  }

  function selectedArrivalTask() {
    if (!state.selected) {
      const total = state.arrivalQueueTotal || arrivalDestinationTasks().length;
      return { task: null, index: -1, total };
    }
    const tasks = arrivalDestinationTasks();
    const selected = selectedHotspot();
    const selectedReference = selected ? hotspotReference(selected.scene.id, selected.hotspotIndex) : state.selected;
    const selectedTarget = selected?.hotspot?.target || state.selected?.target;
    const task = tasks.find((candidate) => sameHotspotReference(candidate, selectedReference))
      || tasks.find((candidate) => candidate.target === selectedTarget)
      || null;
    const queueIndex = state.arrivalQueue.findIndex((reference) => arrivalTaskKey(reference) === arrivalTaskKey(selectedReference));
    const index = queueIndex >= 0 ? queueIndex : tasks.findIndex((candidate) => candidate.target === selectedTarget);
    const total = state.arrivalQueueTotal || tasks.length;
    return { task, index, total };
  }

  function applyPendingFocus() {
    const focus = state.pendingFocus;
    if (!focus || api.viewer.getScene() !== focus.sceneId) return false;
    const hotspotIndex = resolveHotspotIndex(focus.sceneId, focus);
    if (hotspotIndex < 0) {
      state.pendingFocus = null;
      studioLog("pending-focus-missing-hotspot", focus, true);
      render();
      return false;
    }
    state.pendingFocus = null;
    state.activeStage = focus.stage;
    selectHotspot(focus.sceneId, hotspotIndex);
    state.arrival = null;
    state.placement = focus.place ? { type: "hotspot" } : null;
    const selected = selectedHotspot();
    if (selected && (focus.lookAtHotspot || selected.hotspot.positionConfirmed === false)) {
      lookAtSelectedMovement("pending-movement-focused");
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
    document.body.classList.toggle("is-polish-editing", state.activeStage === "polish" && state.polishEditing);
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
    const movementProgress = state.activeStage === "links" ? selectedMovementTaskProgress() : { index: -1 };
    elements.Back.hidden = ["start", "upload"].includes(state.activeStage);
    elements.Back.textContent = state.activeStage === "links" && movementProgress.index > 0
      ? "Previous walking button"
      : "Back";
    elements.Continue.hidden = ["start", "export"].includes(state.activeStage)
      || (state.activeStage === "links" && readiness.pendingPositions > 0 && !linkReviewReady)
      || (state.activeStage === "arrival" && readiness.pendingArrivals > 0 && !selected);
    const viewerRequired = ["light", "links", "arrival", "polish"].includes(state.activeStage);
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
            : state.activeStage === "polish"
              ? "Publish"
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
      ? `Unfinished tour: ${project.title}. ${project.scenes.length} photo${project.scenes.length === 1 ? "" : "s"}, ${projectRooms(project).length} space${projectRooms(project).length === 1 ? "" : "s"}; saved ${saved}.`
      : "No local tour is open.";
    elements.ContinueWorkspace.disabled = !project;
    elements.ContinueWorkspace.textContent = project ? "Continue unfinished tour" : "Continue current tour";
    elements.NewProjectHeading.textContent = project ? "Start over" : "New tour";
    elements.NewProjectHelp.textContent = project
      ? "This deletes the unfinished working copy and starts a clean tour."
      : "Create one active working tour. Downloads never remove the editable project.";
    elements.CreateWorkspace.textContent = project ? "Start new tour" : "Create new tour";
    elements.ArchiveList.replaceChildren();
    if (!state.archives.length) {
      const empty = document.createElement("span");
      empty.className = "editor-archive-list__empty";
      empty.textContent = "No archived tours yet.";
      elements.ArchiveList.appendChild(empty);
      return;
    }
    state.archives.forEach((archive) => {
      const row = document.createElement("article");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = archive.slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
      const meta = document.createElement("span");
      meta.textContent = `${new Date(archive.updatedAt).toLocaleString()} · ${(archive.size / 1024 / 1024).toFixed(1)} MB`;
      copy.append(title, meta);
      const open = document.createElement("button");
      open.className = "editor-button editor-button--small";
      open.type = "button";
      open.textContent = "Open";
      open.disabled = state.restoring;
      open.addEventListener("click", () => restoreArchivedProject(archive));
      row.append(copy, open);
      elements.ArchiveList.appendChild(row);
    });
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

  function ensureInitialFloor() {
    const project = state.workspaceProject;
    const floors = projectFloors(project);
    if (!project?.scenes?.length || floors.length) return;
    const floor = { id: "floor-1", label: defaultFloorLabel(0) };
    project.floors.push(floor);
    project.scenes.forEach((scene) => {
      scene.floor = floor.id;
      scene.floorLabel = floor.label;
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
      const removed = rooms.slice(count);
      const removedIds = new Set(removed.map((room) => room.id));
      const wouldLoseWork = removed.some((room, offset) =>
        project.scenes.some((scene) => scene.space === room.id) ||
        !isDefaultRoomLabel(room, count + offset)
      );
      if (wouldLoseWork) {
        elements.RoomCount.value = String(rooms.length);
        setStatus("To remove a space, use its × button so photos are moved intentionally.");
        studioLog("room-count-shrink-blocked", { requested: count, current: rooms.length, removedRoomIds: [...removedIds] });
        return;
      }
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
    setStatus(`${count} space${count === 1 ? "" : "s"} ready`);
    studioLog("room-count-changed", { count });
    queueWorkspaceStructureSave("room-count-changed");
    renderRoomsPanel();
  }

  function setFloorCount() {
    const project = state.workspaceProject;
    if (!project) return;
    const count = Math.max(1, Math.min(20, Number.parseInt(elements.FloorCount.value, 10) || 1));
    const floors = projectFloors(project);
    while (floors.length < count) {
      const index = floors.length;
      floors.push({ id: `floor-${Date.now().toString(36)}-${index + 1}`, label: defaultFloorLabel(index) });
    }
    if (floors.length > count) {
      const removed = floors.slice(count);
      const removedIds = new Set(removed.map((floor) => floor.id));
      const wouldLoseWork = removed.some((floor, offset) =>
        project.scenes.some((scene) => scene.floor === floor.id) ||
        !isDefaultFloorLabel(floor, count + offset)
      );
      if (wouldLoseWork) {
        elements.FloorCount.value = String(floors.length);
        setStatus("To remove a floor, use its × button so photos are moved intentionally.");
        studioLog("floor-count-shrink-blocked", { requested: count, current: floors.length, removedFloorIds: [...removedIds] });
        return;
      }
      const kept = floors.slice(0, count);
      const keptIds = new Set(kept.map((floor) => floor.id));
      const fallback = kept[0];
      project.scenes.forEach((scene) => {
        if (keptIds.has(scene.floor)) return;
        scene.floor = fallback.id;
        scene.floorLabel = fallback.label;
      });
      project.floors = kept;
    }
    elements.FloorCount.value = String(count);
    setStatus(`${count} floor${count === 1 ? "" : "s"} ready`);
    studioLog("floor-count-changed", { count });
    queueWorkspaceStructureSave("floor-count-changed");
    renderRoomsPanel();
  }

  function assignSceneToRoom(sceneId, roomId) {
    moveSceneToRoomPosition(sceneId, roomId);
  }

  function assignSceneToFloor(sceneId, floorId) {
    const project = state.workspaceProject;
    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    const floor = projectFloors(project).find((candidate) => candidate.id === floorId);
    if (!scene || !floor) return;
    scene.floor = floor.id;
    scene.floorLabel = floor.label;
    setStatus(`${scene.title} set to ${floor.label}`);
    studioLog("floor-selected", { floorId: floor.id, sceneId: scene.id });
    queueWorkspaceStructureSave("floor-selected");
    renderRoomsPanel();
  }

  function removeRoom(roomId) {
    const project = state.workspaceProject;
    const rooms = projectRooms(project);
    const index = rooms.findIndex((room) => room.id === roomId);
    if (!project || index < 0) return;
    if (rooms.length <= 1) {
      setStatus("Keep at least one space");
      return;
    }
    const removed = rooms[index];
    const fallback = rooms[index - 1] || rooms[index + 1];
    project.rooms = rooms.filter((room) => room.id !== roomId);
    project.scenes.forEach((scene) => {
      if (scene.space !== roomId) return;
      scene.space = fallback.id;
      scene.spaceLabel = fallback.label;
    });
    refreshAutoSceneTitles(project, fallback.id);
    setStatus(`${removed.label} removed. Photos moved to ${fallback.label}`);
    studioLog("room-removed", { roomId, fallbackRoomId: fallback.id });
    queueWorkspaceStructureSave("room-removed");
    renderRoomsPanel();
  }

  function removeFloor(floorId) {
    const project = state.workspaceProject;
    const floors = projectFloors(project);
    const index = floors.findIndex((floor) => floor.id === floorId);
    if (!project || index < 0) return;
    if (floors.length <= 1) {
      setStatus("Keep at least one floor");
      return;
    }
    const removed = floors[index];
    const fallback = floors[index - 1] || floors[index + 1];
    project.floors = floors.filter((floor) => floor.id !== floorId);
    project.scenes.forEach((scene) => {
      if (scene.floor !== floorId) return;
      scene.floor = fallback.id;
      scene.floorLabel = fallback.label;
    });
    setStatus(`${removed.label} removed. Photos moved to ${fallback.label}`);
    studioLog("floor-removed", { floorId, fallbackFloorId: fallback.id });
    queueWorkspaceStructureSave("floor-removed");
    renderRoomsPanel();
  }

  function reorderScenesByRoomOrder(project = state.workspaceProject) {
    if (!project?.scenes?.length) return;
    const roomOrder = new Map(projectRooms(project).map((room, index) => [room.id, index]));
    project.scenes = project.scenes
      .map((scene, index) => ({ scene, index }))
      .sort((left, right) => {
        const leftRoom = roomOrder.get(left.scene.space) ?? Number.MAX_SAFE_INTEGER;
        const rightRoom = roomOrder.get(right.scene.space) ?? Number.MAX_SAFE_INTEGER;
        return leftRoom - rightRoom || left.index - right.index;
      })
      .map(({ scene }) => scene);
  }

  function moveRoomWithinOrder(roomId, direction) {
    const project = state.workspaceProject;
    const rooms = projectRooms(project);
    const index = rooms.findIndex((room) => room.id === roomId);
    if (!project || index < 0 || ![-1, 1].includes(direction)) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rooms.length) return;
    [rooms[index], rooms[targetIndex]] = [rooms[targetIndex], rooms[index]];
    reorderScenesByRoomOrder(project);
    refreshAutoSceneTitles(project);
    const moved = rooms[targetIndex];
    setStatus(`${moved.label} moved ${direction < 0 ? "earlier" : "later"} in the tour`);
    studioLog("room-order-changed", { roomId, direction: direction < 0 ? "earlier" : "later", index: targetIndex });
    queueWorkspaceStructureSave("room-order-changed");
    renderRoomsPanel();
  }

  function moveFloorWithinOrder(floorId, direction) {
    const project = state.workspaceProject;
    const floors = projectFloors(project);
    const index = floors.findIndex((floor) => floor.id === floorId);
    if (!project || index < 0 || ![-1, 1].includes(direction)) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= floors.length) return;
    [floors[index], floors[targetIndex]] = [floors[targetIndex], floors[index]];
    const moved = floors[targetIndex];
    setStatus(`${moved.label} moved ${direction < 0 ? "earlier" : "later"} in the floor list`);
    studioLog("floor-order-changed", { floorId, direction: direction < 0 ? "earlier" : "later", index: targetIndex });
    queueWorkspaceStructureSave("floor-order-changed");
    renderRoomsPanel();
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
    queueWorkspaceStructureSave("room-selected");
    renderRoomsPanel();
  }

  function plannedTargets(scene) {
    if (!Array.isArray(scene.plannedTargets)) scene.plannedTargets = [];
    return scene.plannedTargets;
  }

  function sceneRouteStats(project, scene) {
    if (!project || !scene) return { incoming: 0, outgoing: 0, connected: false };
    const outgoing = plannedTargets(scene).length;
    const incoming = project.scenes.reduce((total, candidate) => total + (plannedTargets(candidate).includes(scene.id) ? 1 : 0), 0);
    return { incoming, outgoing, connected: incoming + outgoing > 0 };
  }

  function routeStatusText(project, scene, { selectedSource = false } = {}) {
    if (selectedSource) return "Selected source";
    const stats = sceneRouteStats(project, scene);
    if (!stats.connected) return "No links yet";
    if (stats.outgoing && stats.incoming) return `${stats.outgoing} out / ${stats.incoming} in`;
    if (stats.outgoing) return `${stats.outgoing} outgoing`;
    return `${stats.incoming} incoming`;
  }

  function sourceRouteStatus(project, scene, selectedSource = false) {
    if (selectedSource) return "Selected source";
    const outgoing = plannedTargets(scene).length;
    return outgoing ? `${outgoing} outgoing` : "No outgoing yet";
  }

  function destinationRouteStatus(project, scene, { currentSource = false, selectedDestination = false, recentAction = null } = {}) {
    if (currentSource) return "Current photo";
    if (selectedDestination) return "Selected destination";
    if (recentAction === "previewed") return "Last previewed";
    if (recentAction === "removed") return "Last changed";
    return routeStatusText(project, scene);
  }

  function roomPlanDestinationGroups(project, source, selectedTargets) {
    const groups = {
      sameSpace: [],
      suggested: [],
      unstarted: [],
      other: []
    };
    project.scenes.forEach((target) => {
      const isCurrentSource = target.id === source.id;
      const selected = selectedTargets.includes(target.id);
      const returnsToSource = plannedTargets(target).includes(source.id);
      const stats = sceneRouteStats(project, target);
      if (target.space === source.space) {
        groups.sameSpace.push(target);
      } else if (isCurrentSource || selected || returnsToSource) {
        groups.suggested.push(target);
      } else if (!stats.connected) {
        groups.unstarted.push(target);
      } else {
        groups.other.push(target);
      }
    });
    return [
      { key: "same-space", title: "Same space", note: "Other camera points in this room stay together.", scenes: groups.sameSpace },
      { key: "suggested", title: "Connected routes", note: "Selected, returning, or likely walking routes.", scenes: groups.suggested },
      { key: "unstarted", title: "Not linked yet", note: "Photos with no walking routes yet.", scenes: groups.unstarted },
      { key: "other", title: "Other photos", note: "Already used elsewhere.", scenes: groups.other }
    ].filter((group) => group.scenes.length);
  }

  function togglePlannedTarget(sourceId, targetId) {
    const source = state.workspaceProject?.scenes.find((scene) => scene.id === sourceId);
    if (!source || source.id === targetId) return;
    const targets = plannedTargets(source);
    const nextSelected = !targets.includes(targetId);
    source.plannedTargets = nextSelected
      ? [...targets, targetId]
      : targets.filter((id) => id !== targetId);
    state.roomPlanTargetId = targetId;
    state.roomPlanTargetAction = nextSelected ? "selected" : "removed";
    setStatus(`${source.plannedTargets.length} walking route${source.plannedTargets.length === 1 ? "" : "s"} selected from ${source.title}`);
    studioLog("planned-place-toggled", { sourceSceneId: sourceId, targetSceneId: targetId, selected: source.plannedTargets.includes(targetId) });
    queueWorkspaceStructureSave("planned-place-toggled");
    rerenderRoomsPanelPreservingScroll();
  }

  function moveSceneWithinRoom(sceneId, direction) {
    const project = state.workspaceProject;
    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    if (!project || !scene || ![-1, 1].includes(direction)) return;
    const roomScenes = project.scenes.filter((candidate) => candidate.space === scene.space);
    const roomIndex = roomScenes.findIndex((candidate) => candidate.id === scene.id);
    const target = roomScenes[roomIndex + direction];
    if (!target) return;
    const sourceIndex = project.scenes.findIndex((candidate) => candidate.id === scene.id);
    const targetIndex = project.scenes.findIndex((candidate) => candidate.id === target.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    [project.scenes[sourceIndex], project.scenes[targetIndex]] = [project.scenes[targetIndex], project.scenes[sourceIndex]];
    refreshAutoSceneTitles(project, scene.space);
    const directionLabel = direction < 0 ? "up" : "down";
    setStatus(`${scene.title} moved ${directionLabel}`);
    studioLog("photo-order-changed", { sceneId: scene.id, direction: directionLabel, spaceId: scene.space });
    queueWorkspaceStructureSave("photo-order-changed");
    renderRoomsPanel();
  }

  function moveSceneToAdjacentRoom(sceneId, direction) {
    const project = state.workspaceProject;
    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    const rooms = projectRooms(project);
    if (!project || !scene || ![-1, 1].includes(direction)) return;
    const roomIndex = rooms.findIndex((room) => room.id === scene.space);
    const targetRoom = rooms[roomIndex + direction];
    if (!targetRoom) return;
    moveSceneToRoomPosition(scene.id, targetRoom.id);
  }

  function renderRoomsPanel() {
    const project = state.workspaceProject;
    elements.RoomList.replaceChildren();
    elements.FloorList.replaceChildren();
    elements.ProjectOrder.replaceChildren();
    elements.RoomChoices.replaceChildren();
    elements.PlaceChoices.replaceChildren();
    elements.PlannedPlaces.replaceChildren();
    if (!project) return;
    ensureInitialRoom();
    ensureInitialFloor();
    const rooms = projectRooms(project);
    const floors = projectFloors(project);
    const roomIds = new Set(rooms.map((room) => room.id));
    const floorIds = new Set(floors.map((floor) => floor.id));
    const fallbackRoom = rooms[0];
    const fallbackFloor = floors[0];
    project.scenes.forEach((scene) => {
      if (!roomIds.has(scene.space)) {
        scene.space = fallbackRoom.id;
        scene.spaceLabel = fallbackRoom.label;
      }
      if (!floorIds.has(scene.floor)) {
        scene.floor = fallbackFloor.id;
        scene.floorLabel = fallbackFloor.label;
      }
      plannedTargets(scene);
    });
    if (refreshAutoSceneTitles(project)) scheduleWorkspaceStructureSave("auto-scene-title-repaired");
    elements.RoomCount.value = String(rooms.length);
    elements.FloorCount.value = String(floors.length);

    for (const [roomIndex, room] of rooms.entries()) {
      const roomScenes = project.scenes.filter((scene) => scene.space === room.id);
      const sequenceLabel = String(roomIndex + 1).padStart(2, "0");
      const field = document.createElement("div");
      field.className = "editor-room-name-card editor-structure-card";
      field.dataset.roomId = room.id;
      field.innerHTML = `<div class="editor-structure-card__meta"><span>${sequenceLabel}</span><div><strong>Space ${sequenceLabel}</strong><small>${roomScenes.length} photo${roomScenes.length === 1 ? "" : "s"}</small></div></div><label class="editor-field editor-field--stacked"><span>Space name</span><input type="text" maxlength="80" autocomplete="off" /></label><label class="editor-field editor-field--stacked"><span>Quick name</span><select></select></label><div class="editor-structure-card__actions"><div class="editor-structure-card__move" aria-label="Space order controls"><span>Order</span><button type="button" data-room-order-direction="-1" aria-label="Move ${room.label} earlier">Earlier</button><button type="button" data-room-order-direction="1" aria-label="Move ${room.label} later">Later</button></div><button class="editor-small-danger editor-small-danger--text" data-room-remove type="button">Remove</button></div>`;
      const input = field.querySelector("input");
      const templateSelect = field.querySelector("select");
      const remove = field.querySelector("[data-room-remove]");
      input.value = room.label;
      input.setAttribute("aria-label", `Name for ${room.label}`);
      templateSelect.setAttribute("aria-label", `Quick name for ${room.label}`);
      templateSelect.add(new Option("Choose a common space", ""));
      spaceNameTemplates.forEach(({ label, hint }) => templateSelect.add(new Option(`${label} - ${hint}`, label)));
      remove.setAttribute("aria-label", `Remove ${room.label}`);
      remove.disabled = rooms.length <= 1;
      field.querySelectorAll("[data-room-order-direction]").forEach((button) => {
        const direction = Number(button.dataset.roomOrderDirection);
        button.disabled = direction < 0 ? roomIndex === 0 : roomIndex === rooms.length - 1;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          moveRoomWithinOrder(room.id, direction);
        });
      });
      const commitRoomName = (rerender) => {
        const nextLabel = uniqueRoomLabel(project, input.value, room.id);
        if (!nextLabel) {
          input.value = room.label;
          setStatus("Every space needs a name");
          return;
        }
        input.value = nextLabel;
        room.label = nextLabel;
        project.scenes.filter((scene) => scene.space === room.id).forEach((scene) => { scene.spaceLabel = nextLabel; });
        refreshAutoSceneTitles(project, room.id);
        studioLog("room-name-edited", { roomId: room.id, label: nextLabel });
        if (rerender) queueWorkspaceStructureSave("room-name-edited");
        else scheduleWorkspaceStructureSave("room-name-edited");
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
      templateSelect.addEventListener("change", () => {
        if (!templateSelect.value) return;
        input.value = templateSelect.value;
        commitRoomName(true);
      });
      remove.addEventListener("click", () => removeRoom(room.id));
      elements.RoomList.appendChild(field);
    }

    for (const [floorIndex, floor] of floors.entries()) {
      const floorScenes = project.scenes.filter((scene) => scene.floor === floor.id);
      const sequenceLabel = String(floorIndex + 1).padStart(2, "0");
      const field = document.createElement("div");
      field.className = "editor-floor-name-card editor-structure-card";
      field.innerHTML = `<div class="editor-structure-card__meta"><span>${sequenceLabel}</span><div><strong>Floor ${sequenceLabel}</strong><small>${floorScenes.length} photo${floorScenes.length === 1 ? "" : "s"}</small></div></div><label class="editor-field editor-field--stacked"><span>Floor name</span><input type="text" maxlength="80" autocomplete="off" /></label><div class="editor-structure-card__actions"><div class="editor-structure-card__move" aria-label="Floor order controls"><span>Order</span><button type="button" data-floor-order-direction="-1" aria-label="Move ${floor.label} earlier">Earlier</button><button type="button" data-floor-order-direction="1" aria-label="Move ${floor.label} later">Later</button></div><button class="editor-small-danger editor-small-danger--text" data-floor-remove type="button">Remove</button></div>`;
      const input = field.querySelector("input");
      const remove = field.querySelector("[data-floor-remove]");
      input.value = floor.label;
      input.setAttribute("aria-label", `Name for ${floor.label}`);
      remove.setAttribute("aria-label", `Remove ${floor.label}`);
      remove.disabled = floors.length <= 1;
      field.querySelectorAll("[data-floor-order-direction]").forEach((button) => {
        const direction = Number(button.dataset.floorOrderDirection);
        button.disabled = direction < 0 ? floorIndex === 0 : floorIndex === floors.length - 1;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          moveFloorWithinOrder(floor.id, direction);
        });
      });
      const commitFloorName = (rerender) => {
        const nextLabel = input.value.trim();
        if (!nextLabel) {
          input.value = floor.label;
          setStatus("Every floor needs a name");
          return;
        }
        floor.label = nextLabel;
        project.scenes.filter((scene) => scene.floor === floor.id).forEach((scene) => { scene.floorLabel = nextLabel; });
        studioLog("floor-name-edited", { floorId: floor.id, label: nextLabel });
        if (rerender) queueWorkspaceStructureSave("floor-name-edited");
        else scheduleWorkspaceStructureSave("floor-name-edited");
        if (rerender) renderRoomsPanel();
        else {
          elements.ProjectOrder.querySelectorAll(".editor-room-photo select").forEach((select) => {
            Array.from(select.options).filter((option) => option.value === floor.id).forEach((option) => { option.textContent = nextLabel; });
          });
          project.scenes.filter((scene) => scene.floor === floor.id).forEach(updateSceneLabelDom);
        }
      };
      input.addEventListener("input", () => commitFloorName(false));
      input.addEventListener("change", () => commitFloorName(true));
      remove.addEventListener("click", () => removeFloor(floor.id));
      elements.FloorList.appendChild(field);
    }

    for (const [roomIndex, room] of rooms.entries()) {
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
      roomScenes.forEach((scene, roomSceneIndex) => {
        const globalSceneIndex = project.scenes.findIndex((candidate) => candidate.id === scene.id);
        const sequenceLabel = String(globalSceneIndex + 1).padStart(2, "0");
        const roomSequenceLabel = String(roomSceneIndex + 1).padStart(2, "0");
        const stats = sceneRouteStats(project, scene);
        const card = document.createElement("article");
        card.className = `editor-room-photo${state.roomPlanSceneId === scene.id ? " is-selected" : ""}${stats.connected ? " is-linked" : " is-unlinked"}`;
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
        card.innerHTML = `<div class="editor-room-photo__topline"><span class="editor-room-photo__sequence">${sequenceLabel}</span><span class="editor-room-photo__context"><strong>${roomSequenceLabel} in space</strong><small data-scene-room-for="${scene.id}"></small></span><span class="editor-room-photo__state"></span></div><div class="editor-room-photo__media"><button type="button" class="editor-room-photo__select"><img alt="" /><span>Choose routes</span><em></em></button><div class="editor-card-actions"><button class="editor-card-preview" type="button">Preview</button><button class="editor-card-remove" type="button">Remove</button></div></div><label class="editor-field editor-field--stacked editor-room-photo__name"><span>Photo name</span><input type="text" maxlength="80" autocomplete="off" /></label><div class="editor-photo-meta-grid"><label class="editor-field editor-field--stacked"><span>Space</span><select></select></label><label class="editor-field editor-field--stacked"><span>Floor</span><select></select></label></div><div class="editor-room-photo__move-controls" aria-label="Photo order controls"><div><span>Order</span><button type="button" data-order-direction="-1" aria-label="Move ${scene.title} up">Earlier</button><button type="button" data-order-direction="1" aria-label="Move ${scene.title} down">Later</button></div><div><span>Space</span><button type="button" data-space-direction="-1" aria-label="Move ${scene.title} to previous space">Prev</button><button type="button" data-space-direction="1" aria-label="Move ${scene.title} to next space">Next</button></div></div>`;
        card.querySelector("img").src = workspaceAsset(scene.thumb);
        const contextRoom = card.querySelector(`[data-scene-room-for="${scene.id}"]`);
        contextRoom.textContent = scene.spaceLabel || room.label;
        const choose = card.querySelector(".editor-room-photo__select");
        const badge = choose.querySelector("em");
        const statusText = routeStatusText(project, scene, { selectedSource: state.roomPlanSceneId === scene.id });
        badge.textContent = state.roomPlanSceneId === scene.id ? "Selected" : "Routes";
        card.querySelector(".editor-room-photo__state").textContent = statusText;
        choose.dataset.sceneChooseFor = scene.id;
        choose.setAttribute("aria-label", `Choose routes from ${scene.title}`);
        choose.draggable = false;
        choose.addEventListener("click", () => {
          if (suppressRoomPhotoClick) return;
          state.roomPlanSceneId = scene.id;
          state.roomPlanTargetId = null;
          state.roomPlanTargetAction = null;
          setStatus(`Choose where people can walk from ${scene.title}`);
          rerenderRoomsPanelPreservingScroll();
        });
        const orderButtons = card.querySelectorAll("[data-order-direction]");
        orderButtons.forEach((button) => {
          button.dataset.sceneOrderMoveFor = scene.id;
          const direction = Number(button.dataset.orderDirection);
          button.disabled = direction < 0 ? roomSceneIndex === 0 : roomSceneIndex === roomScenes.length - 1;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            moveSceneWithinRoom(scene.id, direction);
          });
        });
        const spaceButtons = card.querySelectorAll("[data-space-direction]");
        spaceButtons.forEach((button) => {
          button.dataset.sceneSpaceMoveFor = scene.id;
          const direction = Number(button.dataset.spaceDirection);
          button.disabled = direction < 0 ? roomIndex === 0 : roomIndex === rooms.length - 1;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            moveSceneToAdjacentRoom(scene.id, direction);
          });
        });
        const preview = card.querySelector(".editor-card-preview");
        preview.dataset.scenePreviewFor = scene.id;
        preview.setAttribute("aria-label", `Preview ${scene.title}`);
        preview.addEventListener("click", () => openPhotoPreview(scene.id));
        const remove = card.querySelector(".editor-card-remove");
        remove.dataset.sceneRemoveFor = scene.id;
        remove.setAttribute("aria-label", `Remove ${scene.title}`);
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          removeWorkspaceScene(scene.id, scene.title, "rooms");
        });
        const titleInput = card.querySelector("input");
        titleInput.value = scene.title;
        titleInput.dataset.sceneTitleInputFor = scene.id;
        titleInput.setAttribute("aria-label", `Name for ${scene.title}`);
        titleInput.addEventListener("input", () => {
          scene.title = titleInput.value;
          scene.titleAutoGenerated = false;
          updateSceneLabelDom(scene);
          studioLog("view-name-edited", { sceneId: scene.id });
          scheduleWorkspaceStructureSave("view-name-edited");
        });
        titleInput.addEventListener("change", () => {
          if (!scene.title.trim()) {
            scene.titleAutoGenerated = true;
            refreshAutoSceneTitles(project, scene.space);
            queueWorkspaceStructureSave("view-name-reset");
            renderRoomsPanel();
            return;
          }
          updateSceneLabelDom(scene);
          queueWorkspaceStructureSave("view-name-committed");
        });
        const [roomSelect, floorSelect] = card.querySelectorAll("select");
        roomSelect.setAttribute("aria-label", `Space for ${scene.title}`);
        rooms.forEach((candidate) => roomSelect.add(new Option(candidate.label, candidate.id)));
        roomSelect.value = room.id;
        roomSelect.addEventListener("change", () => assignSceneToRoom(scene.id, roomSelect.value));
        floorSelect.setAttribute("aria-label", `Floor for ${scene.title}`);
        floors.forEach((candidate) => floorSelect.add(new Option(candidate.label, candidate.id)));
        floorSelect.value = scene.floor;
        floorSelect.addEventListener("change", () => assignSceneToFloor(scene.id, floorSelect.value));
        photoList.appendChild(card);
      });
      elements.ProjectOrder.appendChild(column);
    }

    if (!state.roomPlanSceneId || !project.scenes.some((scene) => scene.id === state.roomPlanSceneId)) {
      state.roomPlanSceneId = project.scenes[0]?.id || null;
    }
    project.scenes.forEach((scene) => {
      const stats = sceneRouteStats(project, scene);
      const isSelectedSource = scene.id === state.roomPlanSceneId;
      const sourceReady = plannedTargets(scene).length > 0;
      const card = document.createElement("article");
      card.className = `editor-photo-choice-card${sourceReady ? " is-source-linked" : " is-source-unlinked"}${stats.connected ? " is-linked" : " is-unlinked"}${isSelectedSource ? " is-selected-source" : ""}`;
      const button = document.createElement("button");
      button.className = `editor-photo-choice${isSelectedSource ? " is-selected" : ""}`;
      button.type = "button";
      button.setAttribute("aria-pressed", String(isSelectedSource));
      button.innerHTML = `<img alt="" /><span><strong></strong><small></small></span><i aria-hidden="true"></i>`;
      button.querySelector("img").src = workspaceAsset(scene.thumb);
      const title = button.querySelector("strong");
      title.dataset.sceneTitleFor = scene.id;
      title.textContent = scene.title;
      button.querySelector("small").textContent = sourceRouteStatus(project, scene, isSelectedSource);
      button.querySelector("i").textContent = sourceReady ? "✓" : "!";
      button.addEventListener("click", () => {
        state.roomPlanSceneId = scene.id;
        state.roomPlanTargetId = null;
        state.roomPlanTargetAction = null;
        rerenderRoomsPanelPreservingScroll();
      });
      const preview = document.createElement("button");
      preview.className = "editor-card-preview editor-card-preview--source";
      preview.type = "button";
      preview.textContent = "Preview";
      preview.dataset.sceneSourcePreviewFor = scene.id;
      preview.setAttribute("aria-label", `Preview source ${scene.title}`);
      preview.addEventListener("click", () => openPhotoPreview(scene.id));
      card.append(button, preview);
      elements.RoomChoices.appendChild(card);
    });

    const source = project.scenes.find((scene) => scene.id === state.roomPlanSceneId);
    if (source) {
      const selectedTargets = plannedTargets(source);
      elements.RoomTaskProgress.textContent = `${selectedTargets.length} walking route${selectedTargets.length === 1 ? "" : "s"} from ${source.title}`;
      const appendDestinationCard = (target, groupGrid) => {
        const isCurrentSource = target.id === source.id;
        const selected = selectedTargets.includes(target.id);
        const recentAction = target.id === state.roomPlanTargetId ? state.roomPlanTargetAction : null;
        const isRecentTarget = Boolean(recentAction);
        const stats = sceneRouteStats(project, target);
        const card = document.createElement("article");
        card.className = `editor-place-choice-card${isCurrentSource ? " is-current-source" : ""}${stats.connected ? " is-linked" : " is-unlinked"}${isRecentTarget ? " is-recent-target" : ""}`;
        card.dataset.destinationSceneId = target.id;
        const button = document.createElement("button");
        button.className = `editor-place-choice${selected ? " is-selected" : ""}`;
        button.type = "button";
        button.disabled = isCurrentSource;
        button.setAttribute("aria-pressed", String(selected));
        button.innerHTML = `<img alt="" /><span><strong></strong><small class="editor-place-choice__room"></small><small class="editor-choice-status"></small></span><i aria-hidden="true"></i>`;
        button.querySelector("img").src = workspaceAsset(target.thumb);
        const targetTitle = button.querySelector("strong");
        targetTitle.dataset.sceneTitleFor = target.id;
        targetTitle.textContent = target.title;
        const targetRoom = button.querySelector("small");
        targetRoom.dataset.sceneRoomFor = target.id;
        targetRoom.textContent = [target.spaceLabel, target.floorLabel].filter(Boolean).join(" · ");
        button.querySelector(".editor-choice-status").textContent = destinationRouteStatus(project, target, { currentSource: isCurrentSource, selectedDestination: selected, recentAction });
        button.querySelector("i").textContent = isCurrentSource ? "•" : selected ? "✓" : "+";
        if (!isCurrentSource) button.addEventListener("click", () => togglePlannedTarget(source.id, target.id));
        const preview = document.createElement("button");
        preview.className = "editor-card-preview editor-card-preview--inline";
        preview.type = "button";
        preview.textContent = "Preview";
        preview.dataset.sceneDestinationPreviewFor = target.id;
        preview.setAttribute("aria-label", `Preview destination ${target.title}`);
        preview.addEventListener("click", () => {
          state.roomPlanTargetId = target.id;
          state.roomPlanTargetAction = "previewed";
          rerenderRoomsPanelPreservingScroll();
          openPhotoPreview(target.id);
        });
        card.append(button, preview);
        groupGrid.appendChild(card);
      };
      roomPlanDestinationGroups(project, source, selectedTargets).forEach((group) => {
        const section = document.createElement("section");
        section.className = `editor-place-choice-group editor-place-choice-group--${group.key}`;
        section.innerHTML = `<header><strong></strong><small></small></header><div class="editor-place-choice-group__grid"></div>`;
        section.querySelector("strong").textContent = group.title;
        section.querySelector("small").textContent = group.note;
        const grid = section.querySelector(".editor-place-choice-group__grid");
        group.scenes.forEach((target) => appendDestinationCard(target, grid));
        elements.PlaceChoices.appendChild(section);
      });
      const summary = document.createElement("p");
      summary.textContent = selectedTargets.length
        ? `Walking buttons: ${selectedTargets.map((id) => project.scenes.find((scene) => scene.id === id)?.title).filter(Boolean).join(", ")}`
        : "No walking buttons selected yet.";
      elements.PlannedPlaces.appendChild(summary);
    }
    const totalPlaces = project.scenes.reduce((total, scene) => total + plannedTargets(scene).length, 0);
    const unlinkedScenes = project.scenes.filter((scene) => !sceneRouteStats(project, scene).connected).length;
    elements.AssignmentStatus.textContent = `${project.scenes.length} photos in ${rooms.length} space${rooms.length === 1 ? "" : "s"} across ${floors.length} floor${floors.length === 1 ? "" : "s"}; ${totalPlaces} walking button${totalPlaces === 1 ? "" : "s"}; ${unlinkedScenes ? `${unlinkedScenes} photo${unlinkedScenes === 1 ? "" : "s"} not linked yet` : "all photos linked"}`;
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
    syncStructureRevision();
    return state.workspaceProject;
  }

  async function refreshArchives() {
    try {
      const response = await fetch(studioUrl("project-archives", false), { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not read archived tours (${response.status})`);
      state.archives = (await response.json()).archives || [];
    } catch (error) {
      state.archives = [];
      studioLog("archive-list-failed", { message: error.message });
    }
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
    syncStructureRevision();
    setStatus("Project created");
    window.sessionStorage.setItem(stageStorageKey, "upload");
    window.location.assign(`${window.location.pathname}?edit=1`);
    return state.workspaceProject;
  }

  function workspaceStructurePayload(project = state.workspaceProject) {
    if (!project?.scenes?.length) throw new Error("Add at least one 360 photo first.");
    const rooms = projectRooms(project).filter((room) => room.label.trim());
    if (!rooms.length) throw new Error("Create at least one space.");
    const floors = projectFloors(project).filter((floor) => floor.label.trim());
    if (!floors.length) throw new Error("Create at least one floor.");
    const roomIds = new Set(rooms.map((room) => room.id));
    const floorIds = new Set(floors.map((floor) => floor.id));
    if (project.scenes.some((scene) => !roomIds.has(scene.space))) throw new Error("Choose a space for every photo.");
    if (project.scenes.some((scene) => !floorIds.has(scene.floor))) throw new Error("Choose a floor for every photo.");
    return {
      action: "structure",
      editorStructureRevision: Number.isSafeInteger(project.editorStructureRevision) ? project.editorStructureRevision : structureRevision,
      title: project.title,
      rooms,
      floors,
      firstScene: project.scenes[0]?.id || null,
      sceneIds: project.scenes.map((scene) => scene.id),
      scenes: project.scenes.map((scene) => {
        const { id, title, titleAutoGenerated, subtitle, space, spaceLabel, floor, floorLabel, plannedTargets: targets } = scene;
        const trimmedTitle = title.trim();
        const stillAutoTitle = titleAutoGenerated === true
          || trimmedTitle === expectedAutoSceneTitle(project, scene)
          || looksLikeAutoSceneTitle(trimmedTitle)
          || trimmedTitle === spaceLabel
          || looksLikeRoomDerivedSceneTitle(project, scene, trimmedTitle);
        return {
          id,
          title,
          titleAutoGenerated: stillAutoTitle,
          subtitle,
          space,
          spaceLabel,
          floor,
          floorLabel,
          plannedTargets: Array.isArray(targets) ? targets : []
        };
      })
    };
  }

  async function persistWorkspaceStructure({ updateState = true } = {}) {
    const response = await fetch(studioUrl("workspace-project", false), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workspaceStructurePayload())
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error || `Could not save space structure (${response.status})`);
      error.code = body.code || "";
      throw error;
    }
    const project = body;
    syncStructureRevision(project);
    if (updateState) state.workspaceProject = project;
    return project;
  }

  function canPersistWorkspaceStructure() {
    if (state.initializing || !state.workspaceProject?.scenes?.length) return false;
    try {
      workspaceStructurePayload();
      return true;
    } catch {
      return false;
    }
  }

  function queueWorkspaceStructureSave(reason, options = {}) {
    if (structureSaveTimer) {
      window.clearTimeout(structureSaveTimer);
      structureSaveTimer = 0;
    }
    if (structureRetryTimer) {
      window.clearTimeout(structureRetryTimer);
      structureRetryTimer = 0;
    }
    if (!canPersistWorkspaceStructure()) return structureSavePromise;
    state.structureDirty = true;
    if (options.bumpRevision !== false && state.workspaceProject) {
      structureRevision += 1;
      state.workspaceProject.editorStructureRevision = structureRevision;
    }
    structureSavePromise = structureSavePromise.catch(() => false).then(async () => {
      if (!canPersistWorkspaceStructure()) return false;
      studioLog("structure-save-start", { reason }, true);
      setSaveStatus("saving", "Saving setup…");
      try {
        await persistWorkspaceStructure({ updateState: options.updateState === true });
        state.structureDirty = false;
        state.structureRetryAttempts = 0;
        state.release = { ready: false };
        setSaveStatus("saved", "Saved locally");
        studioLog("structure-save-success", { reason }, true);
        return true;
      } catch (error) {
        state.structureDirty = true;
        setSaveStatus("error", "Space setup not saved");
        setStatus(error.message);
        studioLog("structure-save-failed", { reason, message: error.message }, true);
        if (error.code !== "ESTALE") scheduleStructureRetry();
        return false;
      }
    });
    return structureSavePromise;
  }

  function scheduleWorkspaceStructureSave(reason, delay = 300) {
    if (state.initializing || !state.workspaceProject?.scenes?.length) return;
    structureRevision += 1;
    state.structureDirty = true;
    state.workspaceProject.editorStructureRevision = structureRevision;
    window.clearTimeout(structureSaveTimer);
    structureSaveTimer = window.setTimeout(() => {
      structureSaveTimer = 0;
      queueWorkspaceStructureSave(reason, { updateState: false, bumpRevision: false });
    }, delay);
  }

  async function flushWorkspaceStructureSave(reason = "structure-flush") {
    if (structureSaveTimer) {
      window.clearTimeout(structureSaveTimer);
      structureSaveTimer = 0;
      queueWorkspaceStructureSave(reason, { updateState: false, bumpRevision: false });
    }
    await structureSavePromise;
  }

  async function saveWorkspaceStructure(nextStage = null) {
    const project = state.workspaceProject;
    if (!project?.scenes?.length) throw new Error("Add at least one 360 photo first.");
    await flushWorkspaceStructureSave("structure-before-continue");
    await persistWorkspaceStructure();
    state.structureDirty = false;
    state.structureRetryAttempts = 0;
    setSaveStatus("saved", "Saved locally");
    setStatus("Space structure saved");
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
    if (returnStage === "rooms") {
      try {
        await flushWorkspaceStructureSave("structure-before-photo-remove");
        await persistWorkspaceStructure();
      } catch (error) {
        setStatus(error.message || "Save space names before removing this photo.");
        return;
      }
    }
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
    syncStructureRevision();
    window.sessionStorage.setItem(stageStorageKey, returnStage);
    window.location.assign(body.scenes.length ? workspaceEditorUrl() : `${window.location.pathname}?edit=1`);
  }

  async function importPanoramas(event) {
    const input = event?.currentTarget || elements.ImportFiles;
    const files = [...input.files];
    if (!files.length || !state.workspaceProject) return;
    const invalid = files.find((file) => !/\.jpe?g$/i.test(file.name) && file.type !== "image/jpeg");
    if (invalid) {
      setStatus(`Use ready stitched JPG photos. ${invalid.name} is not supported.`);
      input.value = "";
      return;
    }
    const returnStage = input.dataset.returnStage || state.activeStage || "upload";
    const selectedScene = state.workspaceProject.scenes.find((scene) => scene.id === state.roomPlanSceneId);
    const fallbackRoom = projectRooms(state.workspaceProject)[0] || null;
    const fallbackFloor = projectFloors(state.workspaceProject)[0] || null;
    const targetRoom = returnStage === "rooms" ? selectedScene || fallbackRoom : null;
    const roomLabel = targetRoom?.spaceLabel || targetRoom?.label || "Unassigned";
    const roomId = targetRoom?.space || targetRoom?.id || "room-unassigned";
    const floorLabel = returnStage === "rooms" ? selectedScene?.floorLabel || fallbackFloor?.label || "" : "";
    const floorId = returnStage === "rooms" ? selectedScene?.floor || fallbackFloor?.id || "" : "";
    if (returnStage === "rooms") {
      try {
        await flushWorkspaceStructureSave("structure-before-photo-import");
        await persistWorkspaceStructure();
      } catch (error) {
        setStatus(error.message || "Save space names before adding another photo.");
        input.value = "";
        return;
      }
    }
    state.importing = true;
    state.importProgress = { current: 0, total: files.length };
    renderProjectPanel();
    let imported = 0;
    let lastImportedSceneId = null;
    const failures = [];
    try {
      for (const [index, file] of files.entries()) {
        state.importProgress.current = index + 1;
        renderUploadPanel();
        setStatus(`Preparing ${index + 1} of ${files.length}: ${file.name}`);
        try {
          const response = await fetch(studioUrl("workspace-import", true), {
            method: "POST",
            headers: {
              "content-type": "image/jpeg",
              "x-tour-file-name": encodeURIComponent(file.name),
              "x-tour-room-id": encodeURIComponent(roomId),
              "x-tour-room-label": encodeURIComponent(roomLabel),
              "x-tour-floor-id": encodeURIComponent(floorId),
              "x-tour-floor-label": encodeURIComponent(floorLabel)
            },
            body: file
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || `Import failed (${response.status})`);
          state.workspaceProject = body.project;
          lastImportedSceneId = body.scene?.id || null;
          syncStructureRevision();
          imported += 1;
        } catch (error) {
          failures.push({ name: file.name, message: error.message });
          studioLog("photo-import-failed", { name: file.name, message: error.message }, true);
        }
      }
      const summary = `${imported} photo${imported === 1 ? "" : "s"} added`;
      setStatus(failures.length
        ? `${summary}; ${failures.length} skipped: ${failures.map((failure) => failure.name).slice(0, 3).join(", ")}${failures.length > 3 ? ` and ${failures.length - 3} more` : ""}`
        : summary);
      if (lastImportedSceneId && returnStage === "rooms") window.sessionStorage.setItem("raindigit-tour-room-plan-scene", lastImportedSceneId);
      if (imported > 0) {
        window.sessionStorage.setItem(stageStorageKey, returnStage === "rooms" ? "rooms" : "upload");
        window.location.assign(workspaceEditorUrl());
      } else {
        state.importing = false;
        state.importProgress = { current: 0, total: 0 };
        input.value = "";
        renderProjectPanel();
      }
    } catch (error) {
      setStatus(imported ? `${imported} imported; ${error.message}` : error.message);
      await refreshWorkspaceProject();
      state.importing = false;
      state.importProgress = { current: 0, total: 0 };
      input.value = "";
      renderUploadPanel();
      if (returnStage === "rooms") renderRoomsPanel();
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
      button.className = `editor-hotspot${sameHotspotReference(state.selected, { sceneId: scene.id, hotspotIndex, target: hotspot.target }) ? " is-selected" : ""}`;
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

  function linkSourceScene(scene) {
    const selected = selectedHotspot();
    return selected?.scene || api.scenes[state.linkSceneIndex] || scene;
  }

  function missingRouteTargets(source) {
    if (!source) return [];
    const existingTargets = new Set(source.hotspots.map((hotspot) => hotspot.target));
    return api.scenes.filter((target) => target.id !== source.id && !existingTargets.has(target.id));
  }

  async function addWalkingRouteFromLinks(sourceSceneId, targetSceneId) {
    const source = api.sceneById[sourceSceneId];
    const target = api.sceneById[targetSceneId];
    const projectScene = state.workspaceProject?.scenes.find((scene) => scene.id === sourceSceneId);
    if (!source || !target || !projectScene || source.id === target.id) {
      setStatus("Choose another loaded photo first");
      return;
    }
    const targets = plannedTargets(projectScene);
    if (!targets.includes(target.id)) projectScene.plannedTargets = [...targets, target.id];
    state.addRouteOpen = false;
    await queueWorkspaceStructureSave("walking-button-added-from-placement");
    syncPlannedPlacesToDraft();
    const hotspotIndex = source.hotspots.findIndex((hotspot) => hotspot.target === target.id);
    if (hotspotIndex < 0) {
      setStatus("Could not add this walking button");
      return;
    }
    const sceneIndex = api.scenes.findIndex((scene) => scene.id === source.id);
    if (sceneIndex >= 0) state.linkSceneIndex = sceneIndex;
    selectHotspot(source.id, hotspotIndex);
    state.linkStep = "place";
    state.placement = null;
    state.release = { ready: false };
    studioLog("walking-button-added-from-placement", { sourceSceneId: source.id, targetSceneId: target.id, hotspotIndex }, true);
    queueDraftSave("walking-button-added-from-placement");
    setStatus(`New walking button to ${target.title}. Place it on the photo.`);
    if (api.viewer.getScene() !== source.id) {
      focusHotspotTask(hotspotReference(source.id, hotspotIndex), "links");
    } else {
      render();
    }
  }

  async function removeWalkingRouteFromLinks(sourceSceneId, targetSceneId) {
    const source = api.sceneById[sourceSceneId];
    const target = api.sceneById[targetSceneId];
    const projectScene = state.workspaceProject?.scenes.find((scene) => scene.id === sourceSceneId);
    if (!source || !target || !projectScene) {
      setStatus("Could not remove this walking button");
      studioLog("walking-button-remove-missing", { sourceSceneId, targetSceneId }, true);
      return;
    }
    const targets = plannedTargets(projectScene);
    if (!targets.includes(target.id)) {
      setStatus("This walking button is already removed");
      render();
      return;
    }
    projectScene.plannedTargets = targets.filter((id) => id !== target.id);
    const removedSelected = sameHotspotReference(state.selected, { sceneId: source.id, target: target.id });
    const sceneIndex = api.scenes.findIndex((scene) => scene.id === source.id);
    if (sceneIndex >= 0) state.linkSceneIndex = sceneIndex;
    await queueWorkspaceStructureSave("walking-button-removed-from-placement");
    syncPlannedPlacesToDraft();
    if (removedSelected) {
      const nextHotspot = source.hotspots[0];
      if (nextHotspot) {
        selectHotspot(source.id, 0);
        state.linkStep = nextHotspot.positionConfirmed ? "review" : "place";
      } else {
        state.selected = null;
        state.linkStep = "choose";
      }
      state.pendingFocus = null;
      state.placement = null;
    }
    state.release = { ready: false };
    studioLog("walking-button-removed-from-placement", { sourceSceneId: source.id, targetSceneId: target.id }, true);
    queueDraftSave("walking-button-removed-from-placement");
    setStatus(`Removed walking button to ${target.title}`);
    render();
  }

  function selectMovementTarget(sourceSceneId, targetSceneId, targetStage = state.activeStage === "polish" ? "polish" : "links") {
    const source = api.sceneById[sourceSceneId];
    const hotspotIndex = resolveHotspotIndex(sourceSceneId, { target: targetSceneId });
    const hotspot = source?.hotspots[hotspotIndex];
    const target = hotspot ? api.sceneById[hotspot.target] : null;
    if (!source || !hotspot || hotspotIndex < 0) {
      setStatus("Could not find this walking button");
      studioLog("movement-select-missing", { sourceSceneId, targetSceneId }, true);
      return;
    }
    state.pendingFocus = null;
    selectHotspot(source.id, hotspotIndex);
    state.linkStep = hotspot.positionConfirmed ? "review" : "place";
    if (api.viewer.getScene() !== source.id) {
      state.pendingFocus = { ...state.selected, stage: targetStage, place: false, lookAtHotspot: true };
      api.viewer.loadScene(source.id);
      setStatus(`Opening ${source.title}...`);
      render();
      return;
    }
    lookAtSelectedMovement("movement-row-focused");
    if (hotspot.positionConfirmed) {
      setStatus(`Selected ${target?.title || "this place"}. Drag the walking person only if it needs to move.`);
    } else {
      setStatus(`Place the walking button for ${target?.title || "this place"}`);
    }
    render();
  }

  async function saveCurrentPolishView() {
    const scene = currentScene();
    if (!scene || !api.viewer.isLoaded()) return;
    const view = {
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      hfov: roundCoordinate(api.viewer.getHfov())
    };
    api.setSceneView(scene.id, view);
    const updated = saveDestinationArrivalView(scene.id, view);
    await queueDraftSave("polish-opening-view-saved");
    setStatus(updated
      ? `Saved opening view for ${scene.title} and ${updated} incoming route${updated === 1 ? "" : "s"}`
      : `Saved opening view for ${scene.title}`);
    studioLog("polish-opening-view-saved", { sceneId: scene.id, updatedIncomingRoutes: updated, view }, true);
    renderPolishPanel(scene);
  }

  function renderPolishPanel(scene) {
    if (state.activeStage !== "polish") return;
    const selected = selectedHotspot();
    const incomingCount = api.scenes.reduce((total, source) => total + source.hotspots.filter((hotspot) => hotspot.target === scene.id).length, 0);
    elements.PolishOpeningTitle.textContent = scene.title;
    elements.PolishOpeningHelp.textContent = incomingCount
      ? `This is the default camera direction for ${scene.title}. It also updates ${incomingCount} incoming walking route${incomingCount === 1 ? "" : "s"} that arrive here.`
      : `This is the default camera direction for ${scene.title}.`;
    elements.PolishHelp.textContent = state.polishEditing
      ? "Walking-button correction is on. Drag a walking person if its position is wrong. Polish saves the exact cursor position without room-height snapping."
      : "Walk through the tour like a visitor. Rotate the current photo and save its opening view when the first frame is wrong.";
    elements.PolishEditToggle.textContent = state.polishEditing ? "Finish walking-button correction" : "Correct walking buttons";
    elements.PolishEditToggle.classList.toggle("is-active", state.polishEditing);
    elements.PolishSaveView.disabled = !api.viewer.isLoaded() || !state.viewerSettled || state.viewportSettling;
    elements.PolishSaveView.textContent = "Save this photo opening view";
    elements.PolishHotspotList.replaceChildren();
    if (!scene.hotspots.length) {
      const empty = document.createElement("p");
      empty.className = "editor-empty";
      empty.textContent = "This view has no walking buttons.";
      elements.PolishHotspotList.appendChild(empty);
      return;
    }
    scene.hotspots.forEach((hotspot, hotspotIndex) => {
      const target = api.sceneById[hotspot.target];
      const row = document.createElement("button");
      row.type = "button";
      row.className = `editor-polish-row${sameHotspotReference(selected, { sceneId: scene.id, hotspotIndex, target: hotspot.target }) ? " is-selected" : ""}`;
      row.innerHTML = `<span class="editor-polish-row__thumb"><img alt="" loading="lazy" decoding="async" /><i aria-hidden="true">${walkingIconMarkup()}</i></span><span><strong></strong><em></em></span><small></small>`;
      row.querySelector("img").src = editorAsset(target?.thumb || "");
      row.querySelector("strong").textContent = target?.title || hotspot.label;
      row.querySelector("em").textContent = [target?.spaceLabel, target?.floorLabel].filter(Boolean).join(" · ");
      row.querySelector("small").textContent = hotspot.positionConfirmed ? "Ready" : "Needs position";
      row.addEventListener("click", () => {
        state.polishEditing = true;
        selectMovementTarget(scene.id, hotspot.target, "polish");
      });
      elements.PolishHotspotList.appendChild(row);
    });
    window.requestAnimationFrame(() => {
      elements.PolishHotspotList.querySelector(".editor-polish-row.is-selected")?.scrollIntoView({ block: "nearest" });
    });
  }

  function renderAddRoutePicker(source) {
    if (state.activeStage !== "links") return;
    elements.AddRoutePanel.hidden = !source || api.scenes.length <= 1;
    elements.AddRouteMenu.hidden = !state.addRouteOpen;
    elements.AddRouteToggle.setAttribute("aria-expanded", String(state.addRouteOpen));
    elements.AddRouteToggle.textContent = state.addRouteOpen ? "Close add button" : "Add walking button";
    elements.AddRouteOptions.replaceChildren();
    if (!source) return;
    const targets = missingRouteTargets(source);
    if (!targets.length) {
      const empty = document.createElement("p");
      empty.className = "editor-empty";
      empty.textContent = "Every loaded photo is already listed from this photo.";
      elements.AddRouteOptions.appendChild(empty);
      return;
    }
    targets.forEach((target) => {
      const card = document.createElement("div");
      card.className = "editor-add-route-card";
      const button = document.createElement("button");
      button.className = "editor-add-route-option";
      button.type = "button";
      button.dataset.addRouteTarget = target.id;
      button.innerHTML = `<img alt="" /><span><strong></strong><small></small></span><i aria-hidden="true">+</i>`;
      button.querySelector("img").src = editorAsset(target.thumb);
      button.querySelector("strong").textContent = target.title;
      button.querySelector("small").textContent = [target.spaceLabel, target.floorLabel].filter(Boolean).join(" · ");
      button.addEventListener("click", () => addWalkingRouteFromLinks(source.id, target.id));
      const preview = document.createElement("button");
      preview.className = "editor-add-route-preview";
      preview.type = "button";
      preview.textContent = "Preview";
      preview.dataset.addRoutePreviewTarget = target.id;
      preview.setAttribute("aria-label", `Preview ${target.title}`);
      preview.addEventListener("click", () => openPhotoPreview(target.id));
      card.append(button, preview);
      elements.AddRouteOptions.appendChild(card);
    });
  }

  function renderHotspotList(scene) {
    if (state.activeStage !== "links") return;
    const selected = selectedHotspot();
    const source = linkSourceScene(scene);
    const taskProgress = selectedMovementTaskProgress();
    elements.LinkTaskProgress.textContent = taskProgress.index >= 0
      ? `Walking button ${taskProgress.index + 1} of ${taskProgress.total}`
      : `${taskProgress.total} walking button${taskProgress.total === 1 ? "" : "s"} placed`;
    elements.HotspotList.replaceChildren();
    const rows = source.hotspots.map((hotspot, hotspotIndex) => {
      const target = api.sceneById[hotspot.target];
      return {
        sourceId: source.id,
        hotspotIndex,
        targetId: hotspot.target,
        title: target?.title || hotspot.label,
        subtitle: [target?.spaceLabel, target?.floorLabel].filter(Boolean).join(" · "),
        status: hotspot.positionConfirmed ? "Position saved" : "Needs a position",
        thumbnail: editorAsset(target?.thumb || ""),
        selected: sameHotspotReference(state.selected, { sceneId: source.id, hotspotIndex, target: hotspot.target }),
        positioned: hotspot.positionConfirmed === true
      };
    });
    if (window.RainDigitWalkingButtonList?.renderWalkingButtonList) {
      window.RainDigitWalkingButtonList.renderWalkingButtonList(elements.HotspotList, {
        rows,
        onSelect: (row) => selectMovementTarget(row.sourceId, row.targetId),
        onPreview: (row) => openPhotoPreview(row.targetId),
        onRemove: (row) => removeWalkingRouteFromLinks(row.sourceId, row.targetId)
      });
    } else {
      rows.forEach((row) => {
        const button = document.createElement("div");
        button.className = `editor-saved-movement${row.selected ? " is-selected" : ""}${row.positioned ? "" : " is-pending"}`;
        button.tabIndex = 0;
        button.setAttribute("role", "button");
        button.setAttribute("aria-label", `Select movement to ${row.title}`);
        button.dataset.savedMovementSource = row.sourceId;
        button.dataset.savedMovementTarget = row.targetId;
        button.dataset.savedMovementIndex = String(row.hotspotIndex);
        button.innerHTML = `<span class="editor-saved-movement__thumb"><img alt="" loading="lazy" decoding="async" /><i aria-hidden="true">${walkingIconMarkup()}</i></span><span class="editor-saved-movement__copy"><strong></strong><em></em></span><span class="editor-saved-movement__meta"><small></small><span class="editor-saved-movement__actions"><button class="editor-saved-movement__preview" type="button"></button><button class="editor-saved-movement__remove" type="button"></button></span></span>`;
        button.querySelector("img").src = row.thumbnail;
        button.querySelector("strong").textContent = row.title;
        button.querySelector("em").textContent = row.subtitle;
        button.querySelector("small").textContent = row.status;
        const preview = button.querySelector(".editor-saved-movement__preview");
        const remove = button.querySelector(".editor-saved-movement__remove");
        preview.textContent = "Preview";
        preview.setAttribute("aria-label", `Preview ${row.title}`);
        preview.addEventListener("click", (event) => {
          event.stopPropagation();
          openPhotoPreview(row.targetId);
        });
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove walking button to ${row.title}`);
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          removeWalkingRouteFromLinks(row.sourceId, row.targetId);
        });
        button.addEventListener("click", () => selectMovementTarget(row.sourceId, row.targetId));
        button.addEventListener("keydown", (event) => {
          if (!["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          selectMovementTarget(row.sourceId, row.targetId);
        });
        elements.HotspotList.appendChild(button);
      });
    }
    window.requestAnimationFrame(() => {
      elements.HotspotList.querySelector(".editor-saved-movement.is-selected")?.scrollIntoView({ block: "nearest" });
    });
    elements.HotspotList.hidden = source.hotspots.length <= 0;
    renderAddRoutePicker(source);
    const showPlacementPanel = Boolean(selected && ["place", "review"].includes(state.linkStep));
    const viewerReady = Boolean(selected && api.viewer.getScene() === source.id && api.viewer.isLoaded() && state.viewerSettled && !state.viewportSettling);
    elements.PlaceAtCentre.hidden = !showPlacementPanel;
    elements.ConfirmCentre.hidden = true;
    elements.ConfirmCentre.disabled = true;
    elements.RemoveMovement.hidden = !selected;
    elements.RemoveMovement.disabled = !selected;
    const target = selected ? api.sceneById[selected.hotspot.target] : null;
    const guide = guideForScene(source);
    elements.GuideSnap.checked = guide.snapEnabled;
    elements.UseRoomHeight.disabled = !selected || !viewerReady;
    elements.GuideReadout.textContent = `Room guide: ${roundCoordinate(guide.defaultPitch)} degrees. Snap range: ${roundCoordinate(guide.snapToleranceDeg)} degrees. Hold Option while dragging to bypass snap.`;
    if (selected && state.linkStep === "review") {
      elements.PlaceAtCentre.querySelector("strong").textContent = "Check the walking button on the photo.";
      elements.PlaceAtCentre.querySelector("span").textContent = "If it is wrong, drag the walking person on the photo. Then continue.";
      elements.ConfirmCentre.textContent = "Move this button";
      elements.ConfirmCentre.classList.remove("editor-button--primary");
      elements.CancelCentre.textContent = "Back to rooms setup";
      const warnings = placementWarnings(selected.scene, selected.hotspot);
      elements.LinkGuidance.textContent = `Check ${selected.scene.title} to ${target?.title || "the selected place"}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`;
      studioLog("movement-review-shown", { sceneId: selected.scene.id, target: selected.hotspot.target, warnings }, true);
    } else if (selected) {
      elements.PlaceAtCentre.querySelector("strong").textContent = "Drag the walking button to the real place.";
      elements.PlaceAtCentre.querySelector("span").textContent = "Move the walking person onto the doorway or camera point. It saves when you release it.";
      elements.ConfirmCentre.textContent = "Drag the person";
      elements.ConfirmCentre.classList.remove("editor-button--primary");
      elements.CancelCentre.textContent = "Back to rooms setup";
      elements.LinkGuidance.textContent = `From ${selected.scene.title} to ${target?.title || "the selected place"}. Drag the walking person onto the real route, not onto furniture or a wall.`;
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
      elements.ArrivalHelp.textContent = "Every location opening view is saved. Continue to check and publish the tour.";
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
        ? `${progressLabel}: now setting the one opening view for ${target?.title || "this location"}. Rotate to the best view, then press Save first view.`
        : `Loading ${target?.title || "the destination"}...`;
      elements.SaveArrival.disabled = !viewerReady || state.arrivalSaving;
      return;
    }
    const target = api.sceneById[selected.hotspot.target];
    elements.ArrivalHelp.textContent = viewerReady
      ? `${progressLabel}: set one opening view for ${target?.title || "this location"}. It will be reused every time visitors arrive here.`
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
    elements.ExportSummary.innerHTML = `<div><strong>${rooms}</strong><span>Spaces</span></div><div><strong>${api.scenes.length}</strong><span>Views</span></div><div><strong>${transitions}</strong><span>Places</span></div><div><strong>${adjusted}</strong><span>Picture changes</span></div>`;
    const readiness = releaseReadiness();
    elements.Readiness.classList.toggle("is-ready", readiness.ready);
    elements.Readiness.replaceChildren();
    const readinessTitle = document.createElement("strong");
    readinessTitle.textContent = readiness.ready ? "Ready to publish" : "Pre-publish check";
    const readinessList = document.createElement("ul");
    readiness.checks.forEach((check) => {
      const item = document.createElement("li");
      item.classList.toggle("is-ready", check.ready);
      item.innerHTML = `<i aria-hidden="true">${check.ready ? "✓" : "!"}</i><span>${check.label}</span>`;
      readinessList.appendChild(item);
    });
    elements.Readiness.append(readinessTitle, readinessList);
    if (!elements.ReleaseSlug.value) elements.ReleaseSlug.value = state.release.multires?.slug || slugifyTourTitle(state.workspaceProject?.title || api.title);
    const releaseSlug = elements.ReleaseSlug.value.trim();
    const releaseSlugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(releaseSlug) && releaseSlug.length <= 72;
    elements.ReleaseSlug.setAttribute("aria-invalid", String(!releaseSlugValid));
    elements.ReleaseSlug.disabled = state.building || state.release.ready;
    const previewUrl = `${window.location.origin}${window.location.pathname}?preview=1${workspaceMode ? "&workspace=1" : ""}`;
    elements.PreviewLink.href = state.release.multires?.ready ? `${endpoint}/release-multires/${state.release.multires.entrypoint}` : state.release.ready ? `${endpoint}/release/index.html` : previewUrl;
    elements.OpenPolish.hidden = !workspaceMode || !state.workspaceProject?.scenes?.length;
    elements.PreviewOptionsLabel.textContent = state.release.ready ? "View or test the tour" : "Check the tour first";
    elements.PreviewLink.textContent = state.release.ready ? "Open finished tour" : "Open tour preview";
    elements.Build.disabled = !workspaceMode || state.building || !readiness.ready || !releaseSlugValid;
    elements.Build.hidden = state.release.ready;
    elements.Build.textContent = state.building ? state.buildProgress.message || "Building tour..." : "Build the tour";
    elements.BuildProgress.hidden = !state.building;
    elements.BuildProgressLabel.textContent = state.buildProgress.message || "Preparing build";
    elements.BuildProgressPercent.textContent = `${Math.max(0, Math.min(100, state.buildProgress.percent || 0))}%`;
    elements.BuildProgressBar.style.width = `${Math.max(0, Math.min(100, state.buildProgress.percent || 0))}%`;
    elements.ReleaseActions.hidden = !state.release.ready;
    elements.ArchiveWorkspace.disabled = !workspaceMode || state.building || !state.workspaceProject?.scenes?.length;
    elements.PreviewMultires.href = state.release.multires?.ready ? `${endpoint}/release-multires/${state.release.multires.entrypoint}` : "";
    elements.DownloadMultires.href = studioUrl("release-multires-download");
    elements.MultiresSummary.textContent = state.release.multires?.ready
      ? `${state.release.multires.scenes} views · ${state.release.multires.hotspots} walking buttons${state.release.buildDurationMs ? ` · built in ${Math.max(1, Math.round(state.release.buildDurationMs / 1000))}s` : ""} · immutable ${state.release.multires.version}`
      : "Versioned tiles, manifest and rollback pointer are included.";
    elements.BuildPortable.hidden = Boolean(state.release.legacyReady);
    elements.BuildPortable.disabled = !workspaceMode || state.building || !state.release.ready;
    elements.BuildPortable.textContent = state.building && state.buildingMode === "portable"
      ? state.buildProgress.message || "Preparing portable files..."
      : "Prepare embed & portable files";
    elements.PortableStatus.textContent = state.release.legacyReady
      ? "Embed, one-file tour and folder package are ready."
      : "Optional: prepare these only for another website or offline handover.";
    elements.EmbedTestLink.hidden = !state.release.embedReady;
    elements.DownloadEmbed.hidden = !state.release.embedReady;
    elements.CopyEmbedBlock.hidden = !state.release.embedReady;
    elements.DownloadSingle.hidden = !state.release.legacyReady;
    elements.DownloadZip.hidden = !state.release.legacyReady;
    elements.EmbedTestLink.href = `${endpoint}/release-embed-test.html`;
    elements.DownloadSingle.href = studioUrl("release-single-download");
    elements.DownloadEmbed.href = studioUrl("release-embed-download");
    elements.DownloadZip.href = studioUrl("release-download");
    updateEmbedCode();
    renderFloorplanEditor();
    elements.ReleaseStatus.textContent = !workspaceMode
      ? "Create a tour before publishing."
      : state.release.ready
        ? `Optimized web package ready${state.release.multires?.bytes ? ` · ${(state.release.multires.bytes / 1024 / 1024).toFixed(1)} MB` : ""}. Test it before promotion.`
        : releaseSlugValid ? "The tour has not been built yet." : "Use lowercase letters, numbers and hyphens for the tour web name.";
  }

  function invalidateRelease(reason = "draft-changed") {
    if (!state.release.ready && !state.release.multires?.ready) return;
    state.release = { ready: false };
    studioLog("release-invalidated", { reason }, true);
    renderExportPanel();
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
    syncStructureRevision();
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
      syncStructureRevision();
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
    const pendingArrivals = pendingArrivalTasks().length;
    const normalizedTitles = api.scenes.map((scene) => scene.title.trim().toLocaleLowerCase());
    const uniqueTitles = new Set(normalizedTitles).size === normalizedTitles.length;
    const assignmentsReady = api.scenes.every((scene) => scene.title.trim() && scene.space && scene.spaceLabel?.trim() && scene.floor && scene.floorLabel?.trim());
    const firstSceneId = state.workspaceProject?.firstScene || api.scenes[0]?.id;
    const reachable = new Set(firstSceneId ? [firstSceneId] : []);
    const queue = firstSceneId ? [firstSceneId] : [];
    while (queue.length) {
      const scene = api.sceneById[queue.shift()];
      (scene?.hotspots || []).forEach((hotspot) => {
        if (!api.sceneById[hotspot.target] || reachable.has(hotspot.target)) return;
        reachable.add(hotspot.target);
        queue.push(hotspot.target);
      });
    }
    const unreachableScenes = api.scenes.filter((scene) => !reachable.has(scene.id));
    const checks = [
      { key: "photos", ready: api.scenes.length > 0, label: api.scenes.length > 0 ? `${api.scenes.length} panorama${api.scenes.length === 1 ? "" : "s"} included` : "Add at least one panorama" },
      { key: "assignments", ready: assignmentsReady, label: assignmentsReady ? "Every photo has a name, space and floor" : "Name and assign every photo" },
      { key: "unique-titles", ready: uniqueTitles, label: uniqueTitles ? "Photo names are unique" : "Give duplicate photos distinct names" },
      { key: "reachability", ready: unreachableScenes.length === 0, label: unreachableScenes.length === 0 ? "Every photo is reachable from the start" : `Connect ${unreachableScenes.map((scene) => scene.title).slice(0, 3).join(", ")}${unreachableScenes.length > 3 ? ` and ${unreachableScenes.length - 3} more` : ""}` },
      { key: "positions", ready: pendingPositions === 0, label: pendingPositions === 0 ? "Walking buttons are positioned" : `Position ${pendingPositions} walking button${pendingPositions === 1 ? "" : "s"}` },
      { key: "arrivals", ready: pendingArrivals === 0, label: pendingArrivals === 0 ? "First views are set" : `Set ${pendingArrivals} destination view${pendingArrivals === 1 ? "" : "s"}` }
    ];
    return { ready: checks.every((check) => check.ready), pendingPositions, pendingArrivals, unreachableScenes, checks };
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
    if (!workspaceMode || !state.release.embedReady) return;
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

  function watchFinishedExport(kind) {
    if (!workspaceMode || (!state.release.ready && !state.release.legacyReady && !state.release.embedReady)) return;
    studioLog("release-download-started", { kind }, true);
    setStatus("Download started. Your editable project remains safe on this computer.");
  }

  function syncSelectedMarker() {
    const selected = selectedHotspot();
    const activeId = selected ? api.hotspotId(selected.scene.id, selected.hotspotIndex) : "";
    const hideOtherUnplaced = state.activeStage === "links" && selected?.hotspot.positionConfirmed === false;
    viewerElement.querySelectorAll("[data-editor-hotspot-id]").forEach((element) => {
      const isSelected = element.dataset.editorHotspotId === activeId;
      const [sceneId, hotspotIndex] = element.dataset.editorHotspotId.split("::");
      const candidate = api.sceneById[sceneId]?.hotspots[Number(hotspotIndex)];
      element.classList.toggle("is-editor-selected", isSelected);
      element.classList.toggle("is-editor-placement-hidden", Boolean(hideOtherUnplaced && !isSelected && candidate?.positionConfirmed === false));
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
    renderPolishPanel(scene);
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
    const centring = false;
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
    api.updateHotspotCoordinates(selected.scene.id, selected.hotspotIndex, { pitch, yaw });
    const guide = guideForScene(selected.scene);
    if (guide.roomId) state.placementGuides[guide.roomId] = { ...guide, defaultPitch: pitch };
    studioLog(reason, {
      id: api.hotspotId(selected.scene.id, selected.hotspotIndex),
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
    const allowPitchSnap = state.activeStage === "links" && !event.altKey;
    const coordinates = { pitch: roundCoordinate(snappedPitch(scene, pointerPitch, allowPitchSnap)), yaw: roundCoordinate(yaw) };
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
    let [sceneId, hotspotIndex] = marker.dataset.editorHotspotId.split("::");
    let index = Number(hotspotIndex);
    const selected = selectedHotspot();
    if (state.activeStage === "links" && selected?.hotspot.positionConfirmed === false && selected.scene.id === api.viewer.getScene()) {
      sceneId = selected.scene.id;
      index = selected.hotspotIndex;
    }
    if (!["links", "polish"].includes(state.activeStage) || api.viewer.getScene() !== sceneId) {
      setSelected(sceneId, index, state.activeStage === "arrival" ? "arrival" : state.activeStage === "polish" ? "polish" : "links");
      return true;
    }
    selectHotspot(sceneId, index);
    state.linkStep = api.sceneById[sceneId]?.hotspots[index]?.positionConfirmed ? "review" : "place";
    state.placement = null;
    hotspotDrag = {
      pointerId: event.pointerId ?? "mouse",
      sceneId,
      hotspotIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      dragLogged: false
    };
    marker.setPointerCapture?.(event.pointerId);
    studioLog("movement-marker-selected", {
      sceneId,
      hotspotIndex: index,
      target: api.sceneById[sceneId]?.hotspots[index]?.target || null
    }, true);
    render();
    return true;
  }

  function updateHotspotDrag(event) {
    if (!hotspotDrag) return false;
    if (event.pointerId !== undefined && hotspotDrag.pointerId !== event.pointerId) return false;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    if (!hotspotDrag.moved && Math.hypot(event.clientX - hotspotDrag.startX, event.clientY - hotspotDrag.startY) > hotspotDragStartDistance) hotspotDrag.moved = true;
    if (!hotspotDrag.moved) return true;
    if (!hotspotDrag.dragLogged) {
      hotspotDrag.dragLogged = true;
      logOperatorStep("point-drag-start", { hotspotId: api.hotspotId(hotspotDrag.sceneId, hotspotDrag.hotspotIndex) });
    }
    if (moveHotspotToPointer(hotspotDrag.sceneId, hotspotDrag.hotspotIndex, event, "movement-drag-update")) {
      selectHotspot(hotspotDrag.sceneId, hotspotDrag.hotspotIndex);
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
    } else {
      const selected = selectedHotspot();
      setStatus(`Selected ${api.sceneById[selected?.hotspot.target]?.title || "this walking button"}. Drag it only if it needs to move.`);
      render();
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
      editorDraftRevision: state.draftRevision,
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
        selected: selectedHotspot() ? { ...state.selected } : null,
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
    if (workspaceMode) {
      syncWorkspaceSceneMetadata("draft-scene-metadata-skipped");
    } else {
      Object.entries(draft.sceneMetadata || {}).forEach(([sceneId, metadata]) => api.setSceneMetadata(sceneId, metadata));
    }
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
      if (draft.uiState?.selected && typeof draft.uiState.selected.sceneId === "string") {
        const hotspotIndex = resolveHotspotIndex(draft.uiState.selected.sceneId, draft.uiState.selected);
        if (hotspotIndex >= 0) {
          selectHotspot(draft.uiState.selected.sceneId, hotspotIndex);
          if (draft.uiState.selected.target !== state.selected?.target) state.routeReferenceMigrated = true;
        }
      }
      studioLog("ui-state-restored", { stage: state.activeStage, selected: state.selected }, true);
    }
    state.savedAt = draft.updatedAt || null;
    state.draftRevision = Number.isSafeInteger(draft.editorDraftRevision) ? draft.editorDraftRevision : 0;
    setSaveStatus(state.savedAt ? "saved" : "idle", state.savedAt ? "Saved locally" : "Not saved yet");
  }

  async function saveDraft(reason = "manual") {
    const draft = createDraft();
    const hotspotCounts = Object.fromEntries(api.scenes.map((scene) => [scene.id, scene.hotspots.length]));
    studioLog("draft-save-start", { reason, updatedAt: draft.updatedAt, hotspotCounts }, true);
    setSaveStatus("saving", "Saving…");
    try {
      const response = await fetch(studioUrl("save"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      const body = await response.json();
      if (!response.ok) {
        const error = new Error(body.error || `Save failed (${response.status})`);
        error.code = body.code || "";
        throw error;
      }
      state.savedAt = draft.updatedAt;
      state.draftRevision = Number.isSafeInteger(body.editorDraftRevision) ? body.editorDraftRevision : state.draftRevision + 1;
      state.draftDirty = false;
      state.draftRetryAttempts = 0;
      // The server compares only release-relevant data. A UI-state autosave
      // therefore preserves a valid build, while a real tour edit invalidates it.
      state.release = body.release || { ready: false };
      setSaveStatus("saved", "Saved locally");
      renderExportPanel();
      studioLog("draft-save-success", { reason, updatedAt: draft.updatedAt, hotspotCounts }, true);
      return true;
    } catch (error) {
      state.draftDirty = true;
      setSaveStatus("error", "Save failed");
      setStatus(error.message);
      studioLog("draft-save-failed", { reason, message: error.message, hotspotCounts }, true);
      if (error.code !== "ESTALE") scheduleDraftRetry();
      return false;
    }
  }

  function queueDraftSave(reason) {
    state.draftDirty = true;
    invalidateRelease(reason);
    if (draftSaveTimer) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = 0;
    }
    if (draftRetryTimer) {
      window.clearTimeout(draftRetryTimer);
      draftRetryTimer = 0;
    }
    draftSavePromise = draftSavePromise.catch(() => false).then(() => saveDraft(reason));
    return draftSavePromise;
  }

  function flushDraftSave(reason = "before-preview") {
    if (draftSaveTimer) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = 0;
      return queueDraftSave(reason);
    }
    if (state.draftDirty) return queueDraftSave(reason);
    return draftSavePromise.catch(() => false);
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
    const floors = projectFloors(project);
    const roomIds = new Set(rooms.map((room) => room.id));
    const floorIds = new Set(floors.map((floor) => floor.id));
    const unnamedRoom = rooms.find((room) => !room.label.trim());
    if (unnamedRoom) {
      setStatus("Name every space before continuing");
      return false;
    }
    const unnamedFloor = floors.find((floor) => !floor.label.trim());
    if (unnamedFloor) {
      setStatus("Name every floor before continuing");
      return false;
    }
    const incompleteScene = project.scenes.find((scene) => !scene.title.trim() || !roomIds.has(scene.space) || !floorIds.has(scene.floor));
    if (incompleteScene) {
      setStatus(!incompleteScene.title.trim() ? "Name every photo before continuing" : "Choose a space and floor for every photo");
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
      floors: floors.length,
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
      const progress = selectedMovementTaskProgress();
      if (progress.index > 0) {
        if (!await queueDraftSave("walking-button-back-step")) return;
        focusMovementTask(progress.tasks[progress.index - 1], "Back to previous walking button");
        studioLog("walking-button-back-step", {
          fromIndex: progress.index,
          toIndex: progress.index - 1,
          total: progress.total
        }, true);
        return;
      }
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
      const nextArrival = pendingArrivalTasks()[0];
      if (nextArrival) {
        resetArrivalQueue();
        focusNextArrivalTask("Open the destination and choose its first view");
      } else {
        setStage("polish");
      }
      return;
    }
    const readiness = releaseReadiness();
    if (state.activeStage === "arrival" && readiness.pendingArrivals > 0) {
      if (state.arrival) await saveArrivalView();
      else await beginArrivalEdit();
      return;
    }
    if (state.activeStage === "polish") {
      if (await queueDraftSave("polish-complete")) setStage("export");
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
    if (!sameHotspotReference(state.selected, selection)) {
      state.arrivalLoading = false;
      return;
    }
    state.arrival = selectedHotspot() ? { ...state.selected } : null;
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
    const targetSceneId = selected?.hotspot?.target;
    const view = {
      pitch: roundCoordinate(api.viewer.getPitch()),
      yaw: roundCoordinate(api.viewer.getYaw()),
      hfov: roundCoordinate(api.viewer.getHfov())
    };
    const updated = saveDestinationArrivalView(targetSceneId, view);
    if (!updated) {
      state.arrivalSaving = false;
      setStatus("Could not save this first view");
      renderArrivalPanel(currentScene());
      return;
    }
    state.arrival = null;
    if (!await queueDraftSave("destination-arrival-view-saved")) {
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

  async function refreshBuildProgress() {
    if (!workspaceMode || !state.building) return;
    try {
      const response = await fetch(studioUrl("release-build-status"), { cache: "no-store" });
      if (!response.ok) return;
      state.buildProgress = await response.json();
      renderExportPanel();
    } catch {
      // The build request remains authoritative; a missed progress sample is harmless.
    }
  }

  async function buildReleaseTarget(mode = "web") {
    if (!workspaceMode || state.building) return;
    const portable = mode === "portable";
    // Lock the action before the pre-build save starts. Without this guard a
    // second click can start while autosave is still being flushed.
    state.building = true;
    state.buildingMode = mode;
    state.buildProgress = { phase: "saving", percent: 1, message: "Saving latest changes" };
    renderExportPanel();
    await flushWorkspaceStructureSave("structure-before-build");
    if (state.structureDirty) {
      setStatus("Save the space setup before building the tour.");
      state.building = false;
      state.buildingMode = null;
      renderExportPanel();
      return;
    }
    if (!await queueDraftSave("before-build")) {
      state.building = false;
      state.buildingMode = null;
      renderExportPanel();
      return;
    }
    state.buildProgress = { phase: "starting", percent: 2, message: portable ? "Preparing portable files" : "Preparing build" };
    setStatus(portable ? "Preparing optional portable files..." : "Building optimized website tour...");
    renderExportPanel();
    await refreshBuildProgress();
    const progressTimer = window.setInterval(refreshBuildProgress, 650);
    try {
      const response = await fetch(studioUrl(portable ? "build-portable-release" : "build-release"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(portable ? {} : { slug: elements.ReleaseSlug.value.trim() })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Build failed (${response.status})`);
      state.release = { ...state.release, ...body, buildDurationMs: body.buildDurationMs ?? state.release.buildDurationMs };
      state.buildProgress = { phase: "complete", percent: 100, message: portable ? "Portable files ready" : "Tour ready" };
      setStatus(portable ? "Portable and embed files ready" : "Optimized website tour ready");
    } catch (error) {
      state.buildProgress = { phase: "failed", percent: state.buildProgress.percent || 0, message: "Build failed" };
      setStatus(error.message);
    } finally {
      window.clearInterval(progressTimer);
      state.building = false;
      state.buildingMode = null;
      renderExportPanel();
    }
  }

  async function buildRelease() {
    return buildReleaseTarget("web");
  }

  async function buildPortableRelease() {
    if (!state.release.ready) {
      setStatus("Build the optimized website tour first.");
      return;
    }
    return buildReleaseTarget("portable");
  }

  async function archiveAndFinishTour() {
    if (!workspaceMode || !state.workspaceProject?.scenes?.length || state.building) return;
    const title = state.workspaceProject.title || "this tour";
    if (!window.confirm(`Archive the editable project for “${title}”, then clear the studio for the next tour?`)) return;
    await flushWorkspaceStructureSave("structure-before-archive");
    if (state.structureDirty || !await flushDraftSave("before-archive")) {
      setStatus("The tour could not be safely saved. Fix the save error before archiving.");
      return;
    }
    elements.ArchiveWorkspace.disabled = true;
    setStatus("Archiving editable project...");
    try {
      const response = await fetch(studioUrl("archive-workspace"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not archive project (${response.status})`);
      studioLog("workspace-archived-and-cleared", body, true);
      state.workspaceProject = null;
      state.release = { ready: false };
      state.savedAt = null;
      state.draftDirty = false;
      setSaveStatus("idle", "No active tour");
      window.sessionStorage.removeItem(stageStorageKey);
      state.activeStage = "start";
      setStatus(`Archived as ${body.fileName}. Ready for the next tour.`);
      await refreshArchives();
      render();
    } catch (error) {
      elements.ArchiveWorkspace.disabled = false;
      setStatus(error.message);
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

  async function restoreArchivedProject(archive) {
    if (!archive?.id || state.restoring) return;
    const replace = Boolean(state.workspaceProject);
    if (replace && !window.confirm("Replace the current local project with this archived tour?")) return;
    state.restoring = true;
    renderStartPanel();
    setStatus(`Opening archived tour ${archive.slug.replace(/-/g, " ")}...`);
    try {
      const response = await fetch(studioUrl("archive-restore", true), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive: archive.id, replace })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not open archived tour (${response.status})`);
      window.sessionStorage.setItem(stageStorageKey, "upload");
      window.location.assign(workspaceEditorUrl());
    } catch (error) {
      state.restoring = false;
      setStatus(error.message);
      renderStartPanel();
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
    const replace = Boolean(state.workspaceProject);
    studioLog(replace ? "project-start-over-requested" : "project-create-requested", { title: elements.ProjectTitle.value });
    try { await createWorkspace(replace); } catch (error) { setStatus(error.message); }
  });
  elements.ContinueWorkspace.addEventListener("click", () => {
    if (!state.workspaceProject) return;
    logOperatorStep("continue-current-tour", { title: state.workspaceProject.title });
    window.sessionStorage.removeItem(stageStorageKey);
    window.location.assign(workspaceEditorUrl(true));
  });
  elements.ProjectBackup.addEventListener("change", () => {
    const file = elements.ProjectBackup.files[0];
    elements.ProjectBackupName.textContent = file?.name || "Choose an editable project file";
    elements.RestoreProject.disabled = !file;
    studioLog("project-file-selected", file ? { name: file.name, size: file.size, type: file.type } : { cleared: true });
  });
  elements.RestoreProject.addEventListener("click", () => restoreProject(false));
  elements.ImportFiles.addEventListener("change", importPanoramas);
  elements.RoomImportFiles.addEventListener("change", importPanoramas);
  elements.ApplyRoomCount.addEventListener("click", setRoomCount);
  elements.ApplyFloorCount.addEventListener("click", setFloorCount);
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
  elements.BuildPortable.addEventListener("click", buildPortableRelease);
  elements.ArchiveWorkspace.addEventListener("click", archiveAndFinishTour);
  elements.PreviewLink.addEventListener("click", async (event) => {
    if (!workspaceMode || (!state.draftDirty && !draftSaveTimer)) return;
    event.preventDefault();
    const opened = window.open("about:blank", "_blank", "noopener");
    setStatus("Saving latest changes before preview...");
    const saved = await flushDraftSave("before-preview");
    if (!saved) {
      opened?.close?.();
      return;
    }
    renderExportPanel();
    const previewUrl = elements.PreviewLink.href;
    if (opened) opened.location.href = previewUrl;
    else window.open(previewUrl, "_blank", "noopener");
  });
  elements.ReleaseSlug.addEventListener("input", renderExportPanel);
  elements.ReleaseSlug.addEventListener("blur", () => {
    elements.ReleaseSlug.value = slugifyTourTitle(elements.ReleaseSlug.value);
    renderExportPanel();
  });
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
  elements.DownloadSingle.addEventListener("click", () => watchFinishedExport("single-html"));
  elements.DownloadMultires.addEventListener("click", () => watchFinishedExport("multires-web-package"));
  elements.DownloadEmbed.addEventListener("click", () => watchFinishedExport("paste-in-html"));
  elements.DownloadZip.addEventListener("click", () => watchFinishedExport("zip"));
  panel.querySelector("#editorClose").addEventListener("click", () => setEditorOpen(false, "editor-close"));
  editorToggle.addEventListener("click", () => {
    setEditorOpen(!document.body.classList.contains("is-editor-open"), "editor-toggle");
  });
  panel.querySelector("#editorPreviousScene").addEventListener("click", () => moveScene(-1));
  panel.querySelector("#editorNextScene").addEventListener("click", () => moveScene(1));
  elements.AddRouteToggle.addEventListener("click", () => {
    state.addRouteOpen = !state.addRouteOpen;
    logOperatorStep(state.addRouteOpen ? "add-walking-button-opened" : "add-walking-button-closed");
    render();
  });
  elements.ConfirmCentre.addEventListener("click", () => {
    const selected = selectedHotspot();
    if (state.activeStage === "links" && state.linkStep === "review" && selected?.hotspot.positionConfirmed) {
      logOperatorStep("adjust-point", {
        hotspotId: api.hotspotId(selected.scene.id, selected.hotspotIndex),
        pitch: selected.hotspot.pitch,
        yaw: selected.hotspot.yaw
      });
      state.linkStep = "review";
      setStatus("Drag the walking person on the photo. It is saved when you release it.");
      render();
      return;
    }
    if (elements.ConfirmCentre.hidden || !saveSelectedHotspotAtViewerCenter()) return;
    logOperatorStep("save-point-here", selected ? {
      hotspotId: api.hotspotId(selected.scene.id, selected.hotspotIndex),
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
    setStatus("Change the space board or selected places");
    setStage("rooms");
  });
  elements.InspectSource.addEventListener("click", () => {
    const selected = selectedHotspot();
    if (selected) openPhotoPreview(selected.scene.id);
  });
  elements.RemoveMovement.addEventListener("click", async () => {
    const selected = selectedHotspot();
    if (!selected) return;
    await removeWalkingRouteFromLinks(selected.scene.id, selected.hotspot.target);
  });
  elements.UseRoomHeight.addEventListener("click", () => {
    const selected = selectedHotspot();
    if (!selected) return;
    const guide = guideForScene(selected.scene);
    api.viewer.lookAt(guide.defaultPitch, api.viewer.getYaw(), api.viewer.getHfov(), 0);
    setStatus("Room height aligned. Check the walking button, then drag it if needed.");
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
  elements.PolishEditToggle.addEventListener("click", () => {
    state.polishEditing = !state.polishEditing;
    state.placement = null;
    setStatus(state.polishEditing ? "Pencil mode on. Drag a walking person to correct it." : "Pencil mode off. You can walk through the tour.");
    studioLog("polish-edit-toggled", { enabled: state.polishEditing }, true);
    render();
  });
  elements.PolishSaveView.addEventListener("click", saveCurrentPolishView);
  elements.PolishFocusToggle.addEventListener("click", () => {
    state.polishEditing = true;
    setStatus("Full final view on. Drag any walking person to correct it; use the round Studio button to bring the panel back.");
    render();
    studioLog("polish-full-view-requested", { sceneId: api.viewer.getScene(), correctionEnabled: true }, true);
    setEditorOpen(false, "polish-full-view");
  });
  elements.OpenPolish.addEventListener("click", () => {
    logOperatorStep("open-polish-from-publish");
    setStage("polish");
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
    if (state.activeStage === "polish" && !state.polishEditing) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginHotspotDrag(event, marker);
    return true;
  }

  viewerElement.addEventListener("pointerdown", handleHotspotDragStart, true);
  viewerElement.addEventListener("mousedown", handleHotspotDragStart, true);
  viewerElement.addEventListener("dblclick", (event) => {
    if (!["links", "polish"].includes(state.activeStage)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    lookAtSelectedMovement("studio-double-click-zoom-blocked");
  }, true);
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
    if (state.activeStage === "polish" && !state.polishEditing) return;
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
    if (state.activeStage === "polish") {
      if (scene?.hotspots.length) selectHotspot(scene.id, 0);
      else state.selected = null;
    } else if (state.activeStage !== "arrival" && !state.arrival) {
      if (!selectedHotspot() && scene?.hotspots.length) selectHotspot(scene.id, 0);
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

  window.addEventListener("beforeunload", (event) => {
    if (!state.draftDirty && !state.structureDirty && !draftSaveTimer && !structureSaveTimer && !draftRetryTimer && !structureRetryTimer) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("offline", () => {
    if (!state.draftDirty && !state.structureDirty) return;
    setSaveStatus("error", "Offline · changes waiting to save");
    setStatus("The studio is offline. Keep this window open; saving resumes automatically when the connection returns.");
    studioLog("studio-offline-with-unsaved-work", { draftDirty: state.draftDirty, structureDirty: state.structureDirty }, true);
  });

  window.addEventListener("online", () => {
    studioLog("studio-online", { draftDirty: state.draftDirty, structureDirty: state.structureDirty }, true);
    if (state.structureDirty && canPersistWorkspaceStructure()) queueWorkspaceStructureSave("connection-restored", { updateState: false, bumpRevision: false });
    if (state.draftDirty) queueDraftSave("connection-restored");
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
    fetch(studioUrl("overrides")).then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not read draft"))),
    refreshArchives()
  ]).then(async ([, , draft]) => {
    await waitForViewerSettled();
    state.viewerSettled = true;
    applyDraft(draft);
    const metadataChanged = syncWorkspaceSceneMetadata("startup");
    if (resumeMode && workspaceMode && state.workspaceProject && state.activeStage === "start") {
      state.activeStage = "upload";
      studioLog("resume-fallback-upload", { projectTitle: state.workspaceProject.title }, true);
    }
    const plannedPlacesChanged = syncPlannedPlacesToDraft();
    const sharedArrivalChanged = propagateArrivalViewsByTarget();
    const selected = selectedHotspot();
    if (state.activeStage === "links" && selected && api.viewer.getScene() !== selected.scene.id) {
      state.pendingFocus = {
        ...state.selected,
        stage: "links",
        place: state.linkStep === "place" && selected.hotspot.positionConfirmed === false,
        lookAtHotspot: false
      };
      api.viewer.loadScene(selected.scene.id);
    } else if (state.activeStage !== "arrival") {
      const scene = currentScene();
      if (!selected && scene?.hotspots.length) selectHotspot(scene.id, 0);
    } else {
      resetArrivalQueue();
      focusNextArrivalTask("Open the destination and choose its first view");
    }
    state.initializing = false;
    const restoredRoomPlanSceneId = window.sessionStorage.getItem("raindigit-tour-room-plan-scene");
    if (restoredRoomPlanSceneId && state.workspaceProject?.scenes?.some((scene) => scene.id === restoredRoomPlanSceneId)) {
      state.roomPlanSceneId = restoredRoomPlanSceneId;
    }
    window.sessionStorage.removeItem("raindigit-tour-room-plan-scene");
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
    resizeViewerForStage(`startup-${state.activeStage}`);
    if (plannedPlacesChanged || sharedArrivalChanged || state.routeReferenceMigrated || metadataChanged) {
      queueDraftSave(sharedArrivalChanged
        ? "shared-arrival-views-applied"
        : plannedPlacesChanged
          ? "planned-places-synchronised"
          : state.routeReferenceMigrated
            ? "ui-state-route-reference-migrated"
            : "workspace-scene-metadata-synchronised");
      state.routeReferenceMigrated = false;
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
