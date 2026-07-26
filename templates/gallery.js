// gallery.js — render the curated card matrix and run a card's app in its own
// realm. Data comes from window.JAVALAB_APPS (injected by generate.mjs).
import { openStage } from "./stage.js";
import { escapeHtml, setUrlApp } from "./util.js";

const apps = window.JAVALAB_APPS || [];
const grid = document.getElementById("gallery-grid");

function card(app) {
  const el = document.createElement("button");
  el.className = "card";
  el.type = "button";
  el.setAttribute("role", "listitem");
  el.title = app.description || app.name;
  el.innerHTML =
    `<img class="card-thumb" src="/apps/${app.id}/${app.thumbnail}" alt="" loading="lazy">` +
    `<span class="card-label">${escapeHtml(app.name)}</span>`;
  el.addEventListener("click", () => launchApp(app));
  return el;
}

// Run a curated app in its own realm and stamp its id into the URL, so the
// address bar of a running app is always a shareable deep link.
export function launchApp(app) {
  openStage(app.name, `/apps/${app.id}/index.html`, app.display.w, app.display.h);
  setUrlApp(app.id);
}

// Deep-link entry point (/?app=<id>). False for an id that isn't in the
// manifest — the caller falls back to the plain gallery.
export function launchAppById(id) {
  const app = apps.find((a) => a.id === id);
  if (!app) return false;
  launchApp(app);
  return true;
}

export function renderGallery() {
  grid.replaceChildren(...apps.map(card));
}
