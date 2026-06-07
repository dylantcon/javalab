// main.js — launcher entry point. Wires the gallery, tabs, and upload, and
// lazy-initialises the IDE bundle (window.JavaLabIDE) the first time the
// "Write Java" tab opens, handing it a bridge to the Phase 1 pieces it needs.
import { renderGallery } from "./gallery.js";
import { initTabs, switchTab } from "./tabs.js";
import { initUpload, refreshUploads } from "./upload.js";
import { openStage } from "./stage.js";
import { putJar } from "./idb.js";

renderGallery();
initUpload();
initSplitter();

let ideReady = false;
initTabs((name) => {
  if (name === "ide" && !ideReady && window.JavaLabIDE) {
    ideReady = true;
    window.JavaLabIDE.init(document.getElementById("ide-mount"), {
      putJar,
      refreshUploads,
      switchToUpload: () => switchTab("upload"),
      openStage,
    });
  }
});

// Draggable splitter between the gallery and the sandbox column, so the editor
// can be widened (an IDE without a resizable split is no IDE).
function initSplitter() {
  const layout = document.getElementById("layout");
  const handle = document.getElementById("hsplit");
  if (!layout || !handle) return;
  let dragging = false;
  handle.addEventListener("mousedown", (e) => { dragging = true; e.preventDefault(); document.body.style.cursor = "ew-resize"; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = layout.getBoundingClientRect();
    const w = Math.max(360, Math.min(r.width - 220, r.right - e.clientX));
    layout.style.setProperty("--sandbox-w", w + "px");
  });
  window.addEventListener("mouseup", () => { if (dragging) { dragging = false; document.body.style.cursor = ""; } });
}
