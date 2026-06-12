import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * Diagnostic: what platform-class resources does the CheerpJ runtime expose?
 * A bundled compiler (ECJ or javac) needs to type-check against java.* — it
 * finds those either in rt.jar (Java 8) or the jrt module image (Java 9+).
 * This prints what's actually present so we know what to point the compiler at.
 * Always exits 0 (it's an inspector, not a gate).
 */
public class Probe {
    public static void main(String[] args) {
        p("PROBE-BEGIN java.version=" + System.getProperty("java.version"));
        for (String k : new String[]{
                "java.home", "java.class.path", "sun.boot.class.path",
                "jdk.module.path", "java.specification.version" }) {
            p("PROBE-PROP " + k + " = " + System.getProperty(k));
        }
        String home = System.getProperty("java.home", "");
        List<String> dirs = new ArrayList<>(Arrays.asList(
                home, home + "/lib", home + "/lib/modules", home + "/jmods",
                "/lt", "/lt/8", "/lt/8/lib", "/lt/11", "/lt/11/lib",
                "/lt/17", "/lt/17/lib"));
        for (String d : dirs) listDir(d);
        for (String f : new String[]{
                home + "/lib/rt.jar", home + "/lib/modules", home + "/lib/jrt-fs.jar",
                home + "/lib/ct.sym",
                "/lt/8/lib/rt.jar", "/lt/11/lib/jrt-fs.jar", "/lt/17/lib/jrt-fs.jar",
                "/lt/17/lib/modules" }) {
            p("PROBE-EXISTS " + (new File(f).exists() ? "yes" : "no ") + " " + f
                    + (new File(f).exists() ? " (" + new File(f).length() + " bytes)" : ""));
        }
        p("PROBE-END");
        System.exit(0);
    }

    static void listDir(String d) {
        File f = new File(d);
        if (!f.isDirectory()) { p("PROBE-DIR " + d + " : (not a dir)"); return; }
        String[] names = f.list();
        if (names == null) { p("PROBE-DIR " + d + " : (unreadable)"); return; }
        Arrays.sort(names);
        int n = Math.min(names.length, 40);
        p("PROBE-DIR " + d + " : " + names.length + " entries -> "
                + String.join(", ", Arrays.copyOfRange(names, 0, n))
                + (names.length > n ? " …" : ""));
    }

    static void p(String s) { System.out.println(s); System.out.flush(); }
}
