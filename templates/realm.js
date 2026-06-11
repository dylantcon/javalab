// realm.js — launch / tear down a CheerpJ realm in an iframe inside a host
// element. Each app (or uploaded jar) gets its OWN iframe; removing it destroys
// the runtime (threads, audio lines, static singletons) — the clean-room
// guarantee from Agent Brief §4. No shared-runtime jar swapping.

export function launchRealm(host, url, w, h) {
  host.replaceChildren();
  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.width = String(w);
  iframe.height = String(h);
  iframe.className = "realm-frame";
  // The host is display:flex, so a flex item would SHRINK its width to the host
  // on a narrow (mobile) viewport while keeping its height — squishing the square
  // display into a portrait box and truncating it. flex:none pins the iframe at
  // its native w×h; the stage's transform (fit()) does the uniform scaling.
  iframe.style.flex = "none";
  iframe.title = "Java app runtime";
  host.appendChild(iframe);
  return iframe;
}

export function closeRealm(host) {
  host.replaceChildren();   // drop the iframe → realm gone
}
