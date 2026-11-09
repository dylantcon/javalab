import com.google.googlejavaformat.java.Formatter;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * JavaLab in-browser formatter — the IDE's "Format (Alt+Shift+F)" action.
 *
 * Wraps google-java-format's Formatter API (NOT its CLI Main): reads one .java
 * source from <inPath> (the IDE writes it to the flat read-only /str mount),
 * reformats it, and writes the result to <outPath> in the writable /files VFS.
 *
 * Why a file and not stdout: under CheerpJ, Java stdout goes to a worker/CDP
 * channel that the host page CANNOT read (see the cheerpj-facts note), so the
 * old path — running gjf's Main and scraping a #console <pre> — always came back
 * empty and the IDE silently fell back to a basic re-indent (the "no-op" the
 * Format button appeared to be). Handing the bytes back through /files mirrors
 * how Builder returns the compiled jar, which is the one channel proven to work.
 *
 * args: <inPath> <outPath>
 * Exit: 0 ok · 1 format error (e.g. unparseable source) · 2 bad args / IO error.
 */
public class JavaLabFormat {
    public static void main(String[] args) {
        try {
            if (args.length < 2) {
                System.err.println("JLF-FAIL bad-args (need <inPath> <outPath>)");
                System.exit(2);
            }
            String src = new String(Files.readAllBytes(Paths.get(args[0])), "UTF-8");
            String out;
            try {
                out = new Formatter().formatSource(src);
            } catch (Throwable t) {
                // Unparseable / unformattable source — let the IDE fall back to
                // its basic re-indent. Write nothing; signal with a non-zero exit.
                System.err.println("JLF-FAIL format:" + t);
                System.exit(1);
                return;
            }
            Files.write(Paths.get(args[1]), out.getBytes("UTF-8"));
            System.exit(0);
        } catch (Throwable t) {
            System.err.println("JLF-FAIL io:" + t);
            System.exit(2);
        }
    }
}
