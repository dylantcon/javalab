// tabs.js — right-panel tab switching (Upload / Write Java), with a programmatic
// switchTab and an activation callback (used to lazy-init the IDE).
let tabs = [], panels = [], onActivate = null;

export function initTabs(activateCb) {
  onActivate = activateCb;
  tabs = [...document.querySelectorAll("#tabbar .tab")];
  panels = [...document.querySelectorAll(".tab-panel")];
  tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
}

export function switchTab(name) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", String(on));
  });
  panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
  onActivate?.(name);
}
