// ide.js — orchestrator: the Save/Simulate verbs (Agent Brief §6). Compiles via
// the build realm, surfaces diagnostics (console + inline), stores the built jar
// in the visitor's library, and runs it in a fresh realm.
import * as state from "./state.js";
import { compile } from "./build-client.js";
import { reportBuild, clearConsole, writeLine } from "./console.js";
import { showDiagnostics } from "./editor.js";
import { playTransition } from "./transition.js";

let ctx = null;   // bridge to Phase 1: { putJar, refreshUploads, switchToUpload, openStage }
export function setContext(c) { ctx = c; }

const mainClass = () => { const m = /Main-Class:\s*(.+)/.exec(state.getFile("MANIFEST.MF") || ""); return m ? m[1].trim() : "Main"; };
const jarName = () => (mainClass().split(".").pop() || "simulation") + ".jar";

/** Compile + (on success) store the jar in the library. Returns {ok, jarName?}. */
export async function saveSimulation() {
  clearConsole();
  writeLine("Compiling...");
  const files = state.javaFiles().map((name) => ({ name, content: state.getFile(name) }));
  if (files.length === 0) { writeLine("\x1b[31mNo .java files to compile.\x1b[0m"); return { ok: false }; }
  const manifest = state.getFile("MANIFEST.MF") || `Main-Class: ${mainClass()}\n`;

  const result = await compile(files, manifest);
  const diags = reportBuild(result);
  showDiagnostics(diags);
  window.__ideLastBuild = { ok: !!result.ok, rc: result.rc, diags };   // e2e hook

  if (result.ok && result.jarBytes) {
    const name = jarName();
    await ctx?.putJar(name, result.jarBytes, 8);   // builder emits Java 8 bytecode -> run on 8 (audio works)
    ctx?.refreshUploads?.();
    writeLine(`\x1b[36mSaved ${name} to your library.\x1b[0m`);
    return { ok: true, jarName: name };
  }
  return { ok: false };
}

/** Save, then run the built jar in a fresh realm (with the y2k transition). */
export async function simulate() {
  const r = await saveSimulation();
  if (!r.ok) return;
  ctx?.switchToUpload?.();
  await playTransition();
  ctx?.openStage?.(r.jarName, "/run-upload.html?key=" + encodeURIComponent(r.jarName) + "&w=820&h=600&version=8", 820, 600);
}
