// files.js — file explorer (restricted to .java + MANIFEST.MF) + scaffolding.
import * as state from "./state.js";

const SCAFFOLD = {
  "HelloWorld.java":
    "public class HelloWorld {\n" +
    "    public static void main(String[] args) {\n" +
    "        System.out.println(\"Hello from JavaLab!\");\n" +
    "    }\n" +
    "}\n",
  "MANIFEST.MF": "Main-Class: HelloWorld\n",
};

export function scaffoldIfEmpty() { if (state.listFiles().length === 0) state.reset({ ...SCAFFOLD }); }
export function newSimulation() { state.reset({ ...SCAFFOLD }); }

export function mountFiles(parent) {
  const root = el("div", "ide-files");
  parent.appendChild(root);

  const render = () => {
    root.replaceChildren();
    const head = el("div", "ide-pane-head", "Files");
    const add = el("button", "ide-mini", "New");
    add.title = "New Java file";
    add.onclick = () => {
      const name = ensureJava(promptName("New file name (e.g. Helper.java)"));
      if (name && !state.hasFile(name)) state.newFile(name, `public class ${base(name)} {\n}\n`);
    };
    head.appendChild(add);
    root.appendChild(head);

    for (const name of state.listFiles()) {
      const row = el("div", "ide-file" + (name === state.getCurrent() ? " is-active" : ""));
      const label = el("span", "ide-file-name", name);
      label.onclick = () => state.selectFile(name);
      row.appendChild(label);
      if (name !== "MANIFEST.MF") {
        row.appendChild(act("ren", "Rename", () => {
          const nn = ensureJava(promptName("Rename to", name));
          if (nn && !state.hasFile(nn)) state.renameFile(name, nn);
        }));
        row.appendChild(act("del", "Delete", () => { if (confirm(`Delete ${name}?`)) state.deleteFile(name); }));
      }
      root.appendChild(row);
    }
  };
  state.subscribe(render);
  render();
}

const ensureJava = (n) => (n ? (n.endsWith(".java") ? n : n + ".java") : null);
const base = (n) => n.replace(/\.java$/, "");
const promptName = (msg, def = "") => { const v = prompt(msg, def); return v && v.trim() ? v.trim() : null; };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function act(glyph, title, fn) { const b = el("button", "ide-file-act", glyph); b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; }
