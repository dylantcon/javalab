// Central IDE state: the project's files (name → content) + current selection,
// with a tiny pub/sub. Editors/explorer/manifest-form all read and mutate this.
const listeners = new Set();
const files = new Map();
let current = null;

const emit = () => listeners.forEach((fn) => fn());

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const listFiles = () => [...files.keys()];
export const getFile = (name) => files.get(name);
export const getCurrent = () => current;
export const hasFile = (name) => files.has(name);

// Editor content edits pass {silent:true} (no list re-render; selection unchanged).
export function setFile(name, content, { silent = false } = {}) {
  files.set(name, content);
  if (!silent) emit();
}

export function selectFile(name) {
  if (files.has(name) && name !== current) { current = name; emit(); }
}

export function newFile(name, content = "") {
  if (files.has(name)) return false;
  files.set(name, content);
  current = name;
  emit();
  return true;
}

export function deleteFile(name) {
  if (!files.has(name)) return;
  files.delete(name);
  if (current === name) current = files.size ? [...files.keys()][0] : null;
  emit();
}

export function renameFile(oldName, newName) {
  if (!files.has(oldName) || files.has(newName)) return false;
  // preserve order: rebuild the map
  const entries = [...files.entries()].map(([n, c]) => [n === oldName ? newName : n, c]);
  files.clear();
  for (const [n, c] of entries) files.set(n, c);
  if (current === oldName) current = newName;
  emit();
  return true;
}

export function reset(initial) {
  files.clear();
  for (const [n, c] of Object.entries(initial)) files.set(n, c);
  current = Object.keys(initial)[0] || null;
  emit();
}

/** Java source files only (excludes MANIFEST.MF). */
export const javaFiles = () => listFiles().filter((n) => n.endsWith(".java"));

/** Plain snapshot of {name: content} — used by the e2e harness. */
export const snapshot = () => Object.fromEntries(files);
