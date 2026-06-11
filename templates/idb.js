// idb.js — store visitor jars as bytes in IndexedDB (client-only; never POSTed).
// Two stores so listing the library doesn't pull every jar's bytes into memory:
//   meta  : { name, size, added }   ← cheap to list
//   blobs : { name, bytes }         ← read only when running a jar
const DB = "javalab", VERSION = 1, META = "meta", BLOBS = "blobs";

// Default CheerpJ display (the Java "screen") for a jar, in CSS px. CheerpJ
// treats this surface as the whole screen and CLIPS any window larger than it,
// so this is generous; users grow it per-jar from the jar card when an app's
// window is still truncated.
export const DEFAULT_DISP_W = 1280, DEFAULT_DISP_H = 800;

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "name" });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: "name" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const done = (txn) => new Promise((res, rej) => { txn.oncomplete = () => res(); txn.onerror = () => rej(txn.error); txn.onabort = () => rej(txn.error); });
const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function putJar(name, arrayBuffer, version = 17) {
  const db = await open();
  const txn = db.transaction([META, BLOBS], "readwrite");
  txn.objectStore(META).put({ name, size: arrayBuffer.byteLength, added: Date.now(), version,
                              dispW: DEFAULT_DISP_W, dispH: DEFAULT_DISP_H });
  txn.objectStore(BLOBS).put({ name, bytes: arrayBuffer });
  await done(txn);
}

/** Update the chosen CheerpJ runtime version for a stored jar. */
export async function setJarVersion(name, version) {
  const db = await open();
  const meta = await reqP(db.transaction(META, "readonly").objectStore(META).get(name));
  if (!meta) return;
  meta.version = version;
  const txn = db.transaction(META, "readwrite");
  txn.objectStore(META).put(meta);
  await done(txn);
}

/** Update the chosen CheerpJ display size (the Java "screen") for a stored jar. */
export async function setJarSize(name, w, h) {
  const db = await open();
  const meta = await reqP(db.transaction(META, "readonly").objectStore(META).get(name));
  if (!meta) return;
  meta.dispW = w; meta.dispH = h;
  const txn = db.transaction(META, "readwrite");
  txn.objectStore(META).put(meta);
  await done(txn);
}

export async function listJars() {
  const db = await open();
  return reqP(db.transaction(META, "readonly").objectStore(META).getAll());
}

export async function getBytes(name) {
  const db = await open();
  const rec = await reqP(db.transaction(BLOBS, "readonly").objectStore(BLOBS).get(name));
  return rec ? rec.bytes : null;
}

export async function removeJar(name) {
  const db = await open();
  const txn = db.transaction([META, BLOBS], "readwrite");
  txn.objectStore(META).delete(name);
  txn.objectStore(BLOBS).delete(name);
  await done(txn);
}
