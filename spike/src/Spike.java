import javax.tools.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;

/**
 * JavaLab gate spike (Agent Brief §6).
 *
 * Proves, under the *pinned CheerpJ runtime*, that the in-browser toolchain
 * Tab 2 depends on actually exists:
 *
 *   1. ToolProvider.getSystemJavaCompiler() returns non-null
 *      (i.e. the jdk.compiler module ships in this runtime), and
 *   2. that compiler can compile a source file living in CheerpJ's virtual
 *      filesystem to bytecode, and
 *   3. the freshly produced class can be loaded and executed end-to-end.
 *
 * Verdict is communicated two ways: human-readable SPIKE- lines on System.out
 * (visible in the dev console / captured by the headless runner), and — the
 * authoritative channel — the process EXIT CODE, which CheerpJ surfaces as the
 * return value of cheerpjRunJar. CheerpJ does not route Java stdout through the
 * page's window.console, so the exit code is what the host page keys its verdict
 * on. Exit codes: 0 PASS · 2 compiler-null · 3 compile-failed · 4 exception.
 *
 * This is trusted, vetted driver code — the same role builder.jar will play.
 * It is precompiled locally; only the HelloSpike source below is compiled
 * in the browser.
 */
public class Spike {
    static final int PASS = 0, NO_COMPILER = 2, COMPILE_FAILED = 3, EXCEPTION = 4;

    public static void main(String[] args) {
        System.exit(run());
    }

    static int run() {
        out("SPIKE-BEGIN java.version=" + System.getProperty("java.version")
                + " java.vm.name=" + System.getProperty("java.vm.name"));
        try {
            JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
            if (compiler == null) {
                fail("getSystemJavaCompiler-returned-null"
                        + " (jdk.compiler module absent from this CheerpJ runtime)");
                return NO_COMPILER;
            }
            out("SPIKE-INFO compiler=" + compiler.getClass().getName()
                    + " sourceVersions=" + compiler.getSourceVersions());

            // /files/ is the read-write, IndexedDB-backed mount — the only place
            // Java itself may write. javac output and the source both go here.
            Path work = Paths.get("/files/spike");
            Path out  = work.resolve("out");
            // Best-effort clean so reruns don't read a stale class.
            deleteRecursive(work);
            Files.createDirectories(out);

            Path src = work.resolve("HelloSpike.java");
            String code = ""
                    + "public class HelloSpike {\n"
                    + "  public static void main(String[] a) {\n"
                    + "    System.out.println(\"HELLO-FROM-IN-BROWSER-COMPILED-CLASS\");\n"
                    + "  }\n"
                    + "}\n";
            Files.write(src, code.getBytes("UTF-8"));
            out("SPIKE-INFO wrote source -> " + src);

            DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
            StringWriter compilerOut = new StringWriter();
            StandardJavaFileManager fm = compiler.getStandardFileManager(diags, null, null);
            Iterable<? extends JavaFileObject> units =
                    fm.getJavaFileObjectsFromFiles(Collections.singletonList(src.toFile()));
            List<String> opts = Arrays.asList("-d", out.toString());

            boolean ok = compiler.getTask(compilerOut, fm, diags, opts, null, units).call();
            fm.close();

            for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
                out("SPIKE-DIAG " + d.getKind() + " @" + d.getLineNumber() + ": "
                        + d.getMessage(null));
            }
            String co = compilerOut.toString().trim();
            if (!co.isEmpty()) out("SPIKE-COMPILER-OUT " + co.replace('\n', ' '));

            if (!ok) {
                fail("compile-failed");
                return COMPILE_FAILED;
            }
            out("SPIKE-INFO compile ok -> " + out.resolve("HelloSpike.class"));

            // Load + run the bytecode we just produced, to prove the full loop.
            try (URLClassLoader cl = new URLClassLoader(new URL[]{ out.toUri().toURL() })) {
                Class<?> hello = Class.forName("HelloSpike", true, cl);
                hello.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
            }

            out("SPIKE-RESULT PASS");
            return PASS;
        } catch (Throwable t) {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            out("SPIKE-TRACE " + sw.toString().replace('\n', ' '));
            fail("exception:" + t);
            return EXCEPTION;
        } finally {
            out("SPIKE-END");
        }
    }

    private static void out(String s) { System.out.println(s); System.out.flush(); }

    private static void fail(String reason) { out("SPIKE-RESULT FAIL reason=" + reason); }

    private static void deleteRecursive(Path p) {
        if (!Files.exists(p)) return;
        try {
            Files.walk(p)
                 .sorted(Comparator.reverseOrder())
                 .forEach(q -> { try { Files.deleteIfExists(q); } catch (IOException ignored) {} });
        } catch (IOException ignored) { /* best effort */ }
    }
}
