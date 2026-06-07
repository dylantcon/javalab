// Generate the static launcher + per-app loader pages from templates + apps.json.
//
//   node scripts/generate.mjs        (run after build.mjs + bundle.mjs)
//
// Writes into public/: index.html (app data injected, assets cache-busted),
// the static JS/CSS, run-upload.html, and public/apps/<id>/index.html per app.
// Leaves public/spike/ (the debug harness) untouched.
//
// CACHE-BUSTING: Cloudflare edge-caches CSS/JS, so each asset URL carries a
// ?v=<hash-of-all-assets> query. A new build → new hash → new URL → CF refetches.

import { readFile, writeFile, mkdir, cp, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PUBLIC, APPS_OUT, TEMPLATES, readManifest } from "./manifest.mjs";

const apps = await readManifest();
await mkdir(PUBLIC, { recursive: true });

// 1. Copy verbatim static assets — every top-level FILE in templates/ except the
//    templated ones. The ide/ directory is skipped (esbuild bundles it).
const TEMPLATED = new Set(["index.html", "app-loader.html", "run-upload.html"]);
for (const name of await readdir(TEMPLATES)) {
  if (TEMPLATED.has(name)) continue;
  const src = join(TEMPLATES, name);
  if ((await stat(src)).isDirectory()) continue;
  await cp(src, join(PUBLIC, name));
}

// 2. Asset version = short hash of all cache-bustable assets (now present in public/).
const ASSETS = ["styles.css", "main.bundle.js", "ide.bundle.js", "ide.bundle.css", "idb.js"];
const h = createHash("sha1");
for (const a of ASSETS) h.update(await readFile(join(PUBLIC, a)).catch(() => Buffer.alloc(0)));
const V = h.digest("hex").slice(0, 10);

// 3. Launcher: inject app data + version all asset URLs.
const clientApps = apps.map((a) => ({
  id: a.id, name: a.name, description: a.description, thumbnail: a.thumbnail, display: a.display,
}));
const dataScript = `<script>window.JAVALAB_APPS=${JSON.stringify(clientApps)};</script>`;
let index = (await readFile(join(TEMPLATES, "index.html"), "utf8"))
  .replace("<!--APPS_DATA-->", dataScript)
  .replaceAll("/styles.css", `/styles.css?v=${V}`)
  .replaceAll("/ide.bundle.css", `/ide.bundle.css?v=${V}`)
  .replaceAll("/ide.bundle.js", `/ide.bundle.js?v=${V}`)
  .replaceAll("/main.bundle.js", `/main.bundle.js?v=${V}`);
await writeFile(join(PUBLIC, "index.html"), index);

// 4. run-upload.html: version its idb.js import (it's a no-cache page, but the
//    imported module is cacheable).
const runUpload = (await readFile(join(TEMPLATES, "run-upload.html"), "utf8"))
  .replaceAll('"/idb.js"', `"/idb.js?v=${V}"`);
await writeFile(join(PUBLIC, "run-upload.html"), runUpload);

// 5. Per-app loader page (jar path, runtime version, display size baked in).
const loaderTpl = await readFile(join(TEMPLATES, "app-loader.html"), "utf8");
for (const app of apps) {
  const out = join(APPS_OUT, app.id);
  await mkdir(out, { recursive: true });
  const page = loaderTpl
    .replaceAll("{{ID}}", app.id)
    .replaceAll("{{NAME}}", app.name)
    .replaceAll("{{JAR}}", app.artifact)
    .replaceAll("{{VERSION}}", String(app.cheerpjVersion))
    .replaceAll("{{W}}", String(app.display.w))
    .replaceAll("{{H}}", String(app.display.h));
  await writeFile(join(out, "index.html"), page);
}

console.log(`[generate] launcher + ${apps.length} loader page(s) → public/  (asset v=${V})`);
