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
const SHOT = (n) => join(ROOT, `spike/e2e-${n}.png`);
const GLOBAL_MS = 180_000;
const log = (s) => process.stdout.write(s + "\n");
const pkill = () => { try { execSync("pkill -9 -f chrome-linux/headless_shell", { stdio: "ignore" }); } catch {} };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

// Load a screenshot buffer into a fresh canvas and count pixels near `rgb`.
const countColor = (page, b64, rgb, tol = 44) => page.evaluate(async ({ s, rgb, tol }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + s; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let hit = 0;
  for (let i = 0; i < d.length; i += 4)
    if (Math.abs(d[i] - rgb[0]) < tol && Math.abs(d[i + 1] - rgb[1]) < tol && Math.abs(d[i + 2] - rgb[2]) < tol) hit++;
  return hit;
}, { s: b64, rgb, tol });

// Poll screenshots until `rgb` appears (paint latency), or timeout. Saves last shot.
async function waitForColor(page, rgb, shotPath, tries = 24) {
  let hit = 0;
  for (let i = 0; i < tries && hit <= 400; i++) {
    const buf = await page.screenshot({ path: shotPath }).catch(() => null);
    if (buf) hit = await countColor(page, buf.toString("base64"), rgb).catch(() => 0);
    if (hit <= 400) await new Promise((r) => setTimeout(r, 1500));
  }
  return hit;
}

const hard = setTimeout(() => { log(`\n[e2e] HARD DEADLINE ${GLOBAL_MS}ms — forcing exit`); pkill(); process.exit(3); }, GLOBAL_MS);

// ---- in-process static server (no child process → nothing to orphan) ----
const srv = createStaticServer(PUBLIC);
await listen(srv, PORT);
log(`[e2e] server up at ${BASE}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
const requests = [];
page.on("request", (r) => requests.push({ method: r.method(), url: r.url(), postData: r.postData() || "" }));

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
  const indigo = await waitForColor(page, [0x1a, 0x1a, 0x40], SHOT("gallery"));
  check("curated Swing app renders (indigo panel pixels)", indigo > 400, `px=${indigo}`);

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

  await page.locator("#upload-list .jar-actions .run").first().click();
  const indigo2 = await waitForColor(page, [0x1a, 0x1a, 0x40], SHOT("upload"));
  check("uploaded jar runs in a fresh realm (indigo pixels)", indigo2 > 400, `px=${indigo2}`);

  // 6. boundary: nothing POSTed the jar; jar name never left the origin
  const writes = requests.filter((r) => ["POST", "PUT", "PATCH"].includes(r.method));
  const leak = requests.filter((r) => !r.url.startsWith(BASE) && /swing-demo\.jar/.test(r.url + r.postData));
  check("no upload endpoint hit (no POST/PUT/PATCH)", writes.length === 0, `${writes.length} writes`);
  check("jar bytes never sent off-origin", leak.length === 0, `${leak.length} leaks`);
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
