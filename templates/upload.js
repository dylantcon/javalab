// upload.js — Tab 1: read a .jar via the File API, keep its BYTES in IndexedDB
// (never uploaded), list/run/evict the local library. Running launches a fresh
// realm that reads the jar back from IndexedDB. No server endpoint is involved.
import { putJar, listJars, removeJar } from "./idb.js";
import { openStage } from "./stage.js";
import { escapeHtml, formatBytes } from "./util.js";

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
    await putJar(f.name, buf);
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
  const el = document.createElement("div");
  el.className = "jar-card";
  el.setAttribute("role", "listitem");
  el.innerHTML =
    `<div class="jar-name">${escapeHtml(meta.name)}</div>` +
    `<div class="jar-meta">${formatBytes(meta.size)}</div>` +
    `<div class="jar-actions">` +
      `<button class="run" type="button">Run</button>` +
      `<button class="evict" type="button">Evict</button>` +
    `</div>`;
  el.querySelector(".run").addEventListener("click", () =>
    openStage(meta.name, `/run-upload.html?key=${encodeURIComponent(meta.name)}`, 700, 520));
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
