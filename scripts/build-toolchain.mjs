// Build the IDE toolchain into public/builder/:
//   builder.jar  — compiled from spike/src/Builder.java (the verified compile+jar builder)
//   tools.jar    — OpenJDK 8 compiler (com.sun.tools.javac.Main), the in-browser javac
//
//   node scripts/build-toolchain.mjs
//
// tools.jar is large + gitignored; reuses public/spike/tools.jar if present, else
// downloads Temurin 8 and extracts lib/tools.jar.

import { mkdir, rm, cp, access } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { ROOT, PUBLIC } from "./manifest.mjs";

const BUILDER_DIR = join(PUBLIC, "builder");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

await mkdir(BUILDER_DIR, { recursive: true });

async function ensureToolsJar() {
  const dest = join(BUILDER_DIR, "tools.jar");
  if (await exists(dest)) return dest;
  const spikeCopy = join(PUBLIC, "spike", "tools.jar");
  if (await exists(spikeCopy)) { await cp(spikeCopy, dest); console.log("[toolchain] tools.jar ← public/spike/tools.jar"); return dest; }
  console.log("[toolchain] downloading Temurin 8 JDK for tools.jar …");
  const tgz = "/tmp/javalab-t8jdk.tar.gz";
  execSync(`curl -sS -L -m 300 -o ${tgz} "https://api.adoptium.net/v3/binary/latest/8/ga/linux/x64/jdk/hotspot/normal/eclipse"`);
  const inner = execSync(`tar -tzf ${tgz} | grep -E '/lib/tools\\.jar$' | head -1`).toString().trim();
  execSync(`tar -xzf ${tgz} -C /tmp "${inner}"`);
  await cp(join("/tmp", inner), dest);
  console.log("[toolchain] tools.jar ← Temurin 8");
  return dest;
}

// google-java-format 1.7 (last Java-8-compatible release) for the format action.
async function ensureGjfJar() {
  const dest = join(BUILDER_DIR, "gjf.jar");
  if (await exists(dest)) return dest;
  const spikeCopy = join(PUBLIC, "spike", "gjf.jar");
  if (await exists(spikeCopy)) { await cp(spikeCopy, dest); console.log("[toolchain] gjf.jar ← public/spike/gjf.jar"); return dest; }
  console.log("[toolchain] downloading google-java-format 1.7 …");
  execSync(`curl -sS -L -m 180 -o "${dest}" "https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format/1.7/google-java-format-1.7-all-deps.jar"`);
  console.log("[toolchain] gjf.jar ← Maven Central");
  return dest;
}

const toolsJar = await ensureToolsJar();
await ensureGjfJar();

// builder.jar — Builder.java references com.sun.tools.javac.Main, so compile against tools.jar.
const classesDir = join(BUILDER_DIR, "_classes");
await rm(classesDir, { recursive: true, force: true });
await mkdir(classesDir, { recursive: true });
execFileSync("javac", ["--release", "8", "-cp", toolsJar, "-d", classesDir, join(ROOT, "spike/src/Builder.java")], { stdio: "inherit" });
execFileSync("jar", ["--create", "--file", join(BUILDER_DIR, "builder.jar"), "--main-class", "Builder", "-C", classesDir, "."], { stdio: "inherit" });
await rm(classesDir, { recursive: true, force: true });

console.log("[toolchain] public/builder/{builder.jar, tools.jar} ready");
