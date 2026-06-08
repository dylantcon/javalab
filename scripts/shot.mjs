// Dev utility: screenshot the generated launcher for visual review.
//   node scripts/shot.mjs            → spike/shot-launcher.png, spike/shot-ide.png
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { PUBLIC } from "./manifest.mjs";
import { createStaticServer, listen } from "./static-server.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const srv = createStaticServer(PUBLIC);
await listen(srv, 8091);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto("http://127.0.0.1:8091/", { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(ROOT, "spike/shot-launcher.png") });
  await page.click('.tab[data-tab="ide"]');
  await page.waitForTimeout(1500);
  await page.locator(".ide-menu-top").first().click().catch(() => {});   // open File menu
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(ROOT, "spike/shot-ide.png") });

  // launch the demo, let it render, maximize, capture
  await page.goto("http://127.0.0.1:8091/", { waitUntil: "load" });
  await page.locator(".card").first().click();
  await page.waitForTimeout(16000);            // CheerpJ load + paint
  await page.click("#stage-max").catch(() => {});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(ROOT, "spike/shot-max.png") });
  console.log("[shot] saved spike/shot-launcher.png, spike/shot-ide.png");
} finally {
  await browser.close().catch(() => {});
  try { execSync("pkill -9 -f chrome-linux/headless_shell", { stdio: "ignore" }); } catch {}
  srv.close();
  process.exit(0);
}
