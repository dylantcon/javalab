import javax.swing.*;
import java.awt.*;
import java.util.Random;

/**
 * JavaLab demo app — a small interactive Swing animation. Ships with the site so
 * the curated gallery works end-to-end before the owner's real apps are wired in.
 * Java 8 source/target (runs on CheerpJ's Java 8 runtime).
 */
public class BounceDemo {
    public static void main(String[] args) {
        SwingUtilities.invokeLater(BounceDemo::build);
    }

    static void build() {
        JFrame f = new JFrame("JavaLab · Bounce");
        BouncePanel panel = new BouncePanel();

        JButton add = new JButton("Add ball");
        add.addActionListener(e -> panel.addBall());
        JButton clear = new JButton("Clear");
        clear.addActionListener(e -> panel.clear());

        JPanel controls = new JPanel();
        controls.setBackground(new Color(0x10, 0x24, 0x33));
        controls.add(add);
        controls.add(clear);

        f.setLayout(new BorderLayout());
        f.add(panel, BorderLayout.CENTER);
        f.add(controls, BorderLayout.SOUTH);
        f.pack();
        f.setLocationRelativeTo(null);
        f.setVisible(true);
        System.out.println("BounceDemo started");
    }
}

class BouncePanel extends JPanel {
    static final Color BG = new Color(0x1a, 0x1a, 0x40);   // distinctive indigo (e2e key colour)
    static final Color[] PALETTE = {
        new Color(0x37, 0xc7, 0xb6), new Color(0xff, 0xff, 0xff),
        new Color(0x6c, 0x5c, 0xe7), new Color(0x5d, 0xff, 0x9c),
    };
    final java.util.List<Ball> balls = new java.util.ArrayList<Ball>();
    final Random rng = new Random(42);

    BouncePanel() {
        setPreferredSize(new Dimension(520, 360));
        setBackground(BG);
        for (int i = 0; i < 9; i++) addBall();
        new Timer(16, e -> { step(); repaint(); }).start();
    }

    void addBall() { balls.add(new Ball(rng, PALETTE[rng.nextInt(PALETTE.length)])); }
    void clear()   { balls.clear(); }

    void step() {
        int w = getWidth(), h = getHeight();
        if (w == 0 || h == 0) return;
        for (Ball b : balls) b.move(w, h);
    }

    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2 = (Graphics2D) g;
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        for (Ball b : balls) {
            g2.setColor(b.color);
            g2.fillOval((int) b.x - b.r, (int) b.y - b.r, b.r * 2, b.r * 2);
        }
    }
}

class Ball {
    double x, y, vx, vy;
    int r;
    Color color;

    Ball(Random rng, Color c) {
        x = 40 + rng.nextInt(440);
        y = 40 + rng.nextInt(280);
        vx = (rng.nextDouble() * 2 - 1) * 3 + 1.0;
        vy = (rng.nextDouble() * 2 - 1) * 3 + 1.0;
        r = 8 + rng.nextInt(14);
        color = c;
    }

    void move(int w, int h) {
        x += vx; y += vy;
        if (x < r)     { x = r;     vx = -vx; }
        if (x > w - r) { x = w - r; vx = -vx; }
        if (y < r)     { y = r;     vy = -vy; }
        if (y > h - r) { y = h - r; vy = -vy; }
    }
}
