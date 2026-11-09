// modal.js — one reusable retro (Win98/XP) dialog for the IDE, matching the
// app-loader disclaimer modal. Replaces native prompt()/confirm()/alert() and
// the bespoke About overlay so every dialog looks the same. All Promise-based.

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Core shell: overlay + titled box + button row. `buttons` is
// [{ label, primary, cancel, value }]; `value` may be a function (called when
// chosen, e.g. to read an input). Enter → primary, Escape/backdrop → cancel.
function show({ title, body = [], buttons, focus }) {
  return new Promise((resolve) => {
    const ov = el("div", "ide-modal-overlay");
    const box = el("div", "ide-modal");
    const bodyEl = el("div", "ide-modal-body");
    bodyEl.append(...body);
    const row = el("div", "ide-modal-actions");

    const cancelBtn = buttons.find((b) => b.cancel);
    const primaryBtn = buttons.find((b) => b.primary);
    const finish = (b) => { document.removeEventListener("keydown", onKey, true); ov.remove(); resolve(typeof b?.value === "function" ? b.value() : (b ? b.value : null)); };

    for (const b of buttons) {
      const btn = el("button", "tb ide-modal-btn" + (b.primary ? " tb-primary" : ""), b.label);
      btn.addEventListener("click", () => finish(b));
      b._el = btn;
      row.appendChild(btn);
    }
    box.append(el("div", "ide-modal-title", title), bodyEl, row);
    ov.appendChild(box);

    const onKey = (e) => {
      if (e.key === "Escape" && cancelBtn) { e.preventDefault(); e.stopPropagation(); finish(cancelBtn); }
      else if (e.key === "Enter" && primaryBtn && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); e.stopPropagation(); finish(primaryBtn); }
    };
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov && cancelBtn) finish(cancelBtn); });

    document.body.appendChild(ov);
    (focus?.() || primaryBtn?._el || row.firstChild)?.focus();
  });
}

// Accepts a string ("\n\n" → paragraphs), a DOM node, or an array of either.
function toNodes(body) {
  if (body == null) return [];
  if (Array.isArray(body)) return body.flatMap(toNodes);
  if (body instanceof Node) return [body];
  return String(body).split("\n\n").map((t) => el("p", null, t));
}

/** Informational dialog with a single OK button. Resolves when dismissed. */
export function modalAlert({ title = "JavaLab", body, okText = "OK" } = {}) {
  return show({ title, body: toNodes(body), buttons: [{ label: okText, primary: true, cancel: true, value: true }] });
}

/** Yes/No dialog. Resolves true (OK) or false (Cancel/Escape/backdrop). */
export function modalConfirm({ title = "JavaLab", body, okText = "OK", cancelText = "Cancel" } = {}) {
  return show({
    title, body: toNodes(body),
    buttons: [{ label: okText, primary: true, value: true }, { label: cancelText, cancel: true, value: false }],
  });
}

/** Text-input dialog. Resolves the trimmed value, or null on cancel/empty. */
export function modalPrompt({ title = "JavaLab", label, value = "", hint, placeholder, okText = "OK", cancelText = "Cancel" } = {}) {
  const body = [];
  if (label) body.push(el("label", "ide-modal-label", label));
  const input = el("input", "ide-modal-input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  if (placeholder) input.placeholder = placeholder;
  body.push(input);
  if (hint) body.push(el("div", "ide-modal-hint", hint));
  return show({
    title, body,
    buttons: [{ label: okText, primary: true, value: () => input.value.trim() || null }, { label: cancelText, cancel: true, value: null }],
    focus: () => { input.focus(); input.select(); return input; },
  });
}
