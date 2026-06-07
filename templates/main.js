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
