// touch.js — on-screen game controls for touch devices (phones/tablets).
//
// Some gallery apps (e.g. Javarominoes) are keyboard-driven. On a touch device
// there's no keyboard, so for apps that declare `touchKeys` we OVERLAY a gamepad
// on top of the running game (like a JLayeredPane — the CheerpJ display keeps its
// full size; the buttons float in the bottom corners) and feed synthetic key
// events into the app's CheerpJ realm — a same-origin iframe whose #cheerpjDisplay
// holds the textarea CheerpJ captures keys on. We also flip that textarea to
// readonly + inputmode=none so the soft keyboard doesn't auto-expand.
//
// PUB/SUB: the buttons are PUBLISHERS — on press/release they emit a logical
// key intent. A single InputBridge SUBSCRIBER owns delivery into the realm: it
// resolves the capture textarea (cached + revalidated across the iframe's
// post-launch navigation), keeps it focused so AWT always has a focus owner —
// re-asserted on every press AND release, plus a debounced self-heal that
// reclaims focus if the page steals it (e.g. entering fullscreen) — and
// translates each intent into exactly one keydown / keyup. It mirrors the set of
// held keys so it can (a) ignore re-entrant presses and (b) flush anything still
// down on teardown — otherwise a VK code stays stuck in the game's own pressed
// set. We deliberately do NOT auto-repeat: keyboard-driven games like Javarominoes
// keep their own pressed-keys hash and poll it on a timer for DAS, so all the JS
// side must do is hold the key down faithfully from finger-down to finger-up.
//
// Mounted only on touch-PRIMARY devices (matchMedia hover:none + pointer:coarse),
// so a touchscreen PC — where the mouse is the primary pointer — never shows it,
// and desktop keyboards are untouched.

const SPECIAL = {
  " ":      { label: "Space", code: "Space",  keyCode: 32, wide: true },
  "Escape": { label: "Esc",   code: "Escape", keyCode: 27 },
};
const MOVE = new Set(["w", "a", "s", "d"]); // directional → left cluster

// A finger-tap can be shorter than the game's input poll interval; keep a tapped
// key "pressed" at least this long so the poller samples it at least once. Real
// deliberate taps already exceed this, so it only ever extends accidental
// ultra-fast taps — it never slows normal tapping or held movement.
const MIN_HELD_MS = 70;

function resolve(k) {
  if (SPECIAL[k]) return { key: k, ...SPECIAL[k] };
  const u = String(k).toUpperCase();
  return { key: k, label: u, code: "Key" + u, keyCode: u.charCodeAt(0) };
}

export function isTouchDevice() {
  return !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);
}

let pad = null;
let bridge = null;
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

// The single SUBSCRIBER. Owns delivery into the realm for every button: it
// resolves the capture textarea (cached, revalidated when detached), focuses it
// so AWT has a focus owner, and turns logical press/release into one keydown /
// keyup. `held` mirrors the game's own pressed-keys set so we never double-fire a
// keydown and can flush stragglers on teardown.
function makeInputBridge(iframe) {
  let cached = null;
  let healTimer = null;
  let guardedDoc = null;
  const held = new Map();   // code -> { spec, downAt, releaseTimer }

  const target = () => {
    if (cached && cached.isConnected) return cached;
    return (cached = keyTarget(iframe));
  };
  const refocus = () => {
    const t = target();
    if (t) try { t.focus({ preventScroll: true }); } catch (e) {}
  };

  // Focus self-heal: while the pad is mounted, if the capture textarea loses
  // focus (something on the page grabbed it), reclaim it — but DEBOUNCED, so a
  // fullscreen transition (which legitimately parks focus on the parent #stage
  // before stage.js's focusRealm hands it back) settles without a tug-of-war: a
  // focusin on the textarea cancels the pending heal, so the common path is free.
  const onFocusOut = () => { clearTimeout(healTimer); healTimer = setTimeout(refocus, 150); };
  const onFocusIn  = () => { clearTimeout(healTimer); healTimer = null; };
  const bindGuard = () => {
    let doc;
    try { doc = iframe.contentDocument; } catch (e) { return; }
    if (!doc || doc === guardedDoc) return;   // iframe renavigates post-launch — bind each new doc once
    guardedDoc = doc;
    doc.addEventListener("focusout", onFocusOut, true);
    doc.addEventListener("focusin", onFocusIn, true);
  };
  bindGuard();
  iframe.addEventListener("load", bindGuard);

  function press(spec) {
    const t = target();
    if (!t) return;                         // realm not ready → nothing to do
    refocus();                              // keep AWT focused on the display
    const cur = held.get(spec.code);
    if (cur) {                              // already down (re-entrant press, or a
      if (cur.releaseTimer) {               // re-press inside the min-hold window):
        clearTimeout(cur.releaseTimer);     // cancel the pending release, keep it down
        cur.releaseTimer = null;
      }
      return;                               // don't fire a second keydown
    }
    fireKey(t, "keydown", spec);
    held.set(spec.code, { spec, downAt: performance.now(), releaseTimer: null });
  }

  function release(spec) {
    const cur = held.get(spec.code);
    if (!cur || cur.releaseTimer) return;
    const fire = () => {
      held.delete(spec.code);
      const t = target();
      if (!t) return;
      refocus();                            // re-assert focus so the keyup routes too
      fireKey(t, "keyup", spec);
    };
    const elapsed = performance.now() - cur.downAt;
    if (elapsed >= MIN_HELD_MS) fire();
    else cur.releaseTimer = setTimeout(fire, MIN_HELD_MS - elapsed);
  }

  function dispose() {
    // Stop the self-heal and detach the focus guard from the realm document.
    clearTimeout(healTimer);
    healTimer = null;
    iframe.removeEventListener("load", bindGuard);
    if (guardedDoc) {
      try {
        guardedDoc.removeEventListener("focusout", onFocusOut, true);
        guardedDoc.removeEventListener("focusin", onFocusIn, true);
      } catch (e) {}
      guardedDoc = null;
    }
    // Release everything still down so no VK code stays stuck in the game's
    // pressed-keys hash after the pad is torn down.
    const t = target();
    held.forEach((cur) => {
      if (cur.releaseTimer) clearTimeout(cur.releaseTimer);
      if (t) fireKey(t, "keyup", cur.spec);
    });
    held.clear();
  }

  return { press, release, dispose };
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

// A PUBLISHER. On finger-down it captures the pointer so a finger drifting off
// the (small) button can't drop the press, then publishes press/release to the
// bridge. Pointer capture means there's no spurious pointerleave to handle, and
// pointerup/cancel/lostpointercapture all funnel through one idempotent release.
function button(spec, bridge) {
  const btn = document.createElement("button");
  btn.className = "tp-btn" + (spec.wide ? " wide" : "");
  btn.type = "button";
  btn.textContent = spec.label;
  btn.setAttribute("aria-label", spec.label);
  let active = false;
  const down = (e) => {
    e.preventDefault();                     // don't steal focus from the textarea / no synth-mouse
    if (active) return;
    active = true;
    btn.classList.add("on");
    try { btn.setPointerCapture(e.pointerId); } catch (e2) {}
    bridge.press(spec);
  };
  const up = (e) => {
    if (e) e.preventDefault();
    if (!active) return;
    active = false;
    btn.classList.remove("on");
    bridge.release(spec);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("lostpointercapture", up);   // safety net if capture is revoked
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  return btn;
}

// Overlay the gamepad on `host` (the stage's game area), floating over the
// CheerpJ display without shrinking it.
export function mountTouchpad(host, iframe, keys) {
  injectStyles();
  unmountTouchpad();
  suppressKeyboard(iframe);
  bridge = makeInputBridge(iframe);
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  pad = document.createElement("div");
  pad.className = "touchpad";
  const dpad = document.createElement("div");
  dpad.className = "tp-dpad";
  const actions = document.createElement("div");
  actions.className = "tp-actions";
  for (const k of keys) {
    const spec = resolve(k);
    (MOVE.has(spec.key) ? dpad : actions).appendChild(button(spec, bridge));
  }
  pad.appendChild(dpad);
  pad.appendChild(actions);
  host.appendChild(pad);
}

export function unmountTouchpad() {
  observers.forEach((o) => o.disconnect());
  observers = [];
  if (bridge) { bridge.dispose(); bridge = null; }
  if (pad) { pad.remove(); pad = null; }
}
