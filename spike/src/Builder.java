import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.jar.*;

/**
 * JavaLab builder spike (Agent Brief §6 "ship a tiny Java builder").
 *
 * Proves the full authoring pipeline in ONE Java program running under CheerpJ:
 *   1. compile every .java under a source tree with the REAL javac
 *      (com.sun.tools.javac.Main.compile — NOT ToolProvider, which is null
 *      under CheerpJ), preserving packages;
 *   2. read a visitor-supplied MANIFEST.MF;
 *   3. package the compiled classes + manifest into a runnable jar via
 *      java.util.jar — all inside CheerpJ's virtual filesystem.
 *
 * args: <outClassesDir> <jarOut> <manifestPath> <src1.java> [src2.java …]
 * Sources are passed explicitly (CheerpJ's /str mount is flat — no dir trees —
 * but javac reads the package from file content, so flat sources still compile
 * into a proper package tree under -d). Output lines are prefixed BUILDER-.
 * Exit: 0 PASS · 2 bad-args · 3 compile-failed · 4 exception.
 */
public class Builder {
    public static void main(String[] args) {
        try {
            if (args.length < 4) {
                System.out.println("BUILDER-RESULT FAIL reason=bad-args (need outDir jarOut manifest src...)");
                System.exit(2);
            }
            Path outDir = Paths.get(args[0]);
            Path jarOut = Paths.get(args[1]);
            Path manifestPath = Paths.get(args[2]);
            // The IDE reads javac diagnostics back from this file (CheerpJ stdout
            // isn't readable from the host page — see the cheerpj-facts note); clear
            // any prior run's diagnostics up front so a crash can't leave stale ones.
            Path diagOut = Paths.get(args[1] + ".diag");
            try { Files.write(diagOut, new byte[0]); } catch (Exception ignore) {}
            List<String> sources = new ArrayList<>(Arrays.asList(args).subList(3, args.length));
            System.out.println("BUILDER-BEGIN java.version=" + System.getProperty("java.version")
                    + " out=" + outDir + " jar=" + jarOut);
            System.out.println("BUILDER-SOURCES " + sources.size() + ": " + sources);

            // 2. Compile with the real javac, in-process. Clean outDir first so a
            // rebuild can't pick up stale classes from a prior iteration.
            deleteRecursive(outDir);
            Files.createDirectories(outDir);
            List<String> jargs = new ArrayList<>();
            jargs.add("-d"); jargs.add(outDir.toString());
            // Explicit classpath so javac doesn't inherit the launch classpath
            // (CheerpJ puts builder.jar — now cache-busted as builder.jar?v=… — on
            // it, which javac flags with a spurious "[path] unexpected extension"
            // warning). User sources are all passed together, so they need no deps.
            jargs.add("-classpath"); jargs.add(outDir.toString());
            jargs.add("-encoding"); jargs.add("UTF-8");
            jargs.add("-Xlint:all");
            jargs.addAll(sources);
            StringWriter diagBuf = new StringWriter();
            int rc = com.sun.tools.javac.Main.compile(
                    jargs.toArray(new String[0]), new PrintWriter(diagBuf, true));
            String diags = diagBuf.toString().trim();
            // Hand the raw javac diagnostics back to the IDE via /files (the one
            // channel that works); also echo to stdout for the spike harness.
            try { Files.write(diagOut, diags.getBytes("UTF-8")); } catch (Exception ignore) {}
            if (!diags.isEmpty()) {
                for (String line : diags.split("\n")) System.out.println("BUILDER-DIAG " + line);
            }
            System.out.println("BUILDER-JAVAC rc=" + rc);
            if (rc != 0) {
                System.out.println("BUILDER-RESULT FAIL reason=compile rc=" + rc);
                System.exit(3);
            }

            // 3. Package classes + manifest into a runnable jar.
            Manifest mf = new Manifest();
            try (InputStream in = Files.newInputStream(manifestPath)) { mf.read(in); }
            if (mf.getMainAttributes().getValue("Manifest-Version") == null) {
                mf.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
            }
            int[] count = {0};
            try (JarOutputStream jos = new JarOutputStream(Files.newOutputStream(jarOut), mf)) {
                Files.walk(outDir)
                     .filter(Files::isRegularFile)
                     .sorted()
                     .forEach(p -> {
                         try {
                             String entry = outDir.relativize(p).toString().replace('\\', '/');
                             jos.putNextEntry(new JarEntry(entry));
                             Files.copy(p, jos);
                             jos.closeEntry();
                             count[0]++;
                         } catch (IOException e) { throw new UncheckedIOException(e); }
                     });
            }
            long size = Files.size(jarOut);
            System.out.println("BUILDER-JAR entries=" + count[0] + " bytes=" + size
                    + " mainClass=" + mf.getMainAttributes().getValue("Main-Class"));
            System.out.println("BUILDER-RESULT PASS jar=" + jarOut);
            System.exit(0);
        } catch (Throwable t) {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            System.out.println("BUILDER-TRACE " + sw.toString().replace('\n', ' '));
            System.out.println("BUILDER-RESULT FAIL reason=exception:" + t);
            System.exit(4);
        }
    }

    static void deleteRecursive(Path p) {
        if (!Files.exists(p)) return;
        try {
            Files.walk(p).sorted(Comparator.reverseOrder())
                 .forEach(q -> { try { Files.deleteIfExists(q); } catch (IOException ignored) {} });
        } catch (IOException ignored) { /* best effort */ }
    }
}
