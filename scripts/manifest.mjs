// Shared paths + manifest loader for the build/generate scripts.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PUBLIC = join(ROOT, "public");
export const APPS_OUT = join(PUBLIC, "apps");
export const TEMPLATES = join(ROOT, "templates");
export const JAVA_CEILING = 17;   // CheerpJ's supported Java ceiling

/** Curated app dir by convention: apps/<id>/ (sources in apps/<id>/src). */
export const appDir = (id) => join(ROOT, "apps", id);

export async function readManifest() {
  const m = JSON.parse(await readFile(join(ROOT, "apps.json"), "utf8"));
  return m.apps || [];
}
