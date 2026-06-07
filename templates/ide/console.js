// console.js — xterm pane for build output, plus javac-diagnostics parsing.
import { Terminal } from "@xterm/xterm";

let term = null;

export function mountConsole(parent) {
  term = new Terminal({
    convertEol: true, rows: 8, fontSize: 12, cursorBlink: false,
    fontFamily: '"Courier New", Courier, monospace',
    theme: {
      background: "#ffffff", foreground: "#101010", cursor: "#101010",
      red: "#b00000", green: "#006b00", yellow: "#9a5b00",
    },
  });
  term.open(parent);
  return term;
}

export const clearConsole = () => term?.clear();
export const writeConsole = (t) => term?.write(t);
export const writeLine = (t) => term?.write(t + "\r\n");

// javac lines look like "/str/Main.java:4: error: cannot find symbol" — but the
// builder prefixes each with "BUILDER-DIAG ", so match the pattern anywhere.
const RE = /\/str\/([^:]+):(\d+): (error|warning): (.*)$/;
export function parseDiagnostics(raw) {
  const out = [];
  for (const line of (raw || "").split("\n")) {
    const m = RE.exec(line.trim());
    if (m) out.push({ file: m[1], line: parseInt(m[2], 10), severity: m[3], message: m[4] });
  }
  return out;
}

/** Print a build result to the terminal; returns the parsed diagnostics. */
export function reportBuild({ ok, rc, diagnostics }) {
  const diags = parseDiagnostics(diagnostics);
  if (!term) return diags;
  if (ok) {
    term.write("\x1b[32mBUILD SUCCESSFUL\x1b[0m\r\n");
  } else {
    if (diags.length === 0) term.write(`\x1b[31mBUILD FAILED (rc=${rc})\x1b[0m\r\n`);
    for (const d of diags) {
      const col = d.severity === "error" ? "31" : "33";
      term.write(`\x1b[${col}m${d.file}:${d.line}: ${d.severity}:\x1b[0m ${d.message}\r\n`);
    }
  }
  return diags;
}
