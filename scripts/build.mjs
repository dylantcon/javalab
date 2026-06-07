// Build curated apps from apps.json into public/apps/<id>/.
//
//   node scripts/build.mjs
//
// source=local  → compile sourceDir's .java with `javac --release <javaTarget>`,
//                 package a runnable jar (Main-Class), copy the thumbnail.
// Refuses javaTarget > 17 (the CheerpJ ceiling). submodule/prebuilt: TODO.

import { mkdir, rm, cp, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, APPS_OUT, JAVA_CEILING, appDir, readManifest } from "./manifest.mjs";

async function findJava(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...await findJava(p));
    else if (name.endsWith(".java")) out.push(p);
  }
  return out;
}

async function buildLocal(app, outDir) {
  const srcDir = join(ROOT, app.sourceDir);
  const sources = await findJava(srcDir);
  if (sources.length === 0) throw new Error(`${app.id}: no .java under ${app.sourceDir}`);
  const classesDir = join(outDir, "_classes");
  await rm(classesDir, { recursive: true, force: true });
  await mkdir(classesDir, { recursive: true });
  execFileSync("javac", ["--release", String(app.javaTarget), "-encoding", "UTF-8",
    "-d", classesDir, ...sources], { stdio: "inherit" });
  execFileSync("jar", ["--create", "--file", join(outDir, app.artifact),
    "--main-class", app.mainClass, "-C", classesDir, "."], { stdio: "inherit" });
  await rm(classesDir, { recursive: true, force: true });
}

const apps = await readManifest();
if (apps.length === 0) { console.error("[build] no apps in apps.json"); process.exit(1); }

for (const app of apps) {
  if (app.javaTarget > JAVA_CEILING) {
    console.error(`[build] ${app.id}: javaTarget ${app.javaTarget} > ${JAVA_CEILING} (CheerpJ ceiling) — refusing`);
    process.exit(1);
  }
  const outDir = join(APPS_OUT, app.id);
  await mkdir(outDir, { recursive: true });

  if (app.source === "local") {
    await buildLocal(app, outDir);
  } else {
    console.error(`[build] ${app.id}: source='${app.source}' not implemented yet`);
    process.exit(1);
  }

  if (app.thumbnail) {
    await cp(join(appDir(app.id), app.thumbnail), join(outDir, app.thumbnail));
  }
  console.log(`[build] ${app.id} → ${relative(ROOT, join(outDir, app.artifact))}` +
    ` (javaTarget ${app.javaTarget}, runtime Java ${app.cheerpjVersion})`);
}
console.log(`[build] done — ${apps.length} app(s)`);
