// leftpanel.js — the left column's tabs (Gallery | Viewer). The Viewer holds the
// run "stage"; unlike before, it's a real tab you can open any time (it just sits
// empty when nothing is running). stage.js drives it via showViewer/showGallery.
let ltabs = [], lpanels = [];

export function initLeftTabs() {
  ltabs = [...document.querySelectorAll("#left-tabs .tab")];
  lpanels = [...document.querySelectorAll(".ltab-panel")];
  ltabs.forEach((t) => t.addEventListener("click", () => switchLeft(t.dataset.ltab)));
}

export function switchLeft(name) {
  ltabs.forEach((t) => {
    const on = t.dataset.ltab === name;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", String(on));
  });
  lpanels.forEach((p) => p.classList.toggle("is-active", p.dataset.lpanel === name));
}

export const showViewer = () => switchLeft("viewer");
export const showGallery = () => switchLeft("gallery");
