/*
 * The CheerpJ natives for javalabrelay.BrowserWebSocketTransport.
 *
 * A CheerpJ page cannot open raw sockets, so the Java transport declares
 * four native methods and this file implements them over the browser's own
 * WebSocket. Events are buffered per connection handle and drained by a
 * polling thread on the Java side, which keeps the JS side free of any
 * JS-to-Java calls.
 *
 * Usage in the page that boots a javalab app:
 *
 *   await cheerpjInit({ natives: javalabRelayNatives });
 *   ...
 *   await cheerpjRunMain("seasofyore.SeasOfYore", "/app/SeasOfYore.jar:...",
 *                        "--browser");
 *
 * States mirror BrowserWebSocketTransport: 0 connecting, 1 open, 2 closed.
 */
const javalabRelaySockets = new Map();
let javalabRelayNextHandle = 1;

const javalabRelayNatives = {
  async Java_javalabrelay_BrowserWebSocketTransport_nativeOpen(lib, uri) {
    const handle = javalabRelayNextHandle++;
    const entry = { state: 0, queue: [], socket: null };
    javalabRelaySockets.set(handle, entry);

    try {
      const socket = new WebSocket(uri);
      entry.socket = socket;
      socket.onopen = () => { entry.state = 1; };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") entry.queue.push(event.data);
      };
      socket.onclose = () => { entry.state = 2; };
      socket.onerror = () => { entry.state = 2; };
    } catch (err) {
      entry.state = 2;
    }
    return handle;
  },

  async Java_javalabrelay_BrowserWebSocketTransport_nativeState(lib, handle) {
    const entry = javalabRelaySockets.get(handle);
    return entry ? entry.state : 2;
  },

  async Java_javalabrelay_BrowserWebSocketTransport_nativeSend(lib, handle, text) {
    const entry = javalabRelaySockets.get(handle);
    if (entry && entry.state === 1) entry.socket.send(text);
  },

  async Java_javalabrelay_BrowserWebSocketTransport_nativePollMessage(lib, handle) {
    const entry = javalabRelaySockets.get(handle);
    if (!entry || entry.queue.length === 0) return null;
    return entry.queue.shift();
  },

  async Java_javalabrelay_BrowserWebSocketTransport_nativeClose(lib, handle) {
    const entry = javalabRelaySockets.get(handle);
    if (entry) {
      try { if (entry.socket) entry.socket.close(); } catch (err) { /* gone */ }
      entry.state = 2;
      javalabRelaySockets.delete(handle);
    }
  },
};
