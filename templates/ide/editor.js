// CodeMirror 6 editor wired to the shared IDE state. Multi-document: swaps the
// document when the selected file changes (edits flow back into state silently).
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab, indentSelection } from "@codemirror/commands";
import { java } from "@codemirror/lang-java";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import * as state from "./state.js";
import { publicTypeName, isValidClassName, baseName } from "./naming.js";
import { syncMainClass } from "./files.js";

let view = null;
let displayed = null;          // file currently shown (avoid clobbering on content edits)
let renameTimer = null;        // debounce for the code→filename rename (direction 2)
let vimOn = false;
let formatHook = null;         // orchestrator may override with google-java-format
let diagnostics = [];          // [{file,line,severity,message}] from the last build
const vimComp = new Compartment();

// Map the last build's diagnostics for the CURRENTLY shown file onto live
// document positions. Applied imperatively via setDiagnostics (below), NOT a
// linter() source: a linter source only re-runs on document edits, so a clean
// compile (which changes no text) would never clear stale markers until the
// next keystroke.
function diagnosticsForView(v) {
  const items = [];
  for (const d of diagnostics) {
    if (d.file !== displayed) continue;
    const n = Math.min(Math.max(d.line, 1), v.state.doc.lines);
    const ln = v.state.doc.line(n);
    items.push({ from: ln.from, to: ln.to, severity: d.severity === "error" ? "error" : "warning", message: d.message });
  }
  return items;
}

// Push the current diagnostics into the editor right away (set, change, or
// clear) — independent of any document edit.
function applyDiagnostics() {
  if (view) view.dispatch(setDiagnostics(view.state, diagnosticsForView(view)));
}

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

/** Replace the editor's document (also used by the e2e harness). */
export function setContent(text) {
  if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

/** Trigger the format action programmatically (same path as Alt+Shift+F). */
export function formatCurrent() { return runFormat(); }

/** Update inline diagnostics from a build. `parsed` = [{file,line,severity,message}].
 *  Applies immediately, so a successful compile ([]) clears stale markers. */
export function showDiagnostics(parsed) {
  diagnostics = parsed || [];
  applyDiagnostics();
}

function makeState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      // vim FIRST (its keymap must take precedence) — empty unless toggled on
      vimComp.of(vimOn ? vim() : []),
      basicSetup,
      java(),
      lintGutter(),
      keymap.of([
        indentWithTab,                                   // Camp IDE: Tab indents
        { key: "Alt-Shift-f", run: () => { runFormat(); return true; } },
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && displayed) {
          state.setFile(displayed, u.state.doc.toString(), { silent: true });
          scheduleClassSync();
        }
      }),
      // Classic light editor (NetBeans-1.0 feel): white, Courier, grey gutter.
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px", backgroundColor: "#ffffff", color: "#000000" },
        ".cm-scroller": { fontFamily: '"Courier New", Courier, monospace', lineHeight: "1.35" },
        ".cm-gutters": { backgroundColor: "#e4e4e4", color: "#555", border: "none", borderRight: "1px solid #999" },
        ".cm-activeLine": { backgroundColor: "#eef3ff" },
        ".cm-activeLineGutter": { backgroundColor: "#dde6f5" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#b5d5ff" },
        ".cm-cursor": { borderLeftColor: "#000" },
      }),
    ],
  });
}

function syncFromState() {
  if (!view) return;
  const cur = state.getCurrent();
  const next = cur ? state.getFile(cur) ?? "" : "";
  // Reload on selection change OR when the shown file's content changed in
  // state behind our back (reset/New Simulation, programmatic setFile). Live
  // keystrokes save via {silent:true} (no emit), so they never reach here —
  // and an unrelated emit while the doc already matches state is a no-op, so
  // the cursor/scroll survive.
  if (cur === displayed && next === view.state.doc.toString()) return;
  if (renameTimer) { clearTimeout(renameTimer); renameTimer = null; }   // drop a pending rename for the file we're leaving
  displayed = cur;
  view.setState(makeState(next));
  applyDiagnostics();            // setState wipes the lint field — re-show this file's markers
}

// Direction 2 (code→filename): after the user stops typing, if the file's
// public class was renamed in the source, rename the file (+ Main-Class) to
// match — javac requires `public class Foo` to live in Foo.java.
function scheduleClassSync() {
  if (renameTimer) clearTimeout(renameTimer);
  renameTimer = setTimeout(syncFilenameToClass, 600);
}

function syncFilenameToClass() {
  renameTimer = null;
  const file = displayed;
  if (!view || !file || !file.endsWith(".java")) return;
  const cls = publicTypeName(view.state.doc.toString());
  if (!cls || !isValidClassName(cls)) return;
  const oldBase = baseName(file);
  if (cls === oldBase) return;
  const target = cls + ".java";
  if (state.hasFile(target)) return;            // name taken — leave it to the user to resolve
  // The editor initiated this rename, so point `displayed` at the new name
  // BEFORE renameFile emits: syncFromState then sees (cur === displayed &&
  // content unchanged) and skips the reload that would reset the cursor.
  displayed = target;
  state.renameFile(file, target);
  syncMainClass(oldBase, cls);
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
