// index.js — IDE entry. esbuild bundles this (+ CM6/xterm/fflate) into
// public/ide.bundle.js as window.JavaLabIDE = { init }. main.js calls
// JavaLabIDE.init(container, ctx) the first time the "Write Java" tab opens.
import { mountEditor, setVim, isVim, focusEditor } from "./editor.js";
import { mountFiles, scaffoldIfEmpty, newSimulation } from "./files.js";
import { mountManifestForm } from "./manifest-form.js";
import { mountConsole } from "./console.js";
import { initBuildRealm } from "./build-client.js";
import { setContext, saveSimulation, simulate } from "./ide.js";
import { exportZip } from "./export.js";
import * as state from "./state.js";
import "@xterm/xterm/css/xterm.css";
import "./ide.css";

let mounted = false;

export function init(container, ctx) {
  if (mounted) return;
  mounted = true;
  setContext(ctx || {});
  container.innerHTML = LAYOUT;
  const $ = (sel) => container.querySelector(sel);

  mountTabStrip($("#ide-tabs"));
  mountEditor($("#ide-editor"));
  mountFiles($("#ide-sidebar-files"));
  mountManifestForm($("#ide-sidebar-manifest"));
  mountConsole($("#ide-console"));

  $("#tb-new").onclick = () => newSimulation();
  $("#tb-save").onclick = () => saveSimulation();
  $("#tb-run").onclick = () => simulate();
  $("#tb-export").onclick = () => exportZip();
  const vimBtn = $("#tb-vim");
  vimBtn.onclick = () => { setVim(!isVim()); vimBtn.classList.toggle("is-on", isVim()); };

  scaffoldIfEmpty();
  initBuildRealm();      // warm up the compiler realm in the background
  focusEditor();

  // Test hooks (harmless in prod): let the e2e harness inspect/seed state.
  window.__ideDebug = { files: () => state.snapshot(), isVim, setFile: (n, c) => state.setFile(n, c) };
}

function mountTabStrip(parent) {
  const render = () => {
    parent.replaceChildren();
    for (const name of state.listFiles()) {
      const t = document.createElement("button");
      t.className = "ide-tab" + (name === state.getCurrent() ? " is-active" : "");
      t.textContent = name;
      t.onclick = () => state.selectFile(name);
      parent.appendChild(t);
    }
  };
  state.subscribe(render);
  render();
}

const LAYOUT = `
  <div id="ide">
    <div id="ide-toolbar">
      <button id="tb-new" class="tb">New sim</button>
      <button id="tb-save" class="tb">Save</button>
      <button id="tb-run" class="tb tb-primary">&#9654; Simulate</button>
      <button id="tb-export" class="tb" title="Export sources as .zip">Export .zip</button>
      <button id="tb-vim" class="tb tb-toggle" title="Toggle Vim keybindings">Vim</button>
    </div>
    <div id="ide-body">
      <aside id="ide-sidebar">
        <div id="ide-sidebar-files"></div>
        <div id="ide-sidebar-manifest"></div>
      </aside>
      <div id="ide-main">
        <div id="ide-tabs"></div>
        <div id="ide-editor"></div>
        <div id="ide-console"></div>
      </div>
    </div>
  </div>`;
