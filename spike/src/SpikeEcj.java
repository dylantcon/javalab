import javax.tools.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;

/**
 * JavaLab gate spike — bundled-compiler variant.
 *
 * The system-compiler path (Spike.java) proved that CheerpJ ships no
 * jdk.compiler on any runtime, so ToolProvider.getSystemJavaCompiler() is null.
 * This variant tests the JavaFiddle-style fallback: bundle a compiler on the
 * app classpath. We use ECJ (Eclipse Compiler for Java), which implements
 * javax.tools.JavaCompiler and runs on a bare JRE — a drop-in replacement for
 * the system compiler, so the rest of the flow (and the eventual builder.jar)
 * is identical to Spike.java.
 *
 * Exit codes: 0 PASS · 2 compiler-not-found · 3 compile-failed · 4 exception.
 */
public class SpikeEcj {
    static final int PASS = 0, NO_COMPILER = 2, COMPILE_FAILED = 3, EXCEPTION = 4;

    public static void main(String[] args) { System.exit(run()); }

    static int run() {
        out("SPIKE-BEGIN mode=ecj java.version=" + System.getProperty("java.version")
                + " java.vm.name=" + System.getProperty("java.vm.name"));
        try {
            JavaCompiler compiler = loadEcj();
            if (compiler == null) {
                fail("ecj-compiler-not-found-on-classpath");
                return NO_COMPILER;
            }
            out("SPIKE-INFO compiler=" + compiler.getClass().getName()
                    + " sourceVersions=" + compiler.getSourceVersions());

            Path work = Paths.get("/files/spike-ecj");
            Path outDir = work.resolve("out");
            deleteRecursive(work);
            Files.createDirectories(outDir);

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

            // Bootclasspath sidestep: if spike.boot is set, point ECJ at a
            // platform-classes jar served from /app instead of letting it scan
            // the CheerpJ boot rt.jar (which deadlocks) or the JRT image (absent
            // on 11/17). App-jar fetch over HTTP is the path that works.
            List<String> opts = new ArrayList<>(Arrays.asList("-d", outDir.toString(),
                    "-source", "8", "-target", "8"));
            String boot = System.getProperty("spike.boot");
            if (boot != null && !boot.isEmpty()) {
                opts.add("-bootclasspath");
                opts.add(boot);
                out("SPIKE-INFO using -bootclasspath " + boot);
            } else {
                out("SPIKE-INFO no -bootclasspath (default boot/JRT scan)");
            }

            boolean ok = compiler.getTask(compilerOut, fm, diags, opts, null, units).call();
            fm.close();

            for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
                out("SPIKE-DIAG " + d.getKind() + " @" + d.getLineNumber() + ": " + d.getMessage(null));
            }
            String co = compilerOut.toString().trim();
            if (!co.isEmpty()) out("SPIKE-COMPILER-OUT " + co.replace('\n', ' '));

            if (!ok) {
                fail("compile-failed");
                return COMPILE_FAILED;
            }
            out("SPIKE-INFO compile ok -> " + outDir.resolve("HelloSpike.class"));

            try (URLClassLoader cl = new URLClassLoader(new URL[]{ outDir.toUri().toURL() })) {
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

    /** Locate ECJ's javax.tools.JavaCompiler, first via ServiceLoader, then directly. */
    static JavaCompiler loadEcj() {
        try {
            for (JavaCompiler c : ServiceLoader.load(JavaCompiler.class)) {
                if (c != null && c.getClass().getName().toLowerCase().contains("eclipse")) {
                    out("SPIKE-INFO ecj located via ServiceLoader");
                    return c;
                }
            }
        } catch (Throwable t) {
            out("SPIKE-INFO ServiceLoader path failed: " + t);
        }
        try {
            JavaCompiler c = (JavaCompiler) Class
                    .forName("org.eclipse.jdt.internal.compiler.tool.EclipseCompiler")
                    .getDeclaredConstructor().newInstance();
            out("SPIKE-INFO ecj located via direct instantiation");
            return c;
        } catch (Throwable t) {
            out("SPIKE-INFO direct instantiation failed: " + t);
        }
        return null;
    }

    static void out(String s) { System.out.println(s); System.out.flush(); }

    static void fail(String reason) { out("SPIKE-RESULT FAIL reason=" + reason); }

    static void deleteRecursive(Path p) {
        if (!Files.exists(p)) return;
        try {
            Files.walk(p).sorted(Comparator.reverseOrder())
                 .forEach(q -> { try { Files.deleteIfExists(q); } catch (IOException ignored) {} });
        } catch (IOException ignored) { /* best effort */ }
    }
}
