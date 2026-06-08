# JavaLab — Tab 2 compiler gate: spike findings

**Date:** 2026-06-07 · **CheerpJ:** 4.3 (latest, released 2026-04-23) · **Method:** headless
Chromium driving the real CheerpJ runtime; fully reproducible via
`node scripts/run-spike.mjs <versions> <mode>`.

## TL;DR — GATE PASSES (with the right recipe)

In-browser compilation **works** and Tab 2 is **viable**. But not the way the
brief assumed:

- `ToolProvider.getSystemJavaCompiler()` returns **null on every runtime** — the
  brief's literal spike can never pass.
- Bundling **ECJ** also fails: on a full `rt.jar` it is *pathologically slow*
  under CheerpJ's interpreter (renderer pegged at ~116% CPU, no completion in
  4 min) — not a deadlock, just unusable.
- **The working recipe (JavaFiddle's, now empirically confirmed):** invoke the
  **JVM's built-in javac directly** — `cheerpjRunMain("com.sun.tools.javac.Main",
  …)` — with a bundled `tools.jar` on the classpath. javac uses CheerpJ's fast
  *native* platform-class path (not `ZipFile` reads of `rt.jar`), so it's quick.
  **Cold compile ~13 s, warm recompile ~4.5 s** (Java 8, hello-world).

This was always Tab-2-only; the curated gallery and Tab 1 upload→run (running
precompiled jars) work on all runtimes regardless.

## The recipe (canonical for Tab 2 / builder)

```js
// CheerpJ Java 8 realm. Bundle tools.jar at /app/<path>/tools.jar.
const cp = "/app/spike/tools.jar:/files/";
cheerpOSAddStringFile("/str/Main.java", source);          // sources in /str (in-memory)
const cc = await cheerpjRunMain("com.sun.tools.javac.Main", // the REAL javac
  cp, "/str/Main.java", "-d", "/files/", "-Xlint");        // classes out to /files
if (cc === 0) await cheerpjRunMain("Main", cp);            // run the compiled class
```

- `tools.jar` = OpenJDK/Temurin **8** `lib/tools.jar` (18 MB; jdk8u492 matches
  CheerpJ's `1.8.0_492` runtime). Loaded by CheerpJ's classloader (fast path) —
  do NOT have the program open it via `ZipFile`.
- Sources → `/str` (JS→Java, in-memory). Classes → `/files` (writable, on the
  classpath so the compiled class is runnable).
- diagnostics come back as javac text (`/str/X.java:line: error: msg`) — parse
  for the console pane (JavaFiddle's `linter.ts` does exactly this).
- UX: cold first compile ~13 s (one-time warmup); subsequent ~4.5 s. Mitigate
  with `cheerpjInit({preloadResources})` and keeping the IDE realm warm.
- The IDE realm runs Java 8; curated apps (Javarominoes, Java 17) run in their
  own realms — fine, since each app already gets a fresh runtime.

Source of recipe: leaningtech/javafiddle `src/lib/CheerpJ.svelte`.
Reproduce: `node scripts/run-spike.mjs 8 javac`.

## Verification round 2 — builder pipeline, diagnostics, 11/17 (all confirmed)

Every previously-untested assumption behind Tab 2 / the §6 builder is now proven
in-browser (Java 8, headless):

| Item | Test | Result |
|---|---|---|
| Multi-file + packages | `Builder.java` compiles `com.example.Main` + `com.example.util.Greeter` (cross-package call, Java-8 stream) | ✅ `node scripts/run-spike.mjs 8 builder` |
| §6 builder (in-process javac + MANIFEST.MF → jar) | `com.sun.tools.javac.Main.compile()` in-process, then `java.util.jar` packages classes+manifest → `/files/app.jar`, which then **runs** (`BUILDER-RAN hello JavaLab`) | ✅ (cold build ~20 s) |
| Compile diagnostics format | bad source → `/str/Bad.java:3: error: incompatible types: …` — matches JavaFiddle `linter.ts` regex exactly | ✅ `... 8 diag` |
| Native compiler on 11/17 | `com.sun.tools.javac.Main` with NO bundled tools.jar | ❌ `ClassNotFoundException` on **8/11/17** — compiler must always be bundled; Java 8 + Temurin 8 tools.jar is the proven path. `... 8,11,17 hasjavac` (TOOLS=0) |

Key constraints discovered:
- **`/str` is FLAT** — no directory trees ("CheerpOS: Directories are not
  supported"). Put sources flat in `/str`; javac reads the `package` from file
  content and still emits the correct package tree under `-d /files/classes`.
- **No runtime exposes the compiler on the classpath** (not even 11/17's
  `jdk.compiler`) — bundling `tools.jar` is mandatory, so the IDE realm = Java 8.

### Builder pieces (in repo)
- `spike/src/Builder.java` → `public/spike/builder.jar` (compile against
  `public/spike/tools.jar`). args: `<outDir> <jarOut> <manifest> <src…>`.
- Run: `cheerpjRunMain("Builder", "/app/spike/builder.jar:/app/spike/tools.jar",
  "/files/classes", "/files/app.jar", "/str/MANIFEST.MF", "/str/Main.java", …)`.

## Verification round 3 — single-realm simulate loop (confirmed)

The real IDE `simulate` loop, proven in ONE persistent realm (one `cheerpjInit`,
4 build→run cycles, reusing the SAME `/files/app.jar` path + same class name).
`node scripts/run-spike.mjs 8 loop`:

| Property | Evidence | ✅ |
|---|---|---|
| javac stays warm across builds | build times: iter1 **14.9 s cold** → iter2 **5.7 s** → iter3 4.5 s → iter4 **5.0 s** | ✅ |
| Edits take effect on rerun (no stale class/jar cache) | iter2 edited `Main` to print `6*7` → rerun printed `LOOP-OUT 42` (not the iter1 value), same jar path | ✅ |
| Compile error surfaces + does not run | iter3 broken → `rc=1`, full diagnostic w/ caret + `1 error`, no execution | ✅ |
| Realm recovers after a compile error | iter4 fixed → compiled + ran `LOOP-OUT recovered` | ✅ |

Conclusion: the entire §6 authoring loop (edit → `saveSimulation` → `simulate`
→ edit → …) works in a single warm realm. First build ~15 s (one-time warmup);
each subsequent build ~5 s. Caveat: re-running in the SAME realm is fine for
console programs (cheerpjRunJar picked up new bytecode every time); for curated
apps / student programs that spawn daemon threads or audio lines (the §4
isolation case), still launch each *run* in a fresh realm to avoid thread/audio
leakage — compilation stays in the warm IDE realm.

## Verification round 4 — Swing GUI render (confirmed)

`node scripts/run-spike.mjs 8 guidemo`: a Swing app (`JFrame` + crimson `JPanel`
+ `JLabel` + `JButton`) **compiled in-browser** via the builder, run, and
rendered through `cheerpjCreateDisplay(360,240,div)`. Verified by headless
screenshot (`spike/gui-screenshot.png`): the JFrame draws correctly — crimson
panel (**61 058** matching pixels), white "GUI-OK" label, "Click me" button.
✅ — and it works with **NO COOP/COEP** cross-origin isolation.

Gotchas locked in:
- **CheerpJ's display canvas is NOT readable via in-page `getImageData`** (returns
  blank). To inspect GUI output programmatically, use a Playwright/CDP screenshot,
  not canvas readback. (Analyze the screenshot by loading it into a fresh canvas —
  a `data:` image IS readable.)
- GUI programs don't `System.exit`; `cheerpjRunJar` is fire-and-forget. Paint
  latency varies — poll the screenshot until content appears, don't use a fixed
  delay.
- CheerpJ free tier stamps a "PERSONAL AND NON-BUSINESS USE ONLY" watermark on
  the display (licensing note for the owner).

## Verification round 5 — audio + threads, COOP/COEP question (resolved)

`node scripts/run-spike.mjs 8 audio` — a program compiled in-browser that spawns
a daemon thread AND opens a `SourceDataLine` to write a 440 Hz tone (exactly
Javarominoes' synth pattern). Run with `crossOriginIsolated=false` (NO COOP/COEP):

- `THREAD-RESULT ran=true` — daemon thread ran + joined; **concurrency works**.
- `AUDIO-SUPPORTED true`, `AUDIO-OPEN ok`, `AUDIO-WROTE 8820`, `AUDIO-RESULT ok`
  — the `SourceDataLine` opened and accepted audio with **no LineUnavailableException**.

> **CRITICAL (round 5b): audio is Java 8 ONLY.** Re-ran a PRE-BUILT Java-8 audio
> jar across runtimes (`run-spike.mjs <ver> runaudio`, `public/spike/soundthread.jar`):
> - Java **8**  → `AUDIO-SUPPORTED true` … `AUDIO-RESULT ok` (exit 0). ✅
> - Java **11** → `AUDIO-SUPPORTED false` → `IllegalArgumentException: No line
>   matching interface SourceDataLine … is supported` (exit 11). ❌
> - Java **17** → same failure as 11 (exit 11). ❌
> Threads still work on all three. CheerpJ 4.3 only ships the audio mixer on the
> Java 8 runtime. **Consequence:** any jar that wants `SourceDataLine` MUST run on
> Java 8 (and therefore be Java-8 bytecode). The launcher now auto-detects each
> jar's bytecode major version and pins the runtime (≤52→8, ≤55→11, else 17), so
> plain Java-8 jars get audio automatically; a per-jar selector overrides it. The
> IDE compiles Java 8, so its simulations run on Java 8 and keep audio. Curated
> apps that need both audio AND Java-17 language features are impossible on CheerpJ
> 4.3 — pick one (e.g. backport Javarominoes to Java 8 to keep its synth).

**Resolution of the brief's biggest deployment unknown: cross-origin isolation
is NOT required.** Threads and the audio pipeline both initialise without it. So:
- **Do NOT set COOP/COEP** on the `javalab` nginx block — avoids the CDN
  CORP/COEP friction the brief warned about entirely; use the CheerpJ CDN as-is.
- No need to self-host the runtime for isolation reasons.
- (Headless has no speakers, so this proves API init + buffer write, not audible
  output. Real browsers gate `AudioContext` on a user gesture — naturally
  satisfied by the click-to-launch interaction. The runner used
  `--autoplay-policy=no-user-gesture-required` for the headless check.)
- A COI variant is available behind `COI=1` (serves COOP/COEP) if isolation is
  ever wanted for other reasons — untested, would need the loader `crossorigin`
  + CDN CORS handling.

## Verification round 6 — xterm.js console pane (confirmed)

`node scripts/run-spike.mjs 8 console`: compiled+ran a program printing to
`System.out` AND `System.err`; captured into a styled xterm.js pane.

- **CheerpJ natively writes Java stdout AND stderr into `<pre id="console">`** if
  that element exists — no `System.setOut`/`setErr`, no natives. (JavaFiddle:
  "CheerpJ implicitly looks for a #console to write to.")
- A `MutationObserver` on `#console` mirrors new text live into an `xterm.js`
  Terminal (rendered + verified by screenshot `spike/console-screenshot.png`).
- Captured exactly, in order, incl. a partial-line `print()`:
  `CONSOLE-OUT-1 hello` / `CONSOLE-ERR-1 warning` / `CONSOLE-OUT-2 world` /
  `CONSOLE-PARTIAL done`. stdout-ok=true, stderr-present=true.
- Recipe: keep a `<pre id="console">` (offscreen) on the page; observe it; pipe
  deltas to xterm with `convertEol:true`. GUI programs use the display canvas;
  a program can do both (§6 item 7).

## Verification round 7 — lift the built jar out of the build realm (Phase 2)

`node scripts/run-spike.mjs 8 extract`: built a jar with `Builder`, then read it
back from `/files/app.jar` via **`cjFileBlob(path)`** (returns a Blob) →
`Uint8Array` (1144 bytes, valid `PK` zip header), re-injected to `/str` and ran it
— exit 0. ✅ So the IDE can compile in a warm build realm and hand the jar bytes
to JS (→ IndexedDB → a fresh run realm). No base64-via-`#console` fallback needed.

## ✅ Verification complete — no remaining platform unknowns

Every assumption in the Agent Brief that could have blocked the project has been
validated in real headless CheerpJ (one was corrected: the compiler recipe).
The platform is feasible end-to-end. Remaining work is construction, not
de-risking.

## Empirical matrix (all reproduced in-browser, CheerpJ 4.3)

| Mechanism | Java 8 | Java 11 | Java 17 |
|---|---|---|---|
| **`com.sun.tools.javac.Main` + bundled tools.jar (JavaFiddle)** | **✓ PASS** | untested | untested |
| `ToolProvider.getSystemJavaCompiler()` (brief's spike) | `null` | `null` | `null` |
| Bundled ECJ 3.26 — locate + instantiate | ✓ src≤8 | ✓ src≤17 | ✓ src≤17 |
| Bundled ECJ — compile a full `rt.jar` bootclasspath | too slow (CPU-bound) | NPE (no jrt-fs) | NPE (no jrt-fs) |
| Run a *precompiled* jar (`cheerpjRunJar`) | ✓ | ✓ | ✓ |

(The winning row is the recipe above — confirmed cold ~13 s / warm ~4.5 s on
Java 8. Whether 11/17 also expose `com.sun.tools.javac.Main` is untested; Java 8
matches JavaFiddle and is the safe target for the teaching IDE.)

## Why each compiler path fails

- **System compiler absent.** No CheerpJ runtime ships the `jdk.compiler`
  module (11/17) or `tools.jar` (8), so `getSystemJavaCompiler()` is `null`.
  The CheerpJ runtimes are JRE-grade, not JDK-grade.

- **ECJ on Java 8 → deadlock.** ECJ instantiates fine via `ServiceLoader`, but
  `getStandardFileManager()` wedges the instant it tries to open the boot
  `rt.jar`. The server heartbeat shows HTTP requests flatline at 22 (last =
  `ecj-3.26.0.jar`) and **zero** further fetches for the entire timeout window —
  a genuine deadlock in CheerpJ's boot-jar (`/lt/8/jre/lib/rt.jar`) access path,
  not slow I/O. (Note: fetching an *app* jar over HTTP — how `ecj.jar` itself
  loaded — works fine. The deadlock is specific to the boot-classpath path.)

- **ECJ on Java 11/17 → NPE.** Platform classes live only in the
  `/lt/{11,17}/lib/modules` jimage (38–43 MB). ECJ's `JRTUtil` tries to load
  `<java.home>/lib/jrt-fs.jar` to read that image and it **does not exist** in
  CheerpJ's layout → `NullPointerException` in `JRTUtil.walkModuleImage`.

## CheerpJ platform layout (from the `probe` driver)

| | Java 8 | Java 11 / 17 |
|---|---|---|
| `java.home` | `/lt/8/` | `/lt/11/` · `/lt/17/` |
| `sun.boot.class.path` | `/lt/8/jre/lib/rt.jar:…` | `null` (modular) |
| platform classes | `rt.jar` (present; access deadlocks) | `lib/modules` jimage |
| `jrt-fs.jar` | n/a | **absent** |

## Other CheerpJ facts established (matter for the whole build)

- **Loader:** `https://cjrtnc.leaningtech.com/4.3/loader.js`;
  `cheerpjInit({version})` accepts `8 | 11 | 17`.
- **Range requests are mandatory** — CheerpJ reads jars via HTTP `Range`; a
  server returning 200-only ("does not support the 'Range' header") makes
  CheerpJ refuse to run. nginx honours Range by default; our toy test server had
  to implement it.
- **Directory classpaths over `/app` (HTTP) don't work** — CheerpJ can't
  enumerate a directory over HTTP. Package code as a **jar** and run via
  `cheerpjRunJar` / `cheerpjRunMain("Main", "a.jar:b.jar")`.
- **Java stdout is NOT routed through `window.console`** (page-level override
  doesn't see it); it surfaces via the worker/CDP channel. Drive any
  page-visible verdict off the **process exit code** (`cheerpjRunJar` return
  value), not console scraping.
- Java 17 is now "production-supported" in 4.3 (the brief's "preview-grade"
  note is stale) — good for the curated apps (Javarominoes), independent of the
  compiler question.

## Leading untested hypotheses to make Tab 2 viable (need owner steer)

1. **Bundle platform classes as an `/app` jar + explicit `-bootclasspath`.**
   App-jar fetch over HTTP works (no deadlock); pointing ECJ/javac at a
   served `rt.jar`-equivalent and disabling boot/JRT auto-scan should sidestep
   both failure modes. Need a platform API jar (a real OpenJDK 8 `rt.jar`, or a
   trimmed/stub jar for teaching). **Most promising.**
2. **Replicate JavaFiddle's exact method.** Leaning Tech states JavaFiddle's
   full source is available; it compiles client-side under CheerpJ today, so its
   file-manager / bootclasspath setup is the authoritative recipe.
3. **Ask Leaning Tech** whether a compiler-bearing ("JDK") runtime or a
   supported in-browser-compile path exists for CheerpJ 4.x.

## What is NOT blocked

Curated gallery + per-app fresh-runtime launches, and Tab 1 upload→IndexedDB→run
all rely only on running precompiled jars, which works on every runtime. Those
can proceed now; Tab 2 should not start its UI until one recipe above is proven
(brief guardrail).

## Reproduce

```
node scripts/run-spike.mjs 17,11,8 system   # ToolProvider path → all null
node scripts/run-spike.mjs 17,11,8 probe     # dump CheerpJ platform layout
node scripts/run-spike.mjs 8 ecj             # ECJ path → Java 8 deadlock (bounded, auto-killed)
PER_MS=240000 GLOBAL_MS=270000 node scripts/run-spike.mjs 8 ecj
```

The runner has an **unconditional hard deadline** (`GLOBAL_MS`) that SIGKILLs
the browser and exits — a CheerpJ deadlock cannot make it run away.
