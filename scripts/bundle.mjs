// Bundle the launcher and the IDE with esbuild into single files (so their
// asset URLs can be cache-busted by ?v=hash — un-versioned ESM imports can't).
//   node scripts/bundle.mjs
//   → public/main.bundle.js  (launcher entry, IIFE)
//   → public/ide.bundle.js   (IDE, IIFE → window.JavaLabIDE) + ide.bundle.css
import { build } from "esbuild";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { TEMPLATES, PUBLIC } from "./manifest.mjs";

await mkdir(PUBLIC, { recursive: true });

await build({
  entryPoints: [join(TEMPLATES, "main.js")],
  bundle: true, format: "iife", outfile: join(PUBLIC, "main.bundle.js"),
  minify: true, sourcemap: false, logLevel: "info",
});

await build({
  entryPoints: [join(TEMPLATES, "ide/index.js")],
  bundle: true, format: "iife", globalName: "JavaLabIDE",
  outfile: join(PUBLIC, "ide.bundle.js"),
  minify: true, sourcemap: false, logLevel: "info",
});

console.log("[bundle] public/main.bundle.js, ide.bundle.js (+ ide.bundle.css)");
