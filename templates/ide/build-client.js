// build-client.js — owns the hidden, warm build-realm iframe and the postMessage
// protocol. compile() ships the project to the realm and resolves with
// {ok, rc, diagnostics, jarBytes}. The realm stays warm between builds.
let iframe = null;
let readyPromise = null;
let seq = 0;
const pending = new Map();   // id → resolve

export function initBuildRealm() {
  if (readyPromise) return readyPromise;
  iframe = document.createElement("iframe");
  iframe.src = "/build-realm.html";
  iframe.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;border:0;";
  iframe.title = "JavaLab build realm";
  document.body.appendChild(iframe);

  readyPromise = new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const m = e.data;
      if (!m || m.source !== "javalab-build") return;
      if (m.event === "ready") { resolve(); }
      else if (m.event === "error") { reject(new Error(m.message)); }
      else if (m.event === "build-result" || m.event === "format-result") {
        const fn = pending.get(m.id);
        if (fn) { pending.delete(m.id); fn(m); }
      }
    };
    window.addEventListener("message", onMsg);
  });
  return readyPromise;
}

/** files: [{name, content}] (incl. MANIFEST handled separately), manifest: string */
export async function compile(files, manifest) {
  await initBuildRealm();
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    iframe.contentWindow.postMessage(
      { source: "javalab-ide", type: "build", id, files, manifest }, "*");
  });
}

/** Format one .java file with google-java-format. Resolves {ok, formatted}. */
export async function format(name, content) {
  await initBuildRealm();
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    iframe.contentWindow.postMessage(
      { source: "javalab-ide", type: "format", id, name, content }, "*");
  });
}
