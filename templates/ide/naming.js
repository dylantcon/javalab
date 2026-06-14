// naming.js — Java identifier + public-type helpers shared by the file explorer
// (rename refactor, direction 1) and the editor (code→filename sync, direction 2).
// Pure string helpers only; no state/DOM access.

// A top-level `public [final|abstract|strictfp]* (class|interface|enum) <Ident>`.
// javac requires the file to be named <Ident>.java, which is the whole point of
// the two-way sync. Modifiers are captured as one group so a rewrite preserves
// them. (Java-8 toolchain: no sealed/record.)
const PUBLIC_TYPE_RE = /\bpublic\s+((?:(?:final|abstract|strictfp)\s+)*)(class|interface|enum)\s+([A-Za-z_$][\w$]*)/;

const RESERVED = new Set(
  ("abstract assert boolean break byte case catch char class const continue default do double else enum extends " +
   "final finally float for goto if implements import instanceof int interface long native new package private " +
   "protected public return short static strictfp super switch synchronized this throw throws transient try void " +
   "volatile while true false null").split(" ")
);

/** True if `n` is a legal Java identifier usable as a class name. */
export const isValidClassName = (n) => /^[A-Za-z_$][\w$]*$/.test(n || "") && !RESERVED.has(n);

/** "Foo.java" → "Foo"; "Foo" → "Foo". */
export const baseName = (file) => (file || "").replace(/\.java$/, "");

/** Append ".java" if missing; null/empty → null. */
export const ensureJava = (n) => { const t = (n || "").trim(); return t ? (t.endsWith(".java") ? t : t + ".java") : null; };

/** Name of the file's top-level public type, or null if none. */
export function publicTypeName(src) {
  const m = PUBLIC_TYPE_RE.exec(src || "");
  return m ? m[3] : null;
}

/** Rename the public type's *declaration* to `newName` (modifiers/kind kept).
 *  Only the declaration is touched — constructors/references are left to the
 *  user (in the code→filename direction they're already editing the source). */
export function rewritePublicClass(src, newName) {
  return (src || "").replace(PUBLIC_TYPE_RE, (_w, mods = "", kind) => "public " + (mods || "") + kind + " " + newName);
}

/** If MANIFEST.MF's Main-Class is `oldBase`, return it pointing at `newBase`;
 *  otherwise return the manifest unchanged. */
export function renameMainClass(manifest, oldBase, newBase) {
  const cur = (/Main-Class:\s*(.+)/.exec(manifest || "") || [])[1];
  return cur && cur.trim() === oldBase ? "Main-Class: " + newBase + "\n" : manifest;
}
