// upload.js — Tab 1: read a .jar via the File API, keep its BYTES in IndexedDB
// (never uploaded), list/run/evict the local library. Running launches a fresh
// realm that reads the jar back from IndexedDB. No server endpoint is involved.
import { putJar, listJars, removeJar, setJarVersion, setJarSize, DEFAULT_DISP_W, DEFAULT_DISP_H } from "./idb.js";
import { openUploadStage } from "./stage.js";
import { escapeHtml, formatBytes } from "./util.js";
import { unzipSync, strFromU8 } from "fflate";

// Pick the CheerpJ runtime for a jar from its bytecode major version.
// CheerpJ 4.3 only provides SourceDataLine audio on Java 8, so plain Java-8
// jars run on Java 8 (audio works); newer bytecode uses 11/17 (no audio).
function classMajor(u8, name) {
  const out = unzipSync(u8, { filter: (f) => f.name === name });
  const d = out[name];
  return d && d.length >= 8 ? ((d[6] << 8) | d[7]) : 0;
}
function detectRuntime(u8) {
  try {
    let major = 0;
    const mf = unzipSync(u8, { filter: (f) => f.name === "META-INF/MANIFEST.MF" })["META-INF/MANIFEST.MF"];
    const main = mf && /Main-Class:\s*(.+)/i.exec(strFromU8(mf));
    if (main) major = classMajor(u8, main[1].trim().replace(/\./g, "/") + ".class");
    if (!major) {                                     // fall back to the first class entry
      let first = null;
      unzipSync(u8, { filter: (f) => { if (!first && f.name.endsWith(".class")) first = f.name; return false; } });
      if (first) major = classMajor(u8, first);
    }
    if (major <= 52) return 8;                         // <= Java 8  -> audio
    if (major <= 55) return 11;                        // Java 9-11
    return 17;                                         // Java 12-17
  } catch { return 17; }
}

let fileInput, filepick, listEl, usageEl;

export function initUpload() {
  fileInput = document.getElementById("file-input");
  filepick = document.getElementById("filepick");
  listEl = document.getElementById("upload-list");
  usageEl = document.getElementById("storage-usage");

  fileInput.addEventListener("change", () => acceptFiles(fileInput.files));

  // drag & drop
  ["dragenter", "dragover"].forEach((ev) => filepick.addEventListener(ev, (e) => {
    e.preventDefault(); filepick.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((ev) => filepick.addEventListener(ev, (e) => {
    e.preventDefault(); filepick.classList.remove("dragover");
  }));
  filepick.addEventListener("drop", (e) => acceptFiles(e.dataTransfer?.files));

  refreshUploads();
}

async function acceptFiles(fileList) {
  const files = [...(fileList || [])].filter((f) => f.name.toLowerCase().endsWith(".jar"));
  for (const f of files) {
    const buf = await f.arrayBuffer();        // read in-browser; no network
    await putJar(f.name, buf, detectRuntime(new Uint8Array(buf)));
  }
  fileInput.value = "";
  await refreshUploads();
}

export async function refreshUploads() {
  const jars = await listJars();
  jars.sort((a, b) => b.added - a.added);
  if (jars.length === 0) {
    listEl.innerHTML = '<div class="upload-empty">No jars yet - add one above to run it here.</div>';
  } else {
    listEl.replaceChildren(...jars.map(jarCard));
  }
  await renderUsage();
}

function jarCard(meta) {
  const ver = meta.version || 17;
  const opt = (v, label) => `<option value="${v}"${v === ver ? " selected" : ""}>${label}</option>`;
  const w0 = meta.dispW || DEFAULT_DISP_W, h0 = meta.dispH || DEFAULT_DISP_H;
  const el = document.createElement("div");
  el.className = "jar-card";
  el.setAttribute("role", "listitem");
  el.innerHTML =
    `<div class="jar-name">${escapeHtml(meta.name)}</div>` +
    `<div class="jar-meta">${formatBytes(meta.size)}</div>` +
    `<label class="jar-rt" title="Audio (SourceDataLine) works only on Java 8">Java ` +
      `<select class="rt">${opt(8, "8 (audio)")}${opt(11, "11")}${opt(17, "17")}</select></label>` +
    `<label class="jar-size" title="CheerpJ display size (the Java screen) — grow it if the app's window is clipped">Size ` +
      `<input class="dw" type="number" min="240" max="3840" step="20" value="${w0}" aria-label="display width"> × ` +
      `<input class="dh" type="number" min="180" max="2160" step="20" value="${h0}" aria-label="display height"></label>` +
    `<div class="jar-actions">` +
      `<button class="run" type="button">Run</button>` +
      `<button class="evict" type="button">Evict</button>` +
    `</div>`;
  const sel = el.querySelector(".rt");
  sel.addEventListener("change", () => setJarVersion(meta.name, Number(sel.value)));

  // Adjustable CheerpJ display size, clamped and persisted per jar.
  const dw = el.querySelector(".dw"), dh = el.querySelector(".dh");
  const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.round(Number(v) || dflt)));
  const readSize = () => ({
    w: clamp(dw.value, 240, 3840, DEFAULT_DISP_W),
    h: clamp(dh.value, 180, 2160, DEFAULT_DISP_H),
  });
  const persistSize = () => {
    const { w, h } = readSize();
    dw.value = w; dh.value = h;                 // reflect the clamped values back
    setJarSize(meta.name, w, h);
  };
  dw.addEventListener("change", persistSize);
  dh.addEventListener("change", persistSize);

  el.querySelector(".run").addEventListener("click", () => {
    const { w, h } = readSize();
    openUploadStage(meta.name, meta.name, Number(sel.value), w, h);
  });
  el.querySelector(".evict").addEventListener("click", async () => {
    await removeJar(meta.name);
    await refreshUploads();
  });
  return el;
}

async function renderUsage() {
  if (!navigator.storage?.estimate) { usageEl.textContent = ""; return; }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  usageEl.textContent = quota
    ? `Browser storage: ${formatBytes(usage)} of ~${formatBytes(quota)} used`
    : "";
}
