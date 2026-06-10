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
const ASSETS = ["styles.css", "main.bundle.js", "ide.bundle.js", "ide.bundle.css", "idb.js", "cheerpj-shim.js"];
const h = createHash("sha1");
for (const a of ASSETS) h.update(await readFile(join(PUBLIC, a)).catch(() => Buffer.alloc(0)));
const V = h.digest("hex").slice(0, 10);

// Per-file content hash for cache-busting jars + thumbnails. The global asset
// hash V only changes when CSS/JS change, but jars/thumbnails change on their own
// (a rebuilt app jar, a refreshed screenshot) and are served with a 1-year
// immutable Cache-Control — so each must carry a ?v=<hash-of-its-own-bytes> or
// Cloudflare serves the stale copy forever.
const fileHash = async (p) =>
  createHash("sha1").update(await readFile(p).catch(() => Buffer.alloc(0))).digest("hex").slice(0, 10);

// 3. Launcher: inject app data (thumbnails content-hashed) + version asset URLs.
const clientApps = await Promise.all(apps.map(async (a) => ({
  id: a.id, name: a.name, description: a.description, display: a.display,
  thumbnail: `${a.thumbnail}?v=${await fileHash(join(APPS_OUT, a.id, a.thumbnail))}`,
})));
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
  // Relay apps (app.relay): load the cheerpj-shim.js natives, register them with
  // cheerpjInit, force the browser transport (javalab.browser=true), and pass
  // --browser to the jar. The javalabrelay classes are bundled into the app jar,
  // so a single cheerpjRunJar suffices. Non-relay apps get the plain init/run.
  const jarUrl = `/app/apps/${app.id}/${app.artifact}?v=${await fileHash(join(out, app.artifact))}`;
  const init = app.relay
    ? `{ version: ${app.cheerpjVersion}, status: "none", natives: javalabRelayNatives, javaProperties: ["javalab.browser=true"] }`
    : `{ version: ${app.cheerpjVersion}, status: "none" }`;
  const run = app.relay
    ? `await cheerpjRunJar("${jarUrl}", "--browser");`
    : `await cheerpjRunJar("${jarUrl}");`;
  const shim = app.relay ? `<script src="/cheerpj-shim.js?v=${V}"></script>\n` : "";
  const page = loaderTpl
    .replaceAll("{{ID}}", app.id)
    .replaceAll("{{NAME}}", app.name)
    .replaceAll("{{W}}", String(app.display.w))
    .replaceAll("{{H}}", String(app.display.h))
    .replace("{{SHIM}}", shim)
    .replace("{{INIT}}", init)
    .replace("{{RUN}}", run);
  await writeFile(join(out, "index.html"), page);
}

console.log(`[generate] launcher + ${apps.length} loader page(s) → public/  (asset v=${V})`);
