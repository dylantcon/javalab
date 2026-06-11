// Smoke-test a DEPLOYED JavaLab URL: load it, launch the first gallery app, and
// confirm CheerpJ actually renders it (the panel's indigo pixels) over the wire.
//   node scripts/smoke-live.mjs [https://javalab.dconn.dev]
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const URL_ = process.argv[2] || "https://javalab.dconn.dev";
const SHOT = join(ROOT, "spike/live-gallery.png");
const log = (s) => process.stdout.write(s + "\n");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 760 });
  log("[live] loading " + URL_);
  await page.goto(URL_, { waitUntil: "load", timeout: 30000 });
  const card = await page.locator(".card .card-label").first().innerText().catch(() => "");
  log("[live] gallery card = " + JSON.stringify(card));
  await page.locator(".card").first().click();

  // Count the Bounce panel's indigo (#1a1a40) tightly — distinct from the white
  // CheerpJ splash and the dark loading states, so we wait PAST the splash.
  const countPanel = (b64) => page.evaluate(async (s) => {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = "data:image/png;base64," + s; });
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (Math.abs(d[i] - 0x1a) < 14 && Math.abs(d[i + 1] - 0x1a) < 14 && Math.abs(d[i + 2] - 0x40) < 14) n++;
    return n;
  }, b64);

  let panel = 0;
  for (let i = 0; i < 38 && panel <= 3000; i++) {
    const buf = await page.locator("#stage-host").screenshot({ path: SHOT }).catch(() => null);
    if (buf) panel = await countPanel(buf.toString("base64")).catch(() => 0);
    if (panel <= 3000) await new Promise((r) => setTimeout(r, 1500));
  }
  await page.screenshot({ path: SHOT.replace("live-gallery", "live-page") }).catch(() => {});
  log(`[live] display panel px=${panel} -> ${SHOT}`);
  log(panel > 3000 ? "[live] PASS — CheerpJ renders the demo app live ✓" : "[live] FAIL — app did not render past the splash");
} finally {
  await browser.close().catch(() => {});
  try { execSync("pkill -9 -f chrome-linux/headless_shell", { stdio: "ignore" }); } catch {}
  process.exit(0);
}
