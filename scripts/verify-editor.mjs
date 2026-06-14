// Focused, fast check for the editor↔state sync + modal/naming work (no CheerpJ
// realms). Covers:
//   - the editor↔state reload fix (New Simulation actually resets the editor)
//   - the MainLauncher default scaffold
//   - the retro New Simulation modal (named main class)
//   - two-way name sync (rename file → class+manifest; edit class → file)
//   - New file / Rename / Delete via the custom modal (no native dialogs)
//   - the About modal
// FAILS if any native prompt/confirm/alert fires (proves the conversion).
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { PUBLIC } from "./manifest.mjs";
import { createStaticServer, listen } from "./static-server.mjs";

const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}`;
const log = (s) => process.stdout.write(s + "\n");
const pkill = () => { try { execSync("pkill -9 -f chrome-linux/headless_shell", { stdio: "ignore" }); } catch {} };
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

const hard = setTimeout(() => { log("\n[verify] HARD DEADLINE — forcing exit"); pkill(); process.exit(3); }, 90_000);

const srv = createStaticServer(PUBLIC);
await listen(srv, PORT);
log(`[verify] server up at ${BASE}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
// Any native dialog is a regression — record it and dismiss so we don't hang.
let nativeDialogs = 0;
page.on("dialog", (d) => { nativeDialogs++; d.dismiss().catch(() => {}); });

const editorText = () => page.evaluate(() => document.querySelector("#ide .cm-content")?.innerText ?? null);
const files = () => page.evaluate(() => window.__ideDebug.files());
const modalOpen = () => page.locator(".ide-modal-overlay").count().then((n) => n > 0);
const fillModal = (v) => page.fill(".ide-modal-input", v);
const clickModal = (label) => page.locator(".ide-modal-btn", { hasText: new RegExp(`^${label}$`) }).first().click();

try {
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 30_000 });
  await page.click('.tab[data-tab="ide"]');
  await page.waitForSelector("#ide .cm-editor", { timeout: 20_000 });

  // 1) MainLauncher default scaffold
  const f0 = await files();
  check("scaffold = MainLauncher.java + MANIFEST.MF", !!f0["MainLauncher.java"] && /Main-Class:\s*MainLauncher/.test(f0["MANIFEST.MF"] || ""), Object.keys(f0).join(","));
  check("editor shows the scaffold on load", (await editorText())?.includes("public class MainLauncher"));

  // 2) Edit in place, then New Simulation must RESET the editor (the original fix)
  await page.click("#ide .cm-content");
  await page.keyboard.type("// scratch\n");
  check("typing flows into state", (await files())["MainLauncher.java"]?.includes("// scratch"));

  await page.click("#tb-new");                              // opens the retro modal
  check("New Simulation opens a custom modal (default MainLauncher)",
    (await modalOpen()) && (await page.inputValue(".ide-modal-input")) === "MainLauncher");
  await fillModal("Experiment");
  await clickModal("OK");
  const f1 = await files();
  check("New Simulation scaffolds the named class", !!f1["Experiment.java"] && /public class Experiment/.test(f1["Experiment.java"]) && /Main-Class:\s*Experiment/.test(f1["MANIFEST.MF"]), Object.keys(f1).join(","));
  check("New Simulation resets the EDITOR (no stale '// scratch')",
    (await editorText())?.includes("public class Experiment") && !(await editorText())?.includes("scratch"));

  // 3) New Simulation cancel leaves the project untouched
  await page.click("#tb-new");
  await clickModal("Cancel");
  check("New Simulation cancel is a no-op", !!(await files())["Experiment.java"]);

  // 4) Two-way sync, code→filename: rename the class in source → file + manifest follow
  await page.evaluate(() => window.__ideDebug.setEditor("public class Renamed {\n    public static void main(String[] a){}\n}\n"));
  const renamed = await page.waitForFunction(() => {
    const f = window.__ideDebug.files();
    return f["Renamed.java"] && !f["Experiment.java"] && /Main-Class:\s*Renamed/.test(f["MANIFEST.MF"] || "");
  }, undefined, { timeout: 5_000 }).then(() => true).catch(() => false);
  check("editing the public class name renames the file + Main-Class", renamed, Object.keys(await files()).join(","));
  check("editor keeps the edited content after the auto-rename", (await editorText())?.includes("public class Renamed"));
  check("tab strip reflects the renamed file", await page.locator("#ide-tabs .ide-tab", { hasText: "Renamed.java" }).count() > 0);

  // 5) New file via modal
  await page.click("#ide-sidebar-files .ide-mini");
  await fillModal("Helper.java");
  await clickModal("OK");
  check("New file (modal) creates Helper.java with a matching class", /public class Helper/.test((await files())["Helper.java"] || ""));

  // 6) Two-way sync, filename→code: rename file → public class decl + nothing else broken
  //    (the rename/delete buttons are hover-revealed, so hover the row first)
  const fileRow = (name) => page.locator(".ide-file", { hasText: name });
  await fileRow("Helper.java").hover();
  await fileRow("Helper.java").locator(".ide-file-act[title='Rename']").click();
  await fillModal("Gadget.java");
  await clickModal("OK");
  const f2 = await files();
  check("renaming the file rewrites its public class", !!f2["Gadget.java"] && /public class Gadget/.test(f2["Gadget.java"]) && !f2["Helper.java"], Object.keys(f2).join(","));

  // 7) Delete via modal confirm
  await fileRow("Gadget.java").hover();
  await fileRow("Gadget.java").locator(".ide-file-act[title='Delete']").click();
  await clickModal("Delete");
  check("Delete (modal) removes the file", !(await files())["Gadget.java"]);

  // 8) About modal via Help menu
  await page.locator(".ide-menu-top", { hasText: "Help" }).click();
  await page.locator('button[data-act="about"]').click();
  check("About opens the custom modal", await page.locator(".ide-modal-title", { hasText: "About JavaLab" }).count() > 0);
  await clickModal("OK");
  check("About closes on OK", !(await modalOpen()));

  // 9) No native dialogs anywhere
  check("no native prompt/confirm/alert used", nativeDialogs === 0, `${nativeDialogs} native dialogs`);
} catch (e) {
  check("verify run completed without error", false, e.message);
} finally {
  await browser.close().catch(() => {});
  pkill();
  srv.close();
  clearTimeout(hard);
}

const passed = results.filter((r) => r.ok).length;
log(`\n================ VERIFY: ${passed}/${results.length} passed ================`);
process.exit(passed === results.length ? 0 : 1);
