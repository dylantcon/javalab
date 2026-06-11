// gallery.js — render the curated card matrix and run a card's app in its own
// realm. Data comes from window.JAVALAB_APPS (injected by generate.mjs).
import { openStage } from "./stage.js";
import { escapeHtml } from "./util.js";

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
  el.addEventListener("click", () =>
    openStage(app.name, `/apps/${app.id}/index.html`, app.display.w, app.display.h));
  return el;
}

export function renderGallery() {
  grid.replaceChildren(...apps.map(card));
}
