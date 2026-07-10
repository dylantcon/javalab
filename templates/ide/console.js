// console.js — xterm pane for build output, plus javac-diagnostics parsing.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

let term = null;

export function mountConsole(parent) {
  term = new Terminal({
    convertEol: true, fontSize: 12, cursorBlink: false,
    fontFamily: '"Courier New", Courier, monospace',
    theme: {
      background: "#ffffff", foreground: "#101010", cursor: "#101010",
      red: "#b00000", green: "#006b00", yellow: "#9a5b00", cyan: "#005b8c",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(parent);
  const refit = () => { try { fit.fit(); } catch (e) {} };
  refit();
  new ResizeObserver(refit).observe(parent);
  return term;
}

export const clearConsole = () => term?.clear();
export const writeConsole = (t) => term?.write(t);
export const writeLine = (t) => term?.write(t + "\r\n");

// javac emits diagnostics as multi-line BLOCKS, e.g.
//   /str/Main.java:4: error: cannot find symbol
//           foo();
//           ^
//     symbol:   method foo()
//     location: class Main
//   1 error
// The header line carries file:line:severity:message; the indented lines that
// follow (source snippet, caret, symbol/location notes) are the DETAIL. We keep
// the whole block so the console can print real javac output and the inline
// linter can show the detail in its tooltip + point at the caret column.
const HEADER = /^\/str\/([^:]+):(\d+): (error|warning): (.*)$/;
const SUMMARY = /^\d+ (errors?|warnings?)$/;

export function parseDiagnostics(raw) {
  const lines = (raw || "").replace(/\r/g, "").split("\n");
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      cur = { file: m[1], line: parseInt(m[2], 10), severity: m[3], message: m[4], detailLines: [] };
      out.push(cur);
    } else if (cur && SUMMARY.test(line.trim())) {
      cur = null;                                  // summary line ends the current block
    } else if (cur && line.trim() !== "") {
      cur.detailLines.push(line);                  // source snippet / caret / symbol / location
    }
  }
  // Derive the caret COLUMN (1-based) from the "^" line and flatten the detail.
  for (const d of out) {
    let col = null;
    for (const dl of d.detailLines) {
      const caret = dl.indexOf("^");
      if (caret >= 0 && dl.slice(0, caret).trim() === "") { col = caret + 1; break; }
    }
    d.col = col;
    d.detail = d.detailLines.join("\n");
    delete d.detailLines;
  }
  return out;
}

// Print javac's output VERBATIM (minus the internal /str/ VFS prefix, which isn't
// a real path the user knows) so it reads exactly like a javac console — caret,
// symbol/location notes, "N errors" summary and all. Colorize per line.
function writeRawJavac(raw) {
  for (const line of raw.split("\n")) {
    const shown = line.replace(/\/str\//g, "");
    let colored = shown;
    if (/: error:/.test(shown)) colored = `\x1b[31m${shown}\x1b[0m`;         // red header
    else if (/: warning:/.test(shown)) colored = `\x1b[33m${shown}\x1b[0m`;  // yellow header
    else if (/^\s*\^\s*$/.test(shown)) colored = `\x1b[36m${shown}\x1b[0m`;  // caret
    else if (SUMMARY.test(shown.trim())) colored = `\x1b[1m${shown}\x1b[0m`; // bold summary
    term.write(colored + "\r\n");
  }
}

/** Print a build result to the terminal; returns the parsed diagnostics. */
export function reportBuild({ ok, rc, diagnostics }) {
  const diags = parseDiagnostics(diagnostics);
  if (!term) return diags;
  const raw = (diagnostics || "").replace(/\r/g, "").replace(/\n+$/, "");
  if (raw) writeRawJavac(raw);
  const errs = diags.filter((d) => d.severity === "error").length;
  const warns = diags.filter((d) => d.severity === "warning").length;
  const warnTail = warns ? `  \x1b[33m(${warns} warning${warns > 1 ? "s" : ""})\x1b[0m` : "";
  if (ok) {
    term.write(`\x1b[32mBUILD SUCCESSFUL\x1b[0m${warnTail}\r\n`);
  } else if (errs) {
    term.write(`\x1b[31mBUILD FAILED\x1b[0m — ${errs} error${errs > 1 ? "s" : ""}${warnTail}\r\n`);
  } else {
    term.write(`\x1b[31mBUILD FAILED (rc=${rc})\x1b[0m\r\n`);   // crash / no diagnostics
  }
  return diags;
}
