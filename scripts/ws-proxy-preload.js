/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * WebSocket upgrade proxy — loaded via `node --require ./ws-proxy-preload.js`.
 *
 * Intercepts the http.Server 'upgrade' event BEFORE Next.js's own upgrade
 * handler runs, and forwards /api/embedded/stream/ws + /api/activity-feed/ws
 * to their respective upstream TCP endpoints.
 *
 * Previous behaviour (the 10–40s recording-start stalls observed in prod HAR):
 *   Next.js registers its own 'upgrade' listener after our preload. When our
 *   handler ran first and began forwarding, Next.js's fallback fired next,
 *   wrote "HTTP/1.1 404 Not Found\r\n\r\n" to the client socket, and called
 *   socket.destroy(). Our `socket.end = noop` only blocked `end()` — the raw
 *   `socket.write()` and `socket.destroy()` still went through and corrupted
 *   the handshake. The browser retried until it happened to catch a race
 *   where the upstream's 101 arrived before Next.js's 404 — hence the ~40s
 *   eventual "success".
 *
 * Fix:
 *   1. prependListener so we run first (cheap insurance).
 *   2. On match, immediately `removeAllListeners('upgrade')` — re-register
 *      only our top-level handler — so Next.js's fallback can never fire for
 *      this or subsequent upgrades on this server.
 *   3. Override `socket.write` (not just end/destroy) while we own the
 *      handshake, so anything that slipped through cannot corrupt the stream.
 *   4. Read the upstream's 101 response manually, forward it, THEN enable
 *      piping. Guarantees the handshake bytes are in order.
 *   5. Handshake watchdog (15s) + explicit teardown covers edge cases.
 */

const http = require('http');
const net = require('net');

const defaultStreamPort = parseInt(process.env.STREAM_PORT || '9223', 10);
const activityFeedPort = parseInt(process.env.ACTIVITY_FEED_WS_PORT || '9400', 10);
const DEBUG = process.env.WS_PROXY_DEBUG === '1';
const dlog = DEBUG
  ? (label, ...a) => console.log(`[WS-PROXY:${label}]`, ...a)
  : () => {};

function parseTarget(url) {
  if (url.startsWith('/api/embedded/stream/ws')) {
    const qi = url.indexOf('?');
    const sp = new URLSearchParams(qi >= 0 ? url.slice(qi + 1) : '');
    const target = sp.get('target');
    let host = '127.0.0.1';
    let port = defaultStreamPort;
    if (target) {
      const [h, p] = target.split(':');
      host = h || host;
      if (p) port = parseInt(p, 10);
    }
    sp.delete('target');
    const qs = sp.toString();
    return { host, port, path: '/' + (qs ? '?' + qs : ''), label: 'embedded-stream', forwardCookie: false };
  }
  if (url.startsWith('/api/activity-feed/ws')) {
    const qi = url.indexOf('?');
    return {
      host: '127.0.0.1',
      port: activityFeedPort,
      path: '/' + (qi >= 0 ? url.slice(qi) : ''),
      label: 'activity-feed',
      forwardCookie: true,
    };
  }
  return null;
}

function forwardUpgrade(server, req, socket, head, cfg) {
  // We're the first listener (prependListener). Other listeners — notably
  // Next.js's own upgrade fallback — still fire after us. We neutralise their
  // ability to touch this specific socket via the write/end/destroy
  // overrides below, without removing them from the emitter (other upgrade
  // paths still need Next.js to handle them).
  const realWrite = socket.write.bind(socket);
  const realEnd = socket.end.bind(socket);
  const realDestroy = socket.destroy.bind(socket);
  let claimed = true;
  socket.write = (...a) => {
    if (claimed) { dlog(cfg.label, 'blocked external socket.write', a[0] && a[0].length); return true; }
    return realWrite(...a);
  };
  socket.end = () => {
    if (claimed) { dlog(cfg.label, 'blocked external socket.end'); return socket; }
    return realEnd();
  };
  socket.destroy = (...a) => {
    if (claimed) { dlog(cfg.label, 'blocked external socket.destroy'); return socket; }
    return realDestroy(...a);
  };

  try { socket.setNoDelay(true); socket.setKeepAlive(true, 30_000); } catch { /* ignore */ }

  let upstreamClosed = false;
  let clientClosed = false;
  let upgraded = false;
  let upstream = null;

  // teardown(reason, { hadError }) — on clean close (hadError=false) we send a
  // graceful FIN via end() so any data still buffered on the pipe drains. On
  // error we RST via destroy().
  const teardown = (reason, opts) => {
    const hadError = opts && opts.hadError;
    dlog(cfg.label, 'teardown:', reason, 'hadError=', !!hadError);
    claimed = false;
    if (upstream && !upstreamClosed) {
      upstreamClosed = true;
      try { hadError ? upstream.destroy() : upstream.end(); } catch { /* ignore */ }
    }
    if (!clientClosed) {
      clientClosed = true;
      try { hadError ? realDestroy() : realEnd(); } catch { /* ignore */ }
    }
  };

  socket.on('error', (e) => { dlog(cfg.label, 'client error:', e.message); teardown('client-error', { hadError: true }); });
  socket.on('end', () => { teardown('client-end', { hadError: false }); });
  socket.on('close', (hadErr) => { clientClosed = true; teardown('client-close', { hadError: hadErr }); });

  upstream = net.connect(cfg.port, cfg.host);
  // Short connect timeout so a stuck pool member fails fast instead of waiting
  // out the Envoy sidecar's 15s route timeout (which would surface as a 520).
  upstream.setTimeout(5_000);
  upstream.once('timeout', () => {
    if (!upgraded) {
      dlog(cfg.label, 'connect timeout');
      teardown('connect-timeout', { hadError: true });
    }
  });
  upstream.once('connect', () => { try { upstream.setTimeout(0); } catch { /* ignore */ } });
  try { upstream.setNoDelay(true); upstream.setKeepAlive(true, 30_000); } catch { /* ignore */ }
  upstream.on('error', (e) => { dlog(cfg.label, 'upstream error:', e.message); teardown('upstream-error', { hadError: true }); });
  upstream.on('end', () => { teardown('upstream-end', { hadError: false }); });
  upstream.on('close', (hadErr) => { upstreamClosed = true; teardown('upstream-close', { hadError: hadErr }); });

  upstream.on('connect', () => {
    dlog(cfg.label, 'upstream connected', cfg.host + ':' + cfg.port);
    const lines = [
      'GET ' + cfg.path + ' HTTP/1.1',
      'Host: ' + cfg.host + ':' + cfg.port,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + req.headers['sec-websocket-key'],
      'Sec-WebSocket-Version: ' + (req.headers['sec-websocket-version'] || '13'),
    ];
    if (req.headers['sec-websocket-protocol']) {
      lines.push('Sec-WebSocket-Protocol: ' + req.headers['sec-websocket-protocol']);
    }
    if (req.headers['sec-websocket-extensions']) {
      lines.push('Sec-WebSocket-Extensions: ' + req.headers['sec-websocket-extensions']);
    }
    if (cfg.forwardCookie && req.headers.cookie) {
      lines.push('Cookie: ' + req.headers.cookie);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
  });

  // Read the upstream response header ourselves. Only after we see a 101 do
  // we start piping — guarantees the client sees the 101 before any binary
  // frames and prevents Next.js's potential 404 from interleaving.
  let headerBuf = Buffer.alloc(0);
  const onData = (chunk) => {
    if (upgraded) return;
    headerBuf = Buffer.concat([headerBuf, chunk]);
    const sep = headerBuf.indexOf('\r\n\r\n');
    if (sep === -1) {
      if (headerBuf.length > 32_768) teardown('oversized-upstream-header');
      return;
    }
    const hbytes = headerBuf.subarray(0, sep + 4);
    const trailing = headerBuf.subarray(sep + 4);
    const statusLine = hbytes.toString('utf8', 0, hbytes.indexOf('\r\n'));
    const m = /^HTTP\/1\.[01]\s+(\d+)/.exec(statusLine);
    const code = m ? parseInt(m[1], 10) : 0;
    if (code !== 101) {
      dlog(cfg.label, 'upstream refused upgrade:', statusLine);
      claimed = false; // allow our final write to go through
      try { realWrite(hbytes); if (trailing.length) realWrite(trailing); } catch { /* ignore */ }
      teardown('upstream-non-101');
      return;
    }

    upgraded = true;
    claimed = false;
    // Restore socket methods for piping.
    socket.write = realWrite;
    socket.end = realEnd;
    socket.destroy = realDestroy;

    try { realWrite(hbytes); if (trailing.length) realWrite(trailing); } catch { /* ignore */ }

    upstream.removeListener('data', onData);
    upstream.pipe(socket, { end: false });
    socket.pipe(upstream, { end: false });
    dlog(cfg.label, 'upgrade complete');
  };
  upstream.on('data', onData);

  const handshakeTimer = setTimeout(() => {
    if (!upgraded) { dlog(cfg.label, 'handshake timeout'); teardown('handshake-timeout'); }
  }, 15_000);
  upstream.once('close', () => clearTimeout(handshakeTimer));
  socket.once('close', () => clearTimeout(handshakeTimer));
}

function topLevelUpgrade(server, req, socket, head) {
  const cfg = parseTarget(req.url || '');
  if (!cfg) return; // not ours — let any other listener handle it
  try {
    forwardUpgrade(server, req, socket, head, cfg);
  } catch (err) {
    console.error('[WS-PROXY] upgrade handler threw:', err);
    try { socket.destroy(); } catch { /* ignore */ }
  }
}

const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.prependListener('upgrade', topLevelUpgrade.bind(null, this));
  return originalListen.apply(this, args);
};
