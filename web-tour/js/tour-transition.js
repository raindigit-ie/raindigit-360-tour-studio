(() => {
  "use strict";

  const shell = document.querySelector(".tour-shell");
  if (!shell) return;

  const firstFrame = shell.querySelector(".tour-first-frame");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const columns = 12;
  const rows = 8;
  const sampleSize = 6;
  const cellDuration = reducedMotion ? 120 : 980;
  const settleDuration = reducedMotion ? 120 : 360;
  const sampleInterval = 50;
  let viewer = null;
  let sequence = 0;
  let active = null;
  let lastStableFrame = firstFrame?.currentSrc || firstFrame?.src || "";

  const overlay = document.createElement("div");
  overlay.className = "tour-scene-transition tour-scene-transition--gold-pulse";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="tour-scene-transition__stage">
      <img class="tour-scene-transition__image tour-scene-transition__outgoing" alt="" draggable="false" />
      <div class="tour-scene-transition__tiles" aria-hidden="true"></div>
      <img class="tour-scene-transition__image tour-scene-transition__incoming" alt="" draggable="false" />
    </div>`;
  shell.append(overlay);
  const outgoing = overlay.querySelector(".tour-scene-transition__outgoing");
  const incoming = overlay.querySelector(".tour-scene-transition__incoming");
  const tileLayer = overlay.querySelector(".tour-scene-transition__tiles");
  overlay.style.setProperty("--tour-cell-duration", `${cellDuration}ms`);
  overlay.style.setProperty("--tour-settle-duration", `${settleDuration}ms`);

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function renderViewer() {
    try {
      viewer?.getRenderer?.()?.render?.(
        viewer.getPitch() * Math.PI / 180,
        viewer.getYaw() * Math.PI / 180,
        viewer.getHfov() * Math.PI / 180,
        { roll: 0 }
      );
    } catch {
      // A following sample retries while Pannellum creates the renderer.
    }
  }

  function captureFrame(width = 640, quality = 0.72) {
    const source = [...shell.querySelectorAll(".pnlm-render-container canvas")].at(-1);
    if (!(source instanceof HTMLCanvasElement) || source.width < 8 || source.height < 8) return null;
    try {
      renderViewer();
      const image = document.createElement("canvas");
      image.width = Math.min(width, source.width);
      image.height = Math.max(8, Math.round(image.width * source.height / source.width));
      const imageContext = image.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!imageContext) return null;
      imageContext.drawImage(source, 0, 0, image.width, image.height);

      const sample = document.createElement("canvas");
      sample.width = columns * sampleSize;
      sample.height = rows * sampleSize;
      const context = sample.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      const count = columns * rows;
      const total = new Uint16Array(count);
      const visible = new Uint16Array(count);
      const luma = new Float32Array(count);
      const red = new Uint32Array(count);
      const green = new Uint32Array(count);
      const blue = new Uint32Array(count);
      let visiblePixels = 0;
      let totalLuma = 0;

      for (let offset = 0; offset < pixels.length; offset += 4) {
        const pixel = offset / 4;
        const x = pixel % sample.width;
        const y = Math.floor(pixel / sample.width);
        const cell = Math.floor(y / sampleSize) * columns + Math.floor(x / sampleSize);
        const value = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
        const shown = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 5 ||
          Math.abs(pixels[offset] - pixels[offset + 1]) + Math.abs(pixels[offset + 1] - pixels[offset + 2]) > 5;
        total[cell] += 1;
        if (shown) {
          visible[cell] += 1;
          visiblePixels += 1;
        }
        luma[cell] += value;
        red[cell] += pixels[offset];
        green[cell] += pixels[offset + 1];
        blue[cell] += pixels[offset + 2];
        totalLuma += value;
      }

      return {
        dataUrl: image.toDataURL("image/jpeg", quality),
        visibleRatio: visiblePixels / (pixels.length / 4),
        averageLuma: totalLuma / (pixels.length / 4),
        cells: Array.from({ length: count }, (_, index) => {
          const pixelsInCell = Math.max(1, total[index]);
          return {
            index,
            column: index % columns,
            row: Math.floor(index / columns),
            visibleRatio: visible[index] / pixelsInCell,
            averageLuma: luma[index] / pixelsInCell,
            color: `${Math.round(red[index] / pixelsInCell)} ${Math.round(green[index] / pixelsInCell)} ${Math.round(blue[index] / pixelsInCell)}`
          };
        })
      };
    } catch {
      return null;
    }
  }

  function usable(frame) {
    return Boolean(frame?.dataUrl && frame.visibleRatio >= 0.975 && frame.averageLuma >= 5);
  }

  function clearTiles() {
    tileLayer.replaceChildren();
    overlay.classList.remove("has-tiles");
    overlay.dataset.patchCount = "0";
  }

  function addCell(frame, cell, run) {
    if (run.revealed.has(cell.index)) return false;
    run.revealed.add(cell.index);
    run.patchCount += 1;
    run.firstPatchAt ||= performance.now();
    const tile = document.createElement("span");
    tile.className = "tour-scene-transition__tile";
    tile.style.left = `${cell.column / columns * 100}%`;
    tile.style.top = `${cell.row / rows * 100}%`;
    tile.style.width = `${100 / columns + 0.18}%`;
    tile.style.height = `${100 / rows + 0.18}%`;
    tile.style.backgroundImage = `url(${frame.dataUrl})`;
    tile.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
    tile.style.backgroundPosition = `${cell.column / Math.max(1, columns - 1) * 100}% ${cell.row / Math.max(1, rows - 1) * 100}%`;
    tile.style.setProperty("--tour-cell-color", cell.color);
    tile.style.setProperty("--tour-cell-delay", `${(run.patchCount % 5) * 18}ms`);
    tileLayer.append(tile);
    overlay.classList.add("has-tiles");
    overlay.dataset.patchCount = String(run.patchCount);
    return true;
  }

  function revealAvailableCells(frame, run, includeComplete = false) {
    if (!frame) return;
    for (const cell of frame.cells) {
      if (includeComplete || (cell.visibleRatio >= 0.72 && cell.averageLuma >= 2)) addCell(frame, cell, run);
    }
  }

  function activate(initial, origin = { x: 50, y: 50 }) {
    if (active) return active;
    const baseline = initial
      ? firstFrame?.currentSrc || firstFrame?.src || lastStableFrame
      : captureFrame(960, 0.8)?.dataUrl || lastStableFrame || firstFrame?.currentSrc || firstFrame?.src || "";
    const run = {
      token: ++sequence,
      initial,
      phase: initial ? "initial-loading" : "armed",
      startedAt: performance.now(),
      revealed: new Set(),
      patchCount: 0,
      firstPatchAt: 0,
      sampling: false,
      targetScene: viewer?.getScene?.() || null
    };
    active = run;
    clearTiles();
    shell.classList.add("is-transition-guarded");
    overlay.style.setProperty("--tour-origin-x", `${origin.x}%`);
    overlay.style.setProperty("--tour-origin-y", `${origin.y}%`);
    outgoing.src = baseline;
    incoming.src = baseline;
    overlay.classList.remove("is-active", "is-waiting", "is-revealing", "is-settled");
    void overlay.offsetWidth;
    overlay.classList.add("is-active", "is-waiting");
    overlay.dataset.phase = run.phase;
    document.dispatchEvent(new CustomEvent("raindigit:tour-transition", { detail: { phase: run.phase, initial, token: run.token } }));
    return run;
  }

  async function settle(run, frame) {
    revealAvailableCells(frame, run, true);
    incoming.src = frame.dataUrl;
    lastStableFrame = frame.dataUrl;
    const cellElapsed = run.firstPatchAt ? performance.now() - run.firstPatchAt : 0;
    const minimumCellTime = reducedMotion ? 100 : 520;
    if (cellElapsed < minimumCellTime) await sleep(minimumCellTime - cellElapsed);
    if (active?.token !== run.token) return;
    overlay.classList.remove("is-waiting");
    void overlay.offsetWidth;
    overlay.classList.add("is-revealing");
    overlay.dataset.phase = "revealing";
    await sleep(settleDuration);
    if (active?.token !== run.token) return;
    overlay.classList.add("is-settled");
    await sleep(reducedMotion ? 20 : 100);
    overlay.classList.remove("is-active", "is-waiting", "is-revealing", "is-settled", "has-tiles");
    shell.classList.remove("is-transition-guarded");
    document.documentElement.classList.remove("is-tour-transition-boot");
    run.phase = "complete";
    active = null;
    document.dispatchEvent(new CustomEvent("raindigit:tour-transition", {
      detail: { phase: "complete", initial: run.initial, token: run.token, patchCount: run.patchCount }
    }));
  }

  async function sampleUntilReady(run) {
    if (run.sampling) return;
    run.sampling = true;
    run.phase = run.initial ? "initial-loading" : "loading";
    overlay.dataset.phase = run.phase;
    let previous = "";
    let stable = 0;
    const deadline = performance.now() + 12_000;
    while (active?.token === run.token && performance.now() < deadline) {
      const frame = captureFrame(640, 0.72);
      if (frame) {
        if (!usable(frame)) revealAvailableCells(frame, run);
        const signature = `${Math.round(frame.visibleRatio * 1000)}:${Math.round(frame.averageLuma)}`;
        const rendererLoading = Boolean(viewer?.getRenderer?.()?.isLoading?.());
        const ready = usable(frame) && (!rendererLoading || signature === previous);
        stable = ready && signature === previous ? stable + 1 : 0;
        previous = signature;
        if (stable >= 2) {
          await settle(run, frame);
          return;
        }
      }
      await sleep(sampleInterval);
    }
    if (active?.token !== run.token) return;
    const fallback = captureFrame(640, 0.72);
    if (usable(fallback)) await settle(run, fallback);
    else {
      overlay.classList.add("is-revealing");
      await sleep(settleDuration);
      overlay.classList.remove("is-active", "is-waiting", "is-revealing", "has-tiles");
      shell.classList.remove("is-transition-guarded");
      document.documentElement.classList.remove("is-tour-transition-boot");
      active = null;
    }
  }

  function eventOrigin(event) {
    const bounds = shell.getBoundingClientRect();
    const x = Number.isFinite(event.clientX) ? (event.clientX - bounds.left) / Math.max(1, bounds.width) * 100 : 50;
    const y = Number.isFinite(event.clientY) ? (event.clientY - bounds.top) / Math.max(1, bounds.height) * 100 : 55;
    return { x: Math.max(5, Math.min(95, x)), y: Math.max(8, Math.min(92, y)) };
  }

  function armFromInteraction(event) {
    if (active || !event.target.closest(".nav-hotspot-anchor,.scene-card,.route-step,.floorplan-pin")) return;
    activate(false, eventOrigin(event));
  }

  function attach(nextViewer) {
    if (viewer || !nextViewer) return;
    viewer = nextViewer;
    const initialRun = activate(true);
    void sampleUntilReady(initialRun);
    viewer.on("scenechange", (sceneId) => {
      const run = active || activate(false);
      run.targetScene = sceneId;
      void sampleUntilReady(run);
    });
    viewer.on("load", () => {
      if (active) void sampleUntilReady(active);
      else {
        const frame = captureFrame(960, 0.8);
        if (usable(frame)) lastStableFrame = frame.dataUrl;
      }
    });
    shell.addEventListener("pointerdown", armFromInteraction, true);
    shell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") armFromInteraction(event);
    }, true);
  }

  document.documentElement.dataset.tourSceneTransition = "gold-pulse-v1";
  window.__rainDigitTourTransition = {
    attach,
    state: () => ({
      variant: "gold-pulse",
      phase: active?.phase || "ready",
      initial: active?.initial || false,
      patchCount: active?.patchCount || 0,
      sequence
    })
  };
})();
