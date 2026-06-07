// Generate the static launcher + per-app loader pages from templates + apps.json.
//
//   node scripts/generate.mjs        (run after scripts/build.mjs)
//
// Writes into public/: index.html (with app data injected), the static JS/CSS
// assets, run-upload.html, and public/apps/<id>/index.html per curated app.
// Leaves public/spike/ (the debug harness) untouched.

import { readFile, writeFile, mkdir, cp, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { PUBLIC, APPS_OUT, TEMPLATES, readManifest } from "./manifest.mjs";

const apps = await readManifest();
await mkdir(PUBLIC, { recursive: true });

// 1. Copy verbatim static assets — every top-level FILE in templates/ except the
//    two that need substitution. The ide/ directory is skipped (esbuild bundles
//    it to public/ide.bundle.js); ide.bundle.{js,css} are produced by bundle.mjs.
const TEMPLATED = new Set(["index.html", "app-loader.html"]);
for (const name of await readdir(TEMPLATES)) {
  if (TEMPLATED.has(name)) continue;
  const src = join(TEMPLATES, name);
  if ((await stat(src)).isDirectory()) continue;
  await cp(src, join(PUBLIC, name));
}

// 2. Launcher: inject the client-facing app data.
const clientApps = apps.map((a) => ({
  id: a.id, name: a.name, description: a.description, thumbnail: a.thumbnail, display: a.display,
}));
const dataScript = `<script>window.JAVALAB_APPS=${JSON.stringify(clientApps)};</script>`;
const index = (await readFile(join(TEMPLATES, "index.html"), "utf8"))
  .replace("<!--APPS_DATA-->", dataScript);
await writeFile(join(PUBLIC, "index.html"), index);

// 3. Per-app loader page (jar path, runtime version, display size baked in).
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

console.log(`[generate] launcher + ${apps.length} loader page(s) → public/`);
