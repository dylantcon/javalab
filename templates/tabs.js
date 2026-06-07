// tabs.js — right-panel tab switching (Upload / Write Java).
export function initTabs() {
  const tabs = [...document.querySelectorAll("#tabbar .tab")];
  const panels = [...document.querySelectorAll(".tab-panel")];
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
    });
    panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab));
  }));
}
