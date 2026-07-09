# JavaLab
JavaLab is a Java 8/11/17 emulator that runs in the web. It only serves static files to users, so standing it up on a server requires little overhead. It's reminiscent of a bygone era, a time when icons had character, and the interface, even with its quirks, felt friendly and inviting.

## Architecture at a glance
Source of truth lives in three places - `apps.json` (the curated app manifest), `templates/` (page HTML + the launcher/IDE JavaScript), and `apps/<id>/` (each app's prebuilt jar, thumbnail, and any sources). The build pipeline compiles these into `public/`, which is the *only* directory served in production (static files behind nginx). Nothing in `public/` is edited by hand - always rebuild.

## Administrative control scripts
All scripts live in `scripts/` and are plain Node ESM (`node scripts/<x>.mjs`). The ones you run routinely are wrapped as `npm run` targets in `package.json`.

### Build pipeline - regenerating `public/`
Run these (in order) after changing `apps.json`, a jar/thumbnail under `apps/`, or anything in `templates/`. The convenience wrapper `npm run site` runs all four back-to-back.

| Command | Script | What it does |
| --- | --- | --- |
| `npm run build` | `build.mjs` | Builds every app in `apps.json` into `public/apps/<id>/`. `source:"local"` compiles the app's `.java` with `javac --release <javaTarget>` and packages a runnable jar; `source:"prebuilt"` copies the committed jar. Also copies each thumbnail. Refuses `javaTarget > 17` (the CheerpJ ceiling). |
| `npm run toolchain` | `build-toolchain.mjs` | Builds the in-browser IDE toolchain into `public/builder/`: `builder.jar` (compile+jar builder), `jlformat.jar` (Format action), `tools.jar` (OpenJDK 8 `javac`), and `gjf.jar` (google-java-format). `tools.jar` is large + gitignored - it reuses `public/spike/tools.jar` if present, else downloads Temurin 8 and extracts `lib/tools.jar`. |
| `npm run bundle` | `bundle.mjs` | esbuild-bundles the launcher (`templates/main.js` -> `public/main.bundle.js`) and the IDE (`templates/ide/index.js` -> `public/ide.bundle.js` + `ide.bundle.css`) into single minified IIFE files, so their asset URLs can be cache-busted. |
| `npm run generate` | `generate.mjs` | Generates the static site from `templates/` + `apps.json`: `public/index.html` (app data injected), per-app loader pages, and verbatim static assets. Appends `?v=<hash>` to every CSS/JS/jar/thumbnail URL so Cloudflare's edge cache refetches after a rebuild. Run last. |
| `npm run site` | - | `build && toolchain && bundle && generate` - a full clean rebuild of `public/`. |

`scripts/manifest.mjs` is a shared helper (repo paths + `apps.json` loader) imported by the pipeline scripts; it is not run directly.

### Serving locally
| Command | Script | What it does |
| --- | --- | --- |
| `npm run serve` | `serve.mjs` | Serves `public/` at `http://127.0.0.1:8088`, mirroring nginx incl. HTTP Range (CheerpJ requires Range for jars). `PORT=` / `VERBOSE=1` override. Preview only. |
| - | `static-server.mjs` | The Range-capable static file server shared by `serve.mjs` and the e2e harnesses. Not run directly. |

### Verification & testing (headless Chromium via Playwright)
| Command | Script | What it does |
| --- | --- | --- |
| `npm run e2e` | `e2e.mjs` | Full end-to-end check: launcher loads, gallery card renders + launches a real Swing app (asserted by pixels), "<- Gallery" teardown, `.jar` upload runs from IndexedDB, and - critically - verifies no network request ever carries jar bytes (privacy). Has an unconditional hard-deadline kill-switch. |
| `npm run verify:editor` | `verify-editor.mjs` | Fast IDE-only check (no CheerpJ): editor<->state sync, New Simulation scaffold + modal, two-way file/class name sync, custom New/Rename/Delete modals, About modal. Fails if any native `prompt`/`confirm`/`alert` fires. |
| `npm run spike` | `run-spike.mjs` | Drives the in-browser `jdk.compiler` spike harness across Java runtimes (`node scripts/run-spike.mjs 17,11,8 ecj`) and scrapes the pass/fail verdict. Has an unconditional global deadline that SIGKILLs wedged browsers (a hung CheerpJ renderer can otherwise outlive Playwright's own cleanup). Exit 0 if any runtime passes, 1 if none, 3 on the hard deadline. |

### Dev utilities (not npm-wrapped)
| Script | What it does |
| --- | --- |
| `scripts/smoke-live.mjs [url]` | Smoke-tests a *deployed* URL (default `https://javalab.dconn.dev`): loads it, launches the first gallery app, and confirms CheerpJ renders it over the wire. |
| `scripts/shot.mjs` | Screenshots the generated launcher + IDE for visual review (`spike/shot-launcher.png`, `spike/shot-ide.png`). |

## Deployment config
`nginx/javalab.conf` is the production nginx server block (static `public/` root, HTTP Range, cache headers). `lib/ecj-3.26.0.jar` is a bundled Eclipse compiler kept for the spike. `devlog/` holds dated development notes.
