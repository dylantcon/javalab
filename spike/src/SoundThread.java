import javax.sound.sampled.*;

/**
 * Audio + thread probe (Java 8 bytecode). Run as a PRE-BUILT jar on different
 * CheerpJ runtimes to check where SourceDataLine works. Exit: 0 thread+audio ok,
 * 11 audio failed (thread ok), 10 thread failed.
 */
public class SoundThread {
    static volatile boolean threadRan = false;

    public static void main(String[] a) throws Exception {
        Thread t = new Thread(() -> {
            long x = 0;
            for (int i = 0; i < 2000000; i++) x += i;
            threadRan = (x != 0);
            System.out.println("THREAD-RAN name=" + Thread.currentThread().getName() + " sum=" + x);
        }, "synth-daemon");
        t.setDaemon(true);
        t.start();
        t.join(8000);
        System.out.println("THREAD-RESULT ran=" + threadRan + " alive=" + t.isAlive());

        boolean audioOk = false;
        try {
            AudioFormat fmt = new AudioFormat(44100f, 16, 1, true, false);
            DataLine.Info info = new DataLine.Info(SourceDataLine.class, fmt);
            System.out.println("AUDIO-SUPPORTED " + AudioSystem.isLineSupported(info));
            SourceDataLine line = (SourceDataLine) AudioSystem.getLine(info);
            line.open(fmt, 8192);
            line.start();
            System.out.println("AUDIO-OPEN ok buf=" + line.getBufferSize());
            byte[] buf = new byte[8820];
            for (int i = 0; i < 4410; i++) {
                short v = (short) (Math.sin(2 * Math.PI * 440 * i / 44100.0) * 30000);
                buf[i * 2] = (byte) v;
                buf[i * 2 + 1] = (byte) (v >> 8);
            }
            int w = line.write(buf, 0, buf.length);
            line.stop();
            line.close();
            System.out.println("AUDIO-WROTE " + w);
            audioOk = true;
            System.out.println("AUDIO-RESULT ok");
        } catch (Throwable e) {
            System.out.println("AUDIO-RESULT fail:" + e);
        }
        System.out.println("AUDIO-END thread=" + threadRan + " audio=" + audioOk);
        System.exit((threadRan && audioOk) ? 0 : (threadRan ? 11 : 10));
    }
}
