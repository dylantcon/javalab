// Local static server for public/ — mirrors what nginx does in production, incl.
// HTTP Range (CheerpJ requires it for jars). For local preview/testing only.
//
//   node scripts/serve.mjs            # http://127.0.0.1:8088
//   PORT=9000 VERBOSE=1 node scripts/serve.mjs

import { PUBLIC } from "./manifest.mjs";
import { createStaticServer, listen } from "./static-server.mjs";

const PORT = parseInt(process.env.PORT || "8088", 10);
const srv = createStaticServer(PUBLIC, { verbose: !!process.env.VERBOSE });
await listen(srv, PORT);
console.log(`[serve] public/ at http://127.0.0.1:${PORT}`);
