// Headless runner for the JavaLab jdk.compiler spike (Agent Brief §6 gate).
//
// Serves public/ as the web root (so CheerpJ's /app/spike maps to public/spike),
// then drives a headless Chromium through the spike page for each requested Java
// runtime and scrapes the verdict from the console stream.
//
//   node scripts/run-spike.mjs 17,11,8 ecj
//   node scripts/run-spike.mjs 8 ecj
//   PER_MS=300000 GLOBAL_MS=420000 node scripts/run-spike.mjs 8 ecj
//
// TERMINATION GUARANTEE (the reason this file got rewritten): a CheerpJ run can
// peg the renderer so hard that Playwright's own cleanup (page/browser close)
// hangs, blowing past per-step timeouts. So there is an UNCONDITIONAL global
// deadline that SIGKILLs every launched browser and process.exit()s — the run
// can never outlive GLOBAL_MS. Each version also runs in its OWN browser so a
// wedged one is force-killed without poisoning the next.
//
// Exit 0 if at least one runtime PASSes, 1 if none, 3 if the hard deadline hit.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { chromium } from "playwright";

// Playwright's Browser exposes no PID, so force-kill by binary name. This runner
// owns every headless_shell it launches; nothing else here uses it.
function pkillChromium() {
  try { execSync("pkill -9 -f chrome-linux/headless_shell", { stdio: "ignore" }); } catch {}
}

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".class": "application/octet-stream", ".jar": "application/java-archive",
};

const versions = (process.argv[2] || "17,11,8").split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
const mode = ["ecj", "probe", "javac", "builder", "diag", "hasjavac", "loop", "guidemo", "audio", "console", "extract", "format", "runaudio"].includes(process.argv[3]) ? process.argv[3] : "system";
const COI = process.env.COI === "1";   // when set, serve COOP/COEP (cross-origin isolation)
const coiHdr = COI ? { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } : {};
const CONSOLE_SHOT = fileURLToPath(new URL("../spike/console-screenshot.png", import.meta.url));
const SHOT = fileURLToPath(new URL("../spike/gui-screenshot.png", import.meta.url));
const NAV_MS = parseInt(process.env.NAV_MS || "60000", 10);
const PER_MS = parseInt(process.env.PER_MS || "180000", 10);          // per-version cap
const GLOBAL_MS = parseInt(process.env.GLOBAL_MS || String(PER_MS * versions.length + 120000), 10);

const log = (s) => process.stdout.write(s + "\n");                    // unbuffered, line at a time

// CheerpJ reads jars via HTTP Range requests, so the server MUST honour them.
const reqStat = { count: 0, lastUrl: "" };
function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      reqStat.count++; reqStat.lastUrl = req.url;
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = normalize(join(ROOT, p));
        if (!fp.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
        const buf = await readFile(fp);
        const ct = MIME[extname(fp)] || "application/octet-stream";
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (m) {
          let start = m[1] === "" ? null : parseInt(m[1], 10);
          let end = m[2] === "" ? null : parseInt(m[2], 10);
          if (start === null) { start = Math.max(0, buf.length - end); end = buf.length - 1; }
          else if (end === null || end >= buf.length) { end = buf.length - 1; }
          if (start > end || start >= buf.length) {
            res.writeHead(416, { "Content-Range": `bytes */${buf.length}` }).end(); return;
          }
          const chunk = buf.subarray(start, end + 1);
          res.writeHead(206, {
            "Content-Type": ct, "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Content-Length": chunk.length,
            ...coiHdr,
          });
          res.end(chunk); return;
        }
        res.writeHead(200, { "Content-Type": ct, "Accept-Ranges": "bytes", "Content-Length": buf.length, ...coiHdr });
        res.end(buf);
      } catch (e) {
        res.writeHead(404).end("not found: " + e.message);
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const withDeadline = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} exceeded ${ms}ms`)), ms)),
]);


const srv = await startServer();
const base = `http://127.0.0.1:${srv.address().port}`;
log(`[runner] serving ${ROOT} at ${base}`);
log(`[runner] versions=${versions.join(",")} mode=${mode} PER_MS=${PER_MS} GLOBAL_MS=${GLOBAL_MS}`);

// UNCONDITIONAL kill-switch. Not unref'd: it WILL fire while async work is
// pending (all our hangs are I/O-bound awaits, so the event loop stays live).
const hard = setTimeout(() => {
  log(`\n[runner] !!! HARD DEADLINE ${GLOBAL_MS}ms EXCEEDED — SIGKILL all browsers, forcing exit(3)`);
  pkillChromium();
  process.exit(3);
}, GLOBAL_MS);

const BOOT = process.env.BOOT || "";       // optional -bootclasspath jar (ecj mode)
const TOOLS = process.env.TOOLS || "";     // hasjavac: "0" drops the bundled tools.jar

async function runVersion(v) {
  const url = `${base}/spike/index.html?version=${v}&mode=${mode}`
    + (BOOT ? `&boot=${encodeURIComponent(BOOT)}` : "")
    + (TOOLS ? `&tools=${encodeURIComponent(TOOLS)}` : "");
  log(`\n[runner] ===== Java ${v} (mode=${mode}) =====`);
  const t0 = Date.now();
  const lines = [];
  let browser, beat;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
    const page = await browser.newPage();
    page.on("console", (m) => {
      const s = `${m.type()}: ${m.text()}`.trim();
      lines.push(s);
      if (/SPIKE|HELLO|PROBE|BUILDER|LOOP|GUI|THREAD|AUDIO|CONSOLE|EXTRACT|FORMAT|jrt|Exception|Error|error:|warning:/.test(s)) log(`      | ${s}`); // live progress
    });
    page.on("pageerror", (e) => { lines.push(`pageerror: ${e.message}`); log(`      | pageerror: ${e.message}`); });

    // Heartbeat: shows whether CheerpJ is still actively fetching (progress) or
    // genuinely wedged (request count flat) — distinguishes slow from deadlocked.
    let lastCount = 0;
    beat = setInterval(() => {
      const d = reqStat.count - lastCount; lastCount = reqStat.count;
      log(`      ~ [${((Date.now() - t0) / 1000).toFixed(0)}s] http reqs=${reqStat.count} (+${d}/5s) last=${reqStat.lastUrl}`);
    }, 5000);
    beat.unref?.();

    await page.goto(url, { waitUntil: "load", timeout: NAV_MS });
    await withDeadline(
      page.waitForFunction(() => window.__spike && window.__spike.done === true, undefined, { timeout: PER_MS }),
      PER_MS + 5000, `v${v} waitForFunction`);

    const joined = lines.join("\n");
    const exitM = /SPIKE-EXIT (\d+)/.exec(joined);
    let result =
      /SPIKE-RESULT PASS/.test(joined) || /SPIKE-EXIT 0\b/.test(joined) ? "PASS"
      : /SPIKE-RESULT FAIL/.test(joined) || (exitM && exitM[1] !== "0") ? "FAIL"
      : /PROBE-END/.test(joined) ? "DONE" : "NO-RESULT";

    // loop mode: also verify each rerun's stdout reflects the EDIT — every
    // "LOOP-EXPECT <tag> <expected>" must have a matching LOOP-OUT line. Stale
    // class/jar caching would make iter2 still print iter1's output → MISMATCH.
    if (mode === "loop") {
      const bodies = lines.map((s) => s.replace(/^\w+: /, ""));
      const expects = bodies.filter((s) => s.startsWith("LOOP-EXPECT "));
      let allMatched = expects.length > 0;
      for (const e of expects) {
        const expected = e.split(" ").slice(2).join(" ");       // drop "LOOP-EXPECT <tag>"
        const matched = bodies.some((s) => s.startsWith("LOOP-OUT") && s.includes(expected));
        log(`      = ${matched ? "MATCH" : "MISMATCH"}: ${e}`);
        if (!matched) allMatched = false;
      }
      if (result === "PASS" && !allMatched) result = "FAIL";
    }
    if (mode === "guidemo") {
      // CheerpJ's display canvas isn't readable via in-page getImageData, but the
      // Playwright screenshot captures the true composited pixels. Poll screenshots
      // until the panel's crimson appears (paint latency varies), analysing each by
      // loading it into a fresh canvas (Chromium decodes it; a data: image IS
      // readable) and counting crimson pixels.
      const analyze = async (b64) => page.evaluate(async (s) => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + s; });
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let hit = 0;
        for (let i = 0; i < d.length; i += 4)
          if (Math.abs(d[i] - 220) < 40 && Math.abs(d[i + 1] - 20) < 40 && Math.abs(d[i + 2] - 60) < 40) hit++;
        return { w: img.width, h: img.height, hit };
      }, b64);
      let g = { hit: 0, w: 0, h: 0 };
      for (let tries = 0; tries < 20 && g.hit <= 500; tries++) {
        const buf = await page.screenshot({ path: SHOT }).catch(() => null);
        if (buf) g = await analyze(buf.toString("base64")).catch(() => ({ hit: 0, w: 0, h: 0 }));
        if (g.hit <= 500) await new Promise((r) => setTimeout(r, 1500));
      }
      log(`      . screenshot crimson px=${g.hit} (${g.w}x${g.h}) -> ${SHOT}`);
      result = g.hit > 500 ? "PASS" : "FAIL";   // authoritative for guidemo
    }
    if (mode === "console") {
      await page.screenshot({ path: CONSOLE_SHOT }).then(() => log(`      . screenshot -> ${CONSOLE_SHOT}`)).catch(() => {});
    }
    log(`  [v${v}] ${result}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return { version: v, result, lines };
  } catch (e) {
    log(`  [v${v}] TIMEOUT/ERROR after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message}`);
    return { version: v, result: "ERROR", error: e.message, lines };
  } finally {
    if (beat) clearInterval(beat);
    // Guaranteed teardown: try graceful close briefly, then force-kill. Versions
    // run sequentially, so killing all chromium here can't harm a needed browser.
    if (browser) await withDeadline(browser.close(), 5000, "browser.close").catch(() => {});
    pkillChromium();
  }
}

const results = [];
for (const v of versions) results.push(await runVersion(v));

clearTimeout(hard);
srv.close();

log("\n================= SPIKE MATRIX =================");
for (const r of results) {
  const tag = r.result === "PASS" ? "PASS ✓" : r.result === "FAIL" ? "FAIL ✗" : r.result;
  log(`  Java ${String(r.version).padEnd(2)} : ${tag}${r.error ? "  (" + r.error + ")" : ""}`);
}
log("===============================================");

pkillChromium();
process.exit(results.some((r) => r.result === "PASS") ? 0 : 1);
