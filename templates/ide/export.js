// export.js — export the project's SOURCES (.java + MANIFEST.MF) as a .zip.
// There is deliberately NO .jar export anywhere (Agent Brief invariant).
import { zipSync, strToU8 } from "fflate";
import * as state from "./state.js";

export function exportZip() {
  const entries = {};
  for (const name of state.listFiles()) entries[name] = strToU8(state.getFile(name) || "");
  const blob = new Blob([zipSync(entries, { level: 6 })], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "javalab-sources.zip";   // sources only
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
