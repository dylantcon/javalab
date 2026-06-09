// End-to-end check for Phase 1 (foundation + gallery + upload), headless.
// Spawns scripts/serve.mjs, drives Chromium through the launcher, and verifies:
//   1. launcher loads + the curated card renders
//   2. gallery grid is an internal scroll pane (overflow + overscroll-contain)
//   3. clicking the card launches the app realm and the Swing app RENDERS
//      (screenshot → the panel's indigo pixels)
//   4. "← Gallery" tears the realm down
//   5. upload a .jar → it lands in IndexedDB + the list, and RUNS in a realm
//   6. NO network request carries jar bytes (no POST/PUT; jar name never sent)
//
// Unconditional hard-deadline kill-switch, like run-spike.mjs.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import { PUBLIC } from "./manifest.mjs";
import { createStaticServer, listen } from "./static-server.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const JAR = join(ROOT, "public/apps/swing-demo/swing-demo.jar");
const SOUNDJAR = join(ROOT, "public/spike/soundthread.jar");   // Java-8 SourceDataLine probe
const SHOT = (n) => join(ROOT, `spike/e2e-${n}.png`);
const GLOBAL_MS = 360_000;   // IDE flow loads two CheerpJ realms (build + run)
const log = (s) => process.stdout.write(s + "\n");
const pkill = () => { try { execSync("pkill -9 -f chrome-linux/headless_shell", { stdio: "ignore" }); } catch {} };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

// Load a screenshot buffer into a fresh canvas and count pixels near `rgb`.
// Count pixels matching the Bounce panel's indigo (#1a1a40) with a TIGHT
// tolerance — distinct from white (the CheerpJ splash) and the #222/#06141d
// loading states, so polling waits PAST the splash until the app truly paints.
const PANEL = [0x1a, 0x1a, 0x40];
const countPanel = (page, b64) => page.evaluate(async ({ s, p }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + s; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4)
    if (Math.abs(d[i] - p[0]) < 14 && Math.abs(d[i + 1] - p[1]) < 14 && Math.abs(d[i + 2] - p[2]) < 14) n++;
  return n;
}, { s: b64, p: PANEL });

// Poll the DISPLAY element until the app's indigo panel appears (past the splash).
async function waitForRender(page, selector, shotPath, tries = 38) {
  let panel = 0;
  for (let i = 0; i < tries && panel <= 3000; i++) {
    const buf = await page.locator(selector).screenshot({ path: shotPath }).catch(() => null);
    if (buf) panel = await countPanel(page, buf.toString("base64")).catch(() => 0);
    if (panel <= 3000) await new Promise((r) => setTimeout(r, 1500));
  }
  return panel;
}

const hard = setTimeout(() => { log(`\n[e2e] HARD DEADLINE ${GLOBAL_MS}ms — forcing exit`); pkill(); process.exit(3); }, GLOBAL_MS);

// ---- in-process static server (no child process → nothing to orphan) ----
const srv = createStaticServer(PUBLIC);
await listen(srv, PORT);
log(`[e2e] server up at ${BASE}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
const requests = [];
const downloads = [];
page.on("request", (r) => requests.push({ method: r.method(), url: r.url(), postData: r.postData() || "" }));
page.on("download", (d) => downloads.push(d.suggestedFilename()));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Helper" : undefined));

async function waitForFrameConsole(text, urlPart, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const fr of page.frames()) {
      if (!fr.url().includes(urlPart)) continue;
      const txt = await fr.evaluate(() => document.getElementById("console")?.innerText || "").catch(() => "");
      if (txt.includes(text)) return true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

try {
  // 1. launcher + card
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 30_000 });
  const cardText = await page.locator(".card .card-label").first().innerText().catch(() => "");
  check("launcher renders curated card", cardText.trim() === "Bounce", `label="${cardText.trim()}"`);

  // 2. gallery is an internal scroll pane
  const scroll = await page.evaluate(() => {
    const g = getComputedStyle(document.getElementById("gallery-grid"));
    return { oy: g.overflowY, ob: g.overscrollBehaviorY || g.overscrollBehavior };
  });
  check("gallery grid contains its own scroll", scroll.oy === "auto" && /contain/.test(scroll.ob), JSON.stringify(scroll));

  // 3. launch the curated app → Swing renders (indigo panel #1a1a40)
  await page.locator(".card").first().click();
  const stageShown = await page.evaluate(() => !document.getElementById("stage").hidden && document.querySelector("#stage-host iframe") != null);
  check("clicking card opens the stage with a realm iframe", stageShown);
  const panel = await waitForRender(page, "#stage-host", SHOT("gallery"));
  check("curated Swing app actually renders (indigo panel past the splash)", panel > 3000, `panel px=${panel}`);

  // 3a. the (non-maximized) stage stays inside its gallery column — it must not
  //     spill across the splitter onto the sandbox tabs (#stage needs a positioned
  //     containing block, else absolute inset:0 escapes to the viewport).
  const confined = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const st = r("#stage"), tb = r("#tabbar"), fr = document.querySelector("#stage-host iframe").getBoundingClientRect();
    const noTouch = (a) => a.right <= tb.left + 1;   // stage + scaled canvas stay left of the tabs
    return noTouch(st) && noTouch(fr);
  });
  check("running app stays in its column (no overlap with the sandbox tabs)", confined);

  // 3b. Maximize fills the viewport (stage goes fixed-fullscreen, display scales)
  await page.click("#stage-max");
  const maxed = await page.evaluate(() => document.getElementById("stage").classList.contains("is-max") && /scale\(/.test(document.querySelector("#stage-host iframe").style.transform || ""));
  check("Maximize fills the viewport (scaled display)", maxed);
  await page.click("#stage-max");   // restore

  // 4. close tears the realm down
  await page.locator("#stage-back").click();
  const closed = await page.evaluate(() => document.getElementById("stage").hidden && document.querySelector("#stage-host iframe") == null && !document.getElementById("gallery-grid").hidden);
  check("'← Gallery' removes the realm and restores the grid", closed);

  // 5. upload a jar → stored + listed + runs
  await page.setInputFiles("#file-input", JAR);
  await page.waitForSelector("#upload-list .jar-card", { timeout: 10_000 });
  const listed = await page.locator("#upload-list .jar-name").first().innerText();
  check("uploaded jar appears in the IndexedDB-backed list", listed.includes("swing-demo.jar"), `name="${listed}"`);
  const persisted = await page.evaluate(async () => {
    // confirm bytes are actually in IndexedDB (not just the DOM)
    const db = await new Promise((res) => { const r = indexedDB.open("javalab", 1); r.onsuccess = () => res(r.result); });
    return await new Promise((res) => { const rq = db.transaction("blobs").objectStore("blobs").get("swing-demo.jar"); rq.onsuccess = () => res(!!rq.result && rq.result.bytes.byteLength > 0); });
  });
  check("jar bytes persisted in IndexedDB", persisted);

  check("uploaded Java-8 jar auto-selects the Java 8 runtime (for audio)",
    await page.locator("#upload-list .jar-card .rt").first().inputValue() === "8");

  await page.locator("#upload-list .jar-actions .run").first().click();
  const panel2 = await waitForRender(page, "#stage-host", SHOT("upload"));
  check("uploaded jar actually runs in a fresh realm (indigo panel past the splash)", panel2 > 3000, `panel px=${panel2}`);

  // 5b. audio: a Java-8 jar runs on Java 8 so SourceDataLine actually works
  //     (CheerpJ 4.3 has no audio on 11/17 — the whole reason we detect+pin the runtime)
  await page.locator("#stage-back").click();
  await page.setInputFiles("#file-input", SOUNDJAR);
  await page.waitForFunction(
    () => [...document.querySelectorAll("#upload-list .jar-name")].some((n) => n.textContent.includes("soundthread.jar")),
    undefined, { timeout: 10_000 });
  const sndRt = await page.evaluate(() => {
    const card = [...document.querySelectorAll("#upload-list .jar-card")].find((c) => c.querySelector(".jar-name")?.textContent.includes("soundthread.jar"));
    card?.querySelector(".jar-actions .run")?.click();
    return card?.querySelector(".rt")?.value;
  });
  check("Java-8 jar auto-detected as Java 8 and gets WORKING audio (AUDIO-RESULT ok)",
    sndRt === "8" && await waitForFrameConsole("AUDIO-RESULT ok", "run-upload", 90_000), `runtime=${sndRt}`);

  // ===== Tab 2: the mini-IDE =====
  await page.locator("#stage-back").click();
  await page.click('.tab[data-tab="ide"]');
  await page.waitForSelector("#ide .cm-editor", { timeout: 20_000 });
  check("IDE mounts (CodeMirror) on the Write Java tab", true);

  const files0 = await page.evaluate(() => window.__ideDebug.files());
  check("scaffold = HelloWorld.java + MANIFEST.MF", !!files0["HelloWorld.java"] && !!files0["MANIFEST.MF"]);

  // editor → state
  await page.click("#ide .cm-content");
  await page.keyboard.type("// hi\n");
  const files1 = await page.evaluate(() => window.__ideDebug.files());
  check("typing in the editor updates file state", (files1["HelloWorld.java"] || "").includes("// hi"));

  // Simulate the valid scaffold → compiles, stores jar, runs in a fresh realm
  await page.evaluate(() => { window.__ideLastBuild = null; });
  await page.click("#tb-run");
  await page.waitForFunction(() => window.__ideLastBuild, undefined, { timeout: 120_000 });
  const okBuild = await page.evaluate(() => window.__ideLastBuild);
  check("Simulate compiles the project (ok)", okBuild.ok === true, "rc=" + okBuild.rc);
  const builtStored = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open("javalab", 1); r.onsuccess = () => res(r.result); });
    return await new Promise((res) => { const rq = db.transaction("blobs").objectStore("blobs").get("HelloWorld.jar"); rq.onsuccess = () => res(!!rq.result); });
  });
  check("built jar stored in the library (HelloWorld.jar)", builtStored);
  // simulate switches to Tab 1, plays the transition, then opens the run realm
  const ranStage = await page.waitForSelector('#stage-host iframe[src*="run-upload"]', { timeout: 15_000 }).then(() => true).catch(() => false);
  check("Simulate runs the built jar in a fresh stage realm", ranStage);
  check("simulated program's stdout shows in the run console", await waitForFrameConsole("Hello from JavaLab!", "run-upload", 90_000));

  // compile error → diagnostics; then recover
  await page.locator("#stage-back").click();
  await page.click('.tab[data-tab="ide"]');
  await page.evaluate(() => window.__ideDebug.setFile("HelloWorld.java", 'public class HelloWorld { public static void main(String[] a){ int x = "oops"; } }'));
  await page.evaluate(() => { window.__ideLastBuild = null; });
  await page.click("#tb-save");
  await page.waitForFunction(() => window.__ideLastBuild, undefined, { timeout: 120_000 });
  const errBuild = await page.evaluate(() => window.__ideLastBuild);
  check("compile error → build fails with diagnostics", errBuild.ok === false && errBuild.diags.length > 0, JSON.stringify(errBuild.diags?.[0] || {}));

  await page.evaluate(() => window.__ideDebug.setFile("HelloWorld.java", 'public class HelloWorld { public static void main(String[] a){ System.out.println("ok"); } }'));
  await page.evaluate(() => { window.__ideLastBuild = null; });
  await page.click("#tb-save");
  await page.waitForFunction(() => window.__ideLastBuild, undefined, { timeout: 120_000 });
  check("realm recovers after a compile error", (await page.evaluate(() => window.__ideLastBuild.ok)) === true);

  // Vim toggle
  await page.click("#tb-vim");
  check("Vim toggle enables vim mode", await page.evaluate(() => window.__ideDebug.isVim() && document.querySelector("#tb-vim").classList.contains("is-on")));
  await page.click("#tb-vim");

  // file explorer add (.java via prompt dialog)
  await page.click("#ide-sidebar-files .ide-mini");
  check("file explorer adds a new .java", await page.evaluate(() => !!window.__ideDebug.files()["Helper.java"]));

  // manifest form ↔ MANIFEST.MF
  await page.fill("#mf-main", "Demo");
  check("manifest form writes Main-Class to MANIFEST.MF", /Main-Class:\s*Demo/.test(await page.evaluate(() => window.__ideDebug.files()["MANIFEST.MF"] || "")));

  // format action → google-java-format reflows the code (on the selected file)
  await page.locator("#ide-tabs .ide-tab", { hasText: "HelloWorld.java" }).first().click();
  await page.evaluate(() => window.__ideDebug.setEditor('public class HelloWorld{public static void main(String[]a){System.out.println("x");}}'));
  await page.evaluate(() => { window.__ideDebug.format(); });   // fire (don't await the ~cold gjf run)
  const formatted = await page.waitForFunction(() => /\n {2}\S/.test(window.__ideDebug.files()["HelloWorld.java"] || ""), undefined, { timeout: 60_000 }).then(() => true).catch(() => false);
  check("format action reflows code (google-java-format)", formatted);

  // source export → .zip (never .jar)
  await page.click("#tb-export");
  await page.waitForTimeout(600);
  check("source export downloads a .zip", downloads.some((f) => f.endsWith(".zip")), downloads.join(","));

  // 6. boundary: no POST, no off-origin jar bytes, no .jar download anywhere
  const writes = requests.filter((r) => ["POST", "PUT", "PATCH"].includes(r.method));
  const leak = requests.filter((r) => !r.url.startsWith(BASE) && /swing-demo\.jar|HelloWorld\.jar/.test(r.url + r.postData));
  check("no upload/build endpoint hit (no POST/PUT/PATCH)", writes.length === 0, `${writes.length} writes`);
  check("jar bytes never sent off-origin", leak.length === 0, `${leak.length} leaks`);
  check("no .jar download anywhere", !downloads.some((f) => f.endsWith(".jar")), downloads.join(","));
} catch (e) {
  check("e2e run completed without error", false, e.message);
} finally {
  await browser.close().catch(() => {});
  pkill();
  srv.close();
  clearTimeout(hard);
}

const passed = results.filter((r) => r.ok).length;
log(`\n================ E2E: ${passed}/${results.length} passed ================`);
process.exit(passed === results.length ? 0 : 1);
