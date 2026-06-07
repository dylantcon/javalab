// stage.js — owns the launch "stage" (the play area over the gallery grid).
// Both curated apps (gallery.js) and uploaded jars (upload.js) launch here, each
// into its own realm iframe; "← Gallery" closes it and tears the realm down.
import { launchRealm, closeRealm } from "./realm.js";

const grid = document.getElementById("gallery-grid");
const stage = document.getElementById("stage");
const host = document.getElementById("stage-host");
const title = document.getElementById("stage-title");
const back = document.getElementById("stage-back");

back.addEventListener("click", closeStage);

export function openStage(label, url, w, h) {
  title.textContent = label;
  grid.hidden = true;
  stage.hidden = false;
  return launchRealm(host, url, w, h);
}

export function closeStage() {
  closeRealm(host);
  stage.hidden = true;
  grid.hidden = false;
}
