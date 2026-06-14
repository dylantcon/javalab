// index.js — IDE entry. esbuild bundles this (+ CM6/xterm/fflate) into
// public/ide.bundle.js as window.JavaLabIDE = { init }. main.js calls
// JavaLabIDE.init(container, ctx) the first time the "Write Java" tab opens.
import { mountEditor, setVim, isVim, focusEditor, setFormatHook, setContent, formatCurrent } from "./editor.js";
import { mountFiles, scaffoldIfEmpty, newSimulation } from "./files.js";
import { mountManifestForm } from "./manifest-form.js";
import { modalAlert } from "./modal.js";
import { mountConsole, writeLine } from "./console.js";
import { initBuildRealm, format as formatInRealm } from "./build-client.js";
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

  const vimBtn = $("#tb-vim");
  const toggleVim = () => {
    setVim(!isVim());
    vimBtn.classList.toggle("is-on", isVim());
    $("#mi-vim").textContent = "Vim Keybindings: " + (isVim() ? "On" : "Off");
  };
  const actions = {
    new: newSimulation, save: saveSimulation, run: simulate,
    format: formatCurrent, export: exportZip, vim: toggleVim, about: showAbout,
  };

  // toolbar
  $("#tb-new").onclick = actions.new;
  $("#tb-save").onclick = actions.save;
  $("#tb-run").onclick = actions.run;
  $("#tb-format").onclick = actions.format;
  $("#tb-export").onclick = actions.export;
  vimBtn.onclick = actions.vim;

  wireMenus(container, actions);
  wireSplitter($("#ide-body"), $("#ide-vsplit"));

  // Alt+Shift+F → google-java-format in the build realm (basic-indent fallback).
  setFormatHook(async (name, src) => {
    if (!name.endsWith(".java")) throw new Error("not-java");
    writeLine("Formatting " + name + "...");
    const r = await formatInRealm(name, src);
    if (r.ok && r.formatted) { writeLine("\x1b[32mFORMATTED\x1b[0m"); return r.formatted; }
    writeLine("\x1b[33mformat unavailable - basic indent\x1b[0m");
    throw new Error("format-failed");
  });

  scaffoldIfEmpty();
  initBuildRealm();      // warm up the compiler realm in the background
  focusEditor();

  window.__ideDebug = { files: () => state.snapshot(), isVim, setFile: (n, c) => state.setFile(n, c), setEditor: setContent, format: formatCurrent };
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

// --- classic menu bar: click to open, hover to switch, click item to run ---
function wireMenus(container, actions) {
  const menus = [...container.querySelectorAll(".ide-menu")];
  const closeAll = () => menus.forEach((m) => m.classList.remove("is-open"));
  const anyOpen = () => menus.some((m) => m.classList.contains("is-open"));
  menus.forEach((m) => {
    const top = m.querySelector(".ide-menu-top");
    top.onclick = (e) => { e.stopPropagation(); const open = m.classList.contains("is-open"); closeAll(); if (!open) m.classList.add("is-open"); };
    top.onmouseenter = () => { if (anyOpen()) { closeAll(); m.classList.add("is-open"); } };
  });
  container.querySelectorAll(".ide-menu-pop button[data-act]").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); closeAll(); actions[b.dataset.act]?.(); };
  });
  document.addEventListener("click", closeAll);
}

// --- draggable sidebar/editor splitter ---
function wireSplitter(body, handle) {
  let dragging = false;
  handle.addEventListener("mousedown", (e) => { dragging = true; e.preventDefault(); document.body.style.cursor = "ew-resize"; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = body.getBoundingClientRect();
    const w = Math.max(80, Math.min(r.width - 220, e.clientX - r.left));
    body.style.setProperty("--sb", w + "px");
  });
  window.addEventListener("mouseup", () => { if (dragging) { dragging = false; document.body.style.cursor = ""; } });
}

function showAbout() {
  const p = (html) => { const e = document.createElement("p"); e.innerHTML = html; return e; };
  modalAlert({
    title: "About JavaLab",
    body: [
      p("<b>JavaLab</b> - a Java emulator that runs in your browser."),
      p("Write, compile, and run Java with no server and no install.<br>Powered by CheerpJ, a WebAssembly JVM."),
    ],
  });
}

const LAYOUT = `
  <div id="ide">
    <div id="ide-menubar">
      <div class="ide-menu"><button class="ide-menu-top">File</button>
        <div class="ide-menu-pop">
          <button data-act="new">New Simulation</button>
          <button data-act="export">Export Sources...</button>
        </div></div>
      <div class="ide-menu"><button class="ide-menu-top">Build</button>
        <div class="ide-menu-pop">
          <button data-act="save">Compile</button>
          <button data-act="run">Simulate</button>
        </div></div>
      <div class="ide-menu"><button class="ide-menu-top">Source</button>
        <div class="ide-menu-pop">
          <button data-act="format">Format (Alt+Shift+F)</button>
        </div></div>
      <div class="ide-menu"><button class="ide-menu-top">Options</button>
        <div class="ide-menu-pop">
          <button data-act="vim" id="mi-vim">Vim Keybindings: Off</button>
        </div></div>
      <div class="ide-menu"><button class="ide-menu-top">Help</button>
        <div class="ide-menu-pop">
          <button data-act="about">About JavaLab</button>
        </div></div>
    </div>
    <div id="ide-toolbar">
      <button id="tb-new" class="tb">New</button>
      <button id="tb-save" class="tb">Save</button>
      <button id="tb-run" class="tb tb-primary">Simulate</button>
      <button id="tb-format" class="tb" title="Reformat (Alt+Shift+F)">Format</button>
      <button id="tb-export" class="tb" title="Export sources as .zip">Export</button>
      <span class="tb-sep"></span>
      <button id="tb-vim" class="tb tb-toggle" title="Toggle Vim keybindings">Vim</button>
    </div>
    <div id="ide-body">
      <aside id="ide-sidebar">
        <div id="ide-sidebar-files"></div>
        <div id="ide-sidebar-manifest"></div>
      </aside>
      <div id="ide-vsplit" title="Drag to resize"></div>
      <div id="ide-main">
        <div id="ide-tabs"></div>
        <div id="ide-editor"></div>
        <div id="ide-console"></div>
      </div>
    </div>
  </div>`;
