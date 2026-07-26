// Small shared helpers.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Address-bar sync for deep links (/?app=<id>). Every curated app is linkable —
// the [Live] links on dconn.dev point straight at one, and the visitor lands on
// the launcher with it already running — so whatever sits on the stage is
// reflected in the URL, and tearing the stage down clears the param.
// replaceState, not pushState: launching an app isn't a navigation, and Back
// should return the visitor to wherever they came from.
export function setUrlApp(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("app", id);
  else url.searchParams.delete("app");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
