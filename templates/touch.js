// touch.js — on-screen game controls for touch devices (phones/tablets).
//
// Some gallery apps (e.g. Javarominoes) are keyboard-driven. On a touch device
// there's no keyboard, so for apps that declare `touchKeys` we OVERLAY a gamepad
// on top of the running game (like a JLayeredPane — the CheerpJ display keeps its
// full size; the buttons float in the bottom corners) and dispatch synthetic key
// events into the app's CheerpJ realm — a same-origin iframe whose #cheerpjDisplay
// holds the textarea CheerpJ captures keys on. We also flip that textarea to
// readonly + inputmode=none so the soft keyboard doesn't auto-expand.
//
// Mounted only on touch-PRIMARY devices (matchMedia hover:none + pointer:coarse),
// so a touchscreen PC — where the mouse is the primary pointer — never shows it,
// and desktop keyboards are untouched.

const SPECIAL = {
  " ":      { label: "Space", code: "Space",  keyCode: 32, wide: true },
  "Escape": { label: "Esc",   code: "Escape", keyCode: 27 },
};
const MOVE = new Set(["w", "a", "s", "d"]); // directional → left cluster

function resolve(k) {
  if (SPECIAL[k]) return { key: k, ...SPECIAL[k] };
  const u = String(k).toUpperCase();
  return { key: k, label: u, code: "Key" + u, keyCode: u.charCodeAt(0) };
}

export function isTouchDevice() {
  return !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);
}

let pad = null;
let observers = [];
let styled = false;

function injectStyles() {
  if (styled) return;
  styled = true;
  const css = `
  .touchpad { position: absolute; inset: 0; z-index: 6; pointer-events: none;
    display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;
    padding: 10px calc(10px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));
    touch-action: none; user-select: none; -webkit-user-select: none; }
  /* Only the buttons take pointer events — the overlay and the cluster gaps stay
     transparent so taps/clicks in the empty areas reach the game underneath. */
  .touchpad .tp-dpad, .touchpad .tp-actions { display: flex; flex-wrap: wrap; gap: 8px; pointer-events: none; }
  .touchpad .tp-actions { justify-content: flex-end; align-content: flex-end; max-width: 55%; }
  .touchpad .tp-btn { font: bold 15px Tahoma, "Geneva", "MS Sans Serif", Verdana, sans-serif; color: var(--ink, #0a0a0a);
    pointer-events: auto;
    min-width: 48px; height: 48px; padding: 0 12px; background: var(--face, #c3c7cb); cursor: pointer; opacity: .92;
    border: 2px solid; border-color: var(--hi, #fff) var(--dk, #000) var(--dk, #000) var(--hi, #fff);
    box-shadow: inset -1px -1px var(--lo, #87898c), inset 1px 1px var(--light, #dfdfdf);
    touch-action: none; -webkit-tap-highlight-color: transparent; }
  .touchpad .tp-btn.wide { min-width: 96px; }
  .touchpad .tp-btn.on { border-color: var(--dk, #000) var(--hi, #fff) var(--hi, #fff) var(--dk, #000);
    box-shadow: inset 1px 1px var(--lo, #87898c); opacity: 1; }
  `;
  const s = document.createElement("style");
  s.id = "touchpad-style";
  s.textContent = css;
  document.head.appendChild(s);
}

function fireKey(target, type, spec) {
  // Build the event in the target's own realm (the iframe), so the app's
  // CheerpJ listeners see a same-realm KeyboardEvent.
  const win = (target.ownerDocument && target.ownerDocument.defaultView) || window;
  const KE = win.KeyboardEvent || KeyboardEvent;
  const ev = new KE(type, {
    key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode,
    bubbles: true, cancelable: true, composed: true,
  });
  // Constructors zero out legacy keyCode/which in some engines; Java reads keyCode.
  if (ev.keyCode !== spec.keyCode) {
    try {
      Object.defineProperty(ev, "keyCode", { get: () => spec.keyCode });
      Object.defineProperty(ev, "which", { get: () => spec.keyCode });
    } catch (e) {}
  }
  target.dispatchEvent(ev);
}

// CheerpJ's keyboard-capture textarea inside the realm iframe (same-origin).
function keyTarget(iframe) {
  try {
    const d = iframe.contentDocument;
    if (!d) return null;
    return d.querySelector("#cheerpjDisplay textarea") || d.querySelector("textarea") || d.body;
  } catch (e) { return null; }
}

// Keep CheerpJ's capture textareas from popping the mobile soft keyboard. The
// iframe NAVIGATES after launch (so the doc changes) and the textareas are created
// during boot — so (re)bind on load and watch for them.
function suppressKeyboard(iframe) {
  const bind = () => {
    let doc;
    try { doc = iframe.contentDocument; } catch (e) { return; }
    if (!doc) return;
    const stamp = () => doc.querySelectorAll("#cheerpjDisplay textarea, textarea").forEach((t) => {
      t.setAttribute("readonly", "");
      t.setAttribute("inputmode", "none");
    });
    stamp();
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === "TEXTAREA" || (n.querySelector && n.querySelector("textarea"))) { stamp(); break; }
      }
    });
    try { obs.observe(doc.documentElement || doc, { childList: true, subtree: true }); } catch (e) {}
    observers.push(obs);
  };
  bind();
  iframe.addEventListener("load", bind);
}

function button(spec, iframe) {
  const btn = document.createElement("button");
  btn.className = "tp-btn" + (spec.wide ? " wide" : "");
  btn.type = "button";
  btn.textContent = spec.label;
  btn.setAttribute("aria-label", spec.label);
  let pressed = false;
  const down = (e) => {
    e.preventDefault();
    if (pressed) return;
    pressed = true;
    btn.classList.add("on");
    const t = keyTarget(iframe);
    if (t) fireKey(t, "keydown", spec);
  };
  const up = (e) => {
    e.preventDefault();
    if (!pressed) return;
    pressed = false;
    btn.classList.remove("on");
    const t = keyTarget(iframe);
    if (t) fireKey(t, "keyup", spec);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  return btn;
}

// Overlay the gamepad on `host` (the stage's game area), floating over the
// CheerpJ display without shrinking it.
export function mountTouchpad(host, iframe, keys) {
  injectStyles();
  unmountTouchpad();
  suppressKeyboard(iframe);
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  pad = document.createElement("div");
  pad.className = "touchpad";
  const dpad = document.createElement("div");
  dpad.className = "tp-dpad";
  const actions = document.createElement("div");
  actions.className = "tp-actions";
  for (const k of keys) {
    const spec = resolve(k);
    (MOVE.has(spec.key) ? dpad : actions).appendChild(button(spec, iframe));
  }
  pad.appendChild(dpad);
  pad.appendChild(actions);
  host.appendChild(pad);
}

export function unmountTouchpad() {
  observers.forEach((o) => o.disconnect());
  observers = [];
  if (pad) { pad.remove(); pad = null; }
}
