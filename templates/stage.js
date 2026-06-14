// stage.js — owns the launch "stage" (the play area over the gallery grid).
// The app runs in its own realm iframe at its native display size and is SCALED
// to fit the stage area, so it always fills the available space (resize the
// gallery|sandbox splitter to grow it). "Maximize" makes the stage fill the
// browser viewport; Esc or "Restore" exits. "<< Gallery" tears the realm down.
import { launchRealm, closeRealm } from "./realm.js";
import { DEFAULT_DISP_W, DEFAULT_DISP_H } from "./idb.js";
import { showViewer, showGallery } from "./leftpanel.js";
import { isTouchDevice, mountTouchpad, unmountTouchpad } from "./touch.js";

// The realm iframe shows a console pane BELOW the Java display; this is its
// height (+ border) so we can size the iframe to hold display + console and let
// the stage scale the whole thing to fit. Keep in sync with #console in
// run-upload.html.
const STAGE_CHROME = 140;

const stage = document.getElementById("stage");
const host = document.getElementById("stage-host");
const title = document.getElementById("stage-title");
const back = document.getElementById("stage-back");
const maxBtn = document.getElementById("stage-max");
const viewBtn = document.getElementById("stage-view");

let cur = null;   // { iframe, w, h, mode: "display"|"console", hasConsole }
let ro = null;

back.addEventListener("click", closeStage);
if (maxBtn) maxBtn.addEventListener("click", toggleMax);
if (viewBtn) viewBtn.addEventListener("click", toggleView);
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && stage.classList.contains("is-max") && !document.fullscreenElement) toggleMax(); });

export function openStage(label, url, w, h, opts = {}) {
  title.textContent = label;
  showViewer();                      // bring the Viewer tab forward
  stage.classList.add("has-app");    // reveal the stage bar + iframe, hide the empty state
  const iframe = launchRealm(host, url, w, h);   // replaces the empty-state placeholder
  iframe.style.transformOrigin = "center center";
  cur = { iframe, w, h, mode: "display", hasConsole: !!opts.hasConsole };
  // Console toggle is only meaningful for realms that HAVE a console pane
  // (uploaded / IDE-built jars via run-upload.html); curated apps don't.
  if (viewBtn) { viewBtn.hidden = !cur.hasConsole; viewBtn.textContent = "Console"; viewBtn.classList.remove("is-on"); }
  fit();
  ro = new ResizeObserver(fit);
  ro.observe(host);
  // Touch devices: keyboard-driven apps (app.touchKeys) get an on-screen gamepad
  // below the scaled game; mounting it shrinks the host, so fit() rescales. It
  // dispatches key events into the realm iframe (and suppresses the soft keyboard).
  const id = (url.match(/\/apps\/([^/]+)\//) || [])[1];
  const app = (window.JAVALAB_APPS || []).find((a) => a.id === id);
  if (app && app.touchKeys && app.touchKeys.length && isTouchDevice()) mountTouchpad(host, iframe, app.touchKeys);
  return iframe;
}

// Launch a library jar (uploaded OR IDE-built) at a chosen CheerpJ display size
// (w×h = the Java "screen"). The realm iframe is sized to hold that display PLUS
// the console pane below it. w/h default to the standard display when omitted.
export function openUploadStage(label, key, version, w = DEFAULT_DISP_W, h = DEFAULT_DISP_H) {
  const url = `/run-upload.html?key=${encodeURIComponent(key)}&w=${w}&h=${h}&version=${version}`;
  return openStage(label, url, w, h + STAGE_CHROME, { hasConsole: true });
}

export function closeStage() {
  if (stage.classList.contains("is-max")) toggleMax();
  if (ro) { ro.disconnect(); ro = null; }
  unmountTouchpad();
  closeRealm(host);                  // drop the iframe; the CSS empty-state shows again
  stage.classList.remove("has-app");
  if (viewBtn) viewBtn.hidden = true;
  cur = null;
  showGallery();                     // hop back to the Gallery tab
}

// Toggle the graphical CheerpJ display vs. a full-height console. For programs
// that just read/write stdin/stdout/stderr, the big (often empty) display is
// wasted space and the scaled-down console pane is hard to read; console mode
// hides the display and stretches the iframe 1:1 so the terminal fills the area
// at native size. The JVM keeps running either way — this is purely the view.
function toggleView() {
  if (!cur || !cur.hasConsole) return;
  setViewMode(cur.mode === "console" ? "display" : "console");
}
function setViewMode(mode) {
  if (!cur) return;
  cur.mode = mode;
  const onConsole = mode === "console";
  if (viewBtn) { viewBtn.textContent = onConsole ? "Display" : "Console"; viewBtn.classList.toggle("is-on", onConsole); }
  try { cur.iframe.contentWindow.postMessage({ source: "javalab-stage", type: "view-mode", mode }, "*"); } catch (e) {}
  fit();
  focusRealm();
}

// Maximize → real OS fullscreen (Fullscreen API) on the stage, for all apps and
// platforms; falls back to a fixed overlay (.is-max) where fullscreen is blocked.
// The browser's own exit (Esc, gestures) is synced via the fullscreenchange event.
// Clicking Maximize/Restore (or the browser entering fullscreen) puts DOM focus on
// the button / fullscreen element in the PARENT page, which steals keyboard focus
// from the game running in the realm iframe — so physical keystrokes stop reaching
// CheerpJ. Hand focus back to the realm after the transition.
function focusRealm() {
  if (!cur) return;
  const go = () => {
    if (maxBtn) try { maxBtn.blur(); } catch (e) {}
    try { cur.iframe.focus({ preventScroll: true }); } catch (e) {}     // parent focus → the iframe
    try { cur.iframe.contentWindow.focus(); } catch (e) {}
    try {
      const t = cur.iframe.contentDocument &&
        cur.iframe.contentDocument.querySelector("#cheerpjDisplay textarea");
      if (t) t.focus({ preventScroll: true });                          // CheerpJ's key-capture textarea
    } catch (e) {}
  };
  go();
  setTimeout(go, 60);   // after the fullscreen transition settles
}
function setMax(on) {
  stage.classList.toggle("is-max", on);
  if (maxBtn) maxBtn.textContent = on ? "Restore" : "Maximize";
  fit();
  focusRealm();
}
function toggleMax() {
  const goMax = !stage.classList.contains("is-max");
  if (goMax) {
    if (stage.requestFullscreen) stage.requestFullscreen().catch(() => setMax(true));
    else setMax(true);
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => setMax(false));
  } else {
    setMax(false);
  }
}
document.addEventListener("fullscreenchange", () => setMax(!!document.fullscreenElement));

// Display mode: scale the native w×h realm to fill the stage area (preserving
// aspect ratio). Console mode: drop the scale and stretch the iframe 1:1 to the
// host so the terminal renders at full, sharp size.
function fit() {
  if (!cur) return;
  const r = host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  if (cur.mode === "console") {
    cur.iframe.style.transform = "none";
    cur.iframe.style.width = Math.max(0, r.width - 12) + "px";
    cur.iframe.style.height = Math.max(0, r.height - 12) + "px";
    return;
  }
  cur.iframe.style.width = cur.w + "px";
  cur.iframe.style.height = cur.h + "px";
  const s = Math.min((r.width - 12) / cur.w, (r.height - 12) / cur.h);
  cur.iframe.style.transform = "scale(" + Math.max(0.15, s) + ")";
}
