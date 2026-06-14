// manifest-form.js — small form two-way bound to the MANIFEST.MF file content.
import * as state from "./state.js";

export function mountManifestForm(parent) {
  const root = document.createElement("div");
  root.className = "ide-manifest";
  root.innerHTML =
    '<div class="ide-pane-head">Manifest</div>' +
    '<label class="ide-mf-row">Main-Class' +
    '<input id="mf-main" class="ide-mf-input" spellcheck="false" placeholder="MainLauncher"></label>';
  parent.appendChild(root);
  const input = root.querySelector("#mf-main");

  const sync = () => {
    if (document.activeElement === input) return;     // don't clobber while typing
    input.value = parseMainClass(state.getFile("MANIFEST.MF") || "");
  };
  state.subscribe(sync);
  sync();

  input.addEventListener("input", () => {
    state.setFile("MANIFEST.MF", "Main-Class: " + input.value.trim() + "\n", { silent: true });
  });
}

const parseMainClass = (mf) => { const m = /Main-Class:\s*(.+)/.exec(mf); return m ? m[1].trim() : ""; };
