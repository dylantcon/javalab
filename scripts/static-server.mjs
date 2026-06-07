// Range-capable static file server (CheerpJ requires HTTP Range for jars).
// Shared by scripts/serve.mjs (dev preview) and scripts/e2e.mjs (in-process).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".jar": "application/java-archive", ".class": "application/octet-stream",
};

export function createStaticServer(root, { verbose = false } = {}) {
  return createServer(async (req, res) => {
    let status = 200;
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      let fp = normalize(join(root, p));
      if (!fp.startsWith(root)) { res.writeHead(403).end("forbidden"); status = 403; return; }
      if ((await stat(fp)).isDirectory()) fp = join(fp, "index.html");

      const buf = await readFile(fp);
      const ct = MIME[extname(fp)] || "application/octet-stream";
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (m) {
        let start = m[1] === "" ? null : parseInt(m[1], 10);
        let end = m[2] === "" ? null : parseInt(m[2], 10);
        if (start === null) { start = Math.max(0, buf.length - end); end = buf.length - 1; }
        else if (end === null || end >= buf.length) { end = buf.length - 1; }
        if (start > end || start >= buf.length) {
          status = 416; res.writeHead(416, { "Content-Range": `bytes */${buf.length}` }).end(); return;
        }
        const chunk = buf.subarray(start, end + 1);
        status = 206;
        res.writeHead(206, {
          "Content-Type": ct, "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Content-Length": chunk.length,
        });
        res.end(chunk); return;
      }
      res.writeHead(200, { "Content-Type": ct, "Accept-Ranges": "bytes", "Content-Length": buf.length });
      res.end(buf);
    } catch (e) {
      status = e.code === "ENOENT" ? 404 : 500;
      res.writeHead(status).end(status + " " + e.message);
    } finally {
      if (verbose) console.log(`${status} ${req.url}`);
    }
  });
}

/** Start listening; resolves with the server (use srv.address().port for port 0). */
export function listen(srv, port, host = "127.0.0.1") {
  return new Promise((resolve) => srv.listen(port, host, () => resolve(srv)));
}
