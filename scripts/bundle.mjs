// Bundle the IDE (CodeMirror 6 + xterm + fflate + our modules) with esbuild into
// public/ide.bundle.js (IIFE → window.JavaLabIDE) + public/ide.bundle.css.
//   node scripts/bundle.mjs
import { build } from "esbuild";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { TEMPLATES, PUBLIC } from "./manifest.mjs";

await mkdir(PUBLIC, { recursive: true });
await build({
  entryPoints: [join(TEMPLATES, "ide/index.js")],
  bundle: true,
  format: "iife",
  globalName: "JavaLabIDE",
  outfile: join(PUBLIC, "ide.bundle.js"),
  minify: true,
  sourcemap: false,
  logLevel: "info",
});
console.log("[bundle] public/ide.bundle.js (+ ide.bundle.css)");
