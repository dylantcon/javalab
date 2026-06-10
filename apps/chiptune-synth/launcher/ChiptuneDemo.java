/*
 * ChiptuneDemo — a runnable launcher for the chiptune-synth LIBRARY.
 *
 * chiptune-synth (github.com/dylantcon/chiptune-synth) ships as a library with
 * no main method: you implement ChiptuneSong and hand it to the synth. To give
 * it a runnable card in the JavaLab gallery, this launcher bundles a short
 * built-in looping song (DemoSong) plus a tiny Swing UI (play/stop + volume +
 * a decorative spectrum), and is set as the jar's Main-Class.
 *
 * Lives in package chiptunesynth so it compiles against the library's public
 * API. Audio uses javax.sound.sampled, which CheerpJ supports on Java 8 only.
 */
package chiptunesynth;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JSlider;
import javax.swing.JFrame;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;

public class ChiptuneDemo {

  public static void main(String[] args) {
    SwingUtilities.invokeLater(ChiptuneDemo::buildAndPlay);
  }

  private static void buildAndPlay() {
    final ChiptuneSynth synth = ChiptuneSynth.getSynthesizer(new DemoSong());

    JFrame f = new JFrame("ChiptuneSynth - NES 2A03 demo");
    f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
    f.setSize(480, 360);
    f.setLayout(new BorderLayout());
    f.getContentPane().setBackground(new Color(0x0b1020));

    JLabel title = new JLabel("ChiptuneSynth", SwingConstants.CENTER);
    title.setForeground(new Color(0x5dff9c));
    title.setFont(new Font("Monospaced", Font.BOLD, 24));
    title.setBorder(BorderFactory.createEmptyBorder(14, 0, 2, 0));
    f.add(title, BorderLayout.NORTH);

    final Visualizer viz = new Visualizer();
    f.add(viz, BorderLayout.CENTER);

    JPanel controls = new JPanel();
    controls.setBackground(new Color(0x0b1020));
    final JButton toggle = new JButton("Stop");
    toggle.setFocusable(false);
    JLabel volLabel = new JLabel("VOL");
    volLabel.setForeground(new Color(0x37c7b6));
    volLabel.setFont(new Font("Monospaced", Font.PLAIN, 12));
    final JSlider vol = new JSlider(0, 100, 80);
    vol.setBackground(new Color(0x0b1020));
    vol.setFocusable(false);
    controls.add(toggle);
    controls.add(volLabel);
    controls.add(vol);
    f.add(controls, BorderLayout.SOUTH);

    toggle.addActionListener(e -> {
      if (synth.isRunning()) {
        synth.stop();
        viz.setActive(false);
        toggle.setText("Play");
      } else {
        synth.rewind();
        synth.start();
        viz.setActive(true);
        toggle.setText("Stop");
      }
    });
    vol.addChangeListener(e -> synth.setVolume(vol.getValue() / 100.0));

    f.setLocationRelativeTo(null);
    f.setVisible(true);

    synth.setVolume(0.8);
    synth.start();
    viz.setActive(true);
  }
}

/** Decorative NES-style spectrum; deterministic (no live audio tap). */
class Visualizer extends JPanel {
  private static final int N = 16;
  private final double[] h = new double[N];
  private boolean active = false;
  private long tick = 0;

  Visualizer() {
    setBackground(new Color(0x0b1020));
    new javax.swing.Timer(60, e -> { step(); repaint(); }).start();
  }

  void setActive(boolean a) { active = a; }

  private void step() {
    tick++;
    for (int i = 0; i < N; i++) {
      double target = active
        ? 0.20 + 0.80 * Math.abs(Math.sin(tick * 0.13 + i * 0.7))
                      * (0.5 + 0.5 * Math.abs(Math.sin(tick * 0.31 + i)))
        : 0.03;
      h[i] += (target - h[i]) * 0.35;
    }
  }

  @Override
  protected void paintComponent(Graphics g) {
    super.paintComponent(g);
    Graphics2D g2 = (Graphics2D) g;
    int w = getWidth(), ht = getHeight();
    int gap = 6;
    int bw = Math.max(2, (w - gap) / N - gap);
    for (int i = 0; i < N; i++) {
      int bh = (int) (h[i] * (ht - 16));
      int x = gap + i * (bw + gap);
      int y = ht - bh - 8;
      g2.setColor(new Color(Color.HSBtoRGB(0.45f - (float) h[i] * 0.42f, 0.85f, 1f)));
      g2.fillRect(x, y, bw, bh);
    }
  }
}

/** A short looping demo: I-V-vi-IV in C, lead/harmony/bass/drums. */
class DemoSong implements ChiptuneSong {
  @Override
  public Track getLead() {
    return new Track().withDefaults(LEAD_VOL, LEAD_DUTY).addNotes(
      C5, E, E5, E, G5, E, C6, E, G5, E, E5, E, C5, E, D5, E,
      B4, E, D5, E, G5, E, B5, E, G5, E, D5, E, B4, E, C5, E,
      A4, E, C5, E, E5, E, A5, E, E5, E, C5, E, A4, E, B4, E,
      F4, E, A4, E, C5, E, F5, E, C5, E, A4, E, F4, E, G4, E);
  }

  @Override
  public Track getHarmony() {
    return new Track().withDefaults(HARMONY_VOL, HARMONY_DUTY).addNotes(
      E4, Q, G4, Q, E4, Q, G4, Q,
      D4, Q, G4, Q, D4, Q, G4, Q,
      C4, Q, E4, Q, C4, Q, E4, Q,
      C4, Q, F4, Q, C4, Q, F4, Q);
  }

  @Override
  public Track getBass() {
    return new Track().withDefaults(BASS_VOL, BASS_DUTY).addNotes(
      C3, H, G2, H,
      G2, H, D3, H,
      A2, H, E3, H,
      F2, H, C3, H);
  }

  @Override
  public Track getDrums() {
    Track t = new Track().withDefaults(DRUM_VOL, DRUM_DUTY);
    for (int bar = 0; bar < 4; bar++) {
      t.addNotes(KICK, E, HIHAT, E, SNARE, E, HIHAT, E,
                 KICK, E, HIHAT, E, SNARE, E, HIHAT, E);
    }
    return t;
  }
}
