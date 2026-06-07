// CodeMirror 6 editor wired to the shared IDE state. Multi-document: swaps the
// document when the selected file changes (edits flow back into state silently).
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab, indentSelection } from "@codemirror/commands";
import { java } from "@codemirror/lang-java";
import { lintGutter, linter, forceLinting } from "@codemirror/lint";
import { vim } from "@replit/codemirror-vim";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "codemirror";
import * as state from "./state.js";

let view = null;
let displayed = null;          // file currently shown (avoid clobbering on content edits)
let vimOn = false;
let formatHook = null;         // orchestrator may override with google-java-format
let diagnostics = [];          // [{file,line,severity,message}] from the last build
const vimComp = new Compartment();

// A single linter source (CM6's canonical pattern) that maps the last build's
// diagnostics for the current file onto the live document.
const javacLinter = linter((v) => {
  const items = [];
  for (const d of diagnostics) {
    if (d.file !== displayed) continue;
    const n = Math.min(Math.max(d.line, 1), v.state.doc.lines);
    const ln = v.state.doc.line(n);
    items.push({ from: ln.from, to: ln.to, severity: d.severity === "error" ? "error" : "warning", message: d.message });
  }
  return items;
}, { delay: 30 });

export function mountEditor(parent) {
  view = new EditorView({ parent, state: makeState("") });
  state.subscribe(syncFromState);
  syncFromState();
  return view;
}

export function setVim(on) {
  vimOn = on;
  view.dispatch({ effects: vimComp.reconfigure(on ? vim() : []) });
  view.focus();
}
export const isVim = () => vimOn;

/** Orchestrator registers an async formatter (e.g. google-java-format). */
export function setFormatHook(fn) { formatHook = fn; }

export function focusEditor() { view?.focus(); }

/** Update inline diagnostics from a build. `parsed` = [{file,line,severity,message}]. */
export function showDiagnostics(parsed) {
  diagnostics = parsed || [];
  if (view) forceLinting(view);
}

function makeState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      // vim FIRST (its keymap must take precedence) — empty unless toggled on
      vimComp.of(vimOn ? vim() : []),
      basicSetup,
      java(),
      oneDark,
      javacLinter,
      lintGutter(),
      keymap.of([
        indentWithTab,                                   // Camp IDE: Tab indents
        { key: "Alt-Shift-f", run: () => { runFormat(); return true; } },
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && displayed) state.setFile(displayed, u.state.doc.toString(), { silent: true });
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "Menlo, Consolas, monospace" },
      }),
    ],
  });
}

function syncFromState() {
  if (!view) return;
  const cur = state.getCurrent();
  if (cur === displayed) return;          // only reload on selection change, not edits
  displayed = cur;
  view.setState(makeState(cur ? state.getFile(cur) ?? "" : ""));
}

async function runFormat() {
  if (!view || !displayed) return;
  const src = view.state.doc.toString();
  let out = src;
  if (formatHook) {
    try { out = await formatHook(displayed, src); } catch { out = basicIndent(view) ?? src; }
  } else {
    basicIndent(view);
    return;
  }
  if (out !== src) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
    state.setFile(displayed, out, { silent: true });
  }
}

// Fallback formatter: re-indent the whole document with CM's language indenter.
function basicIndent(v) {
  v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
  indentSelection(v);
  v.dispatch({ selection: { anchor: 0 } });
  return v.state.doc.toString();
}
