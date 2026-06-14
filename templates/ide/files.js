// files.js — file explorer (restricted to .java + MANIFEST.MF) + scaffolding.
// All dialogs go through the shared retro modal (modal.js); renaming a file
// keeps its public class declaration + the manifest Main-Class in sync.
import * as state from "./state.js";
import { modalPrompt, modalConfirm, modalAlert } from "./modal.js";
import { ensureJava, baseName, isValidClassName, rewritePublicClass, renameMainClass } from "./naming.js";

export const DEFAULT_MAIN = "MainLauncher";

// A fresh, runnable single-class project named after its main class.
const scaffold = (name) => ({
  [name + ".java"]:
    "public class " + name + " {\n" +
    "    public static void main(String[] args) {\n" +
    "        System.out.println(\"Hello from JavaLab!\");\n" +
    "    }\n" +
    "}\n",
  "MANIFEST.MF": "Main-Class: " + name + "\n",
});

export function scaffoldIfEmpty() { if (state.listFiles().length === 0) state.reset(scaffold(DEFAULT_MAIN)); }

/** New Simulation: ask for the main class name (retro modal), then reset. */
export async function newSimulation() {
  const raw = await modalPrompt({
    title: "New Simulation",
    label: "Main class name:",
    value: DEFAULT_MAIN,
    hint: "Creates a runnable <name>.java with a main() method and a matching manifest.",
  });
  if (!raw) return;
  const name = baseName(ensureJava(raw));
  if (!isValidClassName(name)) { await invalidName(name); return; }
  state.reset(scaffold(name));
}

/** Rename a .java file AND its public class declaration + Main-Class (dir 1). */
export function renameFileSyncingClass(oldName, newName) {
  if (oldName.endsWith(".java")) {
    const oldBase = baseName(oldName), newBase = baseName(newName);
    const body = state.getFile(oldName) || "";
    const rewritten = rewritePublicClass(body, newBase);
    if (rewritten !== body) state.setFile(oldName, rewritten, { silent: true });
    syncMainClass(oldBase, newBase);
  }
  state.renameFile(oldName, newName);
}

/** Point MANIFEST.MF's Main-Class at `newBase` iff it currently names `oldBase`. */
export function syncMainClass(oldBase, newBase) {
  const mf = state.getFile("MANIFEST.MF");
  if (mf == null) return;
  const nn = renameMainClass(mf, oldBase, newBase);
  if (nn !== mf) state.setFile("MANIFEST.MF", nn, { silent: true });
}

export function mountFiles(parent) {
  const root = el("div", "ide-files");
  parent.appendChild(root);

  const render = () => {
    root.replaceChildren();
    const head = el("div", "ide-pane-head", "Files");
    const add = el("button", "ide-mini", "New");
    add.title = "New Java file";
    add.onclick = async () => {
      const raw = await modalPrompt({ title: "New File", label: "File name:", placeholder: "Helper.java", hint: "A .java extension is added if you omit it." });
      if (!raw) return;
      const name = ensureJava(raw), cls = baseName(name);
      if (!isValidClassName(cls)) return invalidName(cls);
      if (state.hasFile(name)) return modalAlert({ title: "New File", body: name + " already exists." });
      state.newFile(name, "public class " + cls + " {\n}\n");
    };
    head.appendChild(add);
    root.appendChild(head);

    for (const name of state.listFiles()) {
      const row = el("div", "ide-file" + (name === state.getCurrent() ? " is-active" : ""));
      const label = el("span", "ide-file-name", name);
      label.onclick = () => state.selectFile(name);
      row.appendChild(label);
      if (name !== "MANIFEST.MF") {
        row.appendChild(act("ren", "Rename", async () => {
          const raw = await modalPrompt({ title: "Rename File", label: "New name:", value: name });
          if (!raw) return;
          const nn = ensureJava(raw);
          if (nn === name) return;
          const cls = baseName(nn);
          if (!isValidClassName(cls)) return invalidName(cls);
          if (state.hasFile(nn)) return modalAlert({ title: "Rename File", body: nn + " already exists." });
          renameFileSyncingClass(name, nn);
        }));
        row.appendChild(act("del", "Delete", async () => {
          if (await modalConfirm({ title: "Delete File", body: "Delete " + name + "?", okText: "Delete" })) state.deleteFile(name);
        }));
      }
      root.appendChild(row);
    }
  };
  state.subscribe(render);
  render();
}

const invalidName = (n) => modalAlert({ title: "Invalid name", body: '"' + n + '" is not a valid Java class name.' });
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function act(glyph, title, fn) { const b = el("button", "ide-file-act", glyph); b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; }
