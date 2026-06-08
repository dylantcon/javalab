// stage.js — owns the launch "stage" (the play area over the gallery grid).
// The app runs in its own realm iframe at its native display size and is SCALED
// to fit the stage area, so it always fills the available space (resize the
// gallery|sandbox splitter to grow it). "Maximize" makes the stage fill the
// browser viewport; Esc or "Restore" exits. "<< Gallery" tears the realm down.
import { launchRealm, closeRealm } from "./realm.js";

const grid = document.getElementById("gallery-grid");
const stage = document.getElementById("stage");
const host = document.getElementById("stage-host");
const title = document.getElementById("stage-title");
const back = document.getElementById("stage-back");
const maxBtn = document.getElementById("stage-max");

let cur = null;   // { iframe, w, h }
let ro = null;

back.addEventListener("click", closeStage);
if (maxBtn) maxBtn.addEventListener("click", toggleMax);
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && stage.classList.contains("is-max")) toggleMax(); });

export function openStage(label, url, w, h) {
  title.textContent = label;
  grid.hidden = true;
  stage.hidden = false;
  const iframe = launchRealm(host, url, w, h);
  iframe.style.transformOrigin = "center center";
  cur = { iframe, w, h };
  fit();
  ro = new ResizeObserver(fit);
  ro.observe(host);
  return iframe;
}

export function closeStage() {
  if (stage.classList.contains("is-max")) toggleMax();
  if (ro) { ro.disconnect(); ro = null; }
  closeRealm(host);
  stage.hidden = true;
  grid.hidden = false;
  cur = null;
}

function toggleMax() {
  const on = stage.classList.toggle("is-max");
  if (maxBtn) maxBtn.textContent = on ? "Restore" : "Maximize";
  fit();
}

// Scale the native w×h display to fill the stage area (preserve aspect ratio).
function fit() {
  if (!cur) return;
  const r = host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const s = Math.min((r.width - 12) / cur.w, (r.height - 12) / cur.h);
  cur.iframe.style.transform = "scale(" + Math.max(0.15, s) + ")";
}
