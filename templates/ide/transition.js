// transition.js — a brief y2k "PowerPoint" sweep when a simulation launches,
// covering the move from the editor (Tab 2) to the running app (Tab 1 / stage).
export function playTransition() {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "ide-transition";
    ov.innerHTML = '<span class="ide-transition-label">Simulating...</span>';
    document.body.appendChild(ov);
    let done = false;
    const finish = () => { if (done) return; done = true; ov.remove(); resolve(); };
    ov.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, 1100);   // safety
  });
}
