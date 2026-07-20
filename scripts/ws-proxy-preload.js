/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * WebSocket upgrade proxy — loaded via `node --require ./ws-proxy-preload.js`.
 *
 * Intercepts the http.Server 'upgrade' event BEFORE Next.js's own upgrade
 * handler runs, and forwards /api/embedded/stream/ws to its upstream TCP
 * endpoint (the EB pod named in the signed grant).
 *
 * Next's fallback upgrade handler fires synchronously after ours and can
 * schedule socket.destroy/end via microtasks. Two guards keep those from
 * corrupting our tunnel:
 *   - `claimed` — blocks socket.write until the upstream 101 arrives, so
 *     Next can't inject a 404 body into the handshake.
 *   - `sessionOver` — blocks socket.end/destroy for the socket's lifetime;
 *     only OUR teardown flips it, so latent Next cleanup calls are ignored
 *     and the pipe stays up until TCP naturally closes.
 * Upstream's 101 + any trailing WS frame are read manually and forwarded
 * before piping begins, guaranteeing handshake bytes are in order.
 */

const http = require("http");
const net = require("net");
const crypto = require("crypto");

const DEBUG = process.env.WS_PROXY_DEBUG === "1";
const dlog = DEBUG
  ? (label, ...a) => console.log(`[WS-PROXY:${label}]`, ...a)
  : () => {};

/**
 * Signed-grant verification. This MIRRORS src/lib/eb/stream-grant.ts — see that
 * file for the format and rationale. It is duplicated rather than imported
 * because this preload runs before any bundler or TS loader exists. Keep the
 * two byte-compatible.
 */
const GRANT_KEY_INFO = "eb-stream-grant-v1";
const ENCRYPTION_KEY_RE = /^[0-9a-f]{64}$/i;

function streamGrantKey() {
  const hex = (process.env.ENCRYPTION_KEY || "").trim();
  if (!hex || !ENCRYPTION_KEY_RE.test(hex)) return null;
  return crypto
    .createHmac("sha256", Buffer.from(hex, "hex"))
    .update(GRANT_KEY_INFO)
    .digest();
}

function verifyStreamGrant(grant) {
  if (!grant) return null;
  const key = streamGrantKey();
  if (!key) return null;

  const dot = grant.indexOf(".");
  if (dot <= 0 || dot === grant.length - 1) return null;
  const encoded = grant.slice(0, dot);
  const sig = grant.slice(dot + 1);

  const expected = crypto
    .createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.h !== "string" || !payload.h) return null;
  if (!Number.isInteger(payload.p) || payload.p < 1 || payload.p > 65535) {
    return null;
  }
  if (typeof payload.e !== "number" || Date.now() > payload.e) return null;
  return payload;
}

function parseTarget(url) {
  if (url.startsWith("/api/embedded/stream/ws")) {
    const qi = url.indexOf("?");
    const sp = new URLSearchParams(qi >= 0 ? url.slice(qi + 1) : "");

    // The upstream address comes ONLY from the signed grant.
    const payload = verifyStreamGrant(sp.get("g"));
    if (!payload) {
      dlog("embedded-stream", "rejected: missing/invalid grant");
      return {
        reject: {
          code: 403,
          text: "Forbidden",
          body: streamGrantKey()
            ? "ws-proxy: missing, invalid or expired stream grant"
            : "ws-proxy: no usable grant signing key (ENCRYPTION_KEY unset or malformed)",
        },
      };
    }

    sp.delete("g");
    const qs = sp.toString();
    return {
      host: payload.h,
      port: payload.p,
      path: "/" + (qs ? "?" + qs : ""),
      label: "embedded-stream",
      sessionId: payload.s || "",
    };
  }
  return null;
}

function forwardUpgrade(server, req, socket, head, cfg) {
  const realWrite = socket.write.bind(socket);
  const realEnd = socket.end.bind(socket);
  const realDestroy = socket.destroy.bind(socket);
  let claimed = true; // blocks socket.write pre-upgrade
  let sessionOver = false; // only our teardown flips this — gates end/destroy
  socket.write = (...a) => {
    if (claimed) {
      dlog(cfg.label, "blocked external socket.write", a[0] && a[0].length);
      return true;
    }
    return realWrite(...a);
  };
  socket.end = (...a) => {
    if (!sessionOver) {
      dlog(cfg.label, "blocked external socket.end");
      return socket;
    }
    return realEnd(...a);
  };
  socket.destroy = (...a) => {
    if (!sessionOver) {
      dlog(cfg.label, "blocked external socket.destroy");
      return socket;
    }
    return realDestroy(...a);
  };

  try {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
  } catch {
    /* ignore */
  }

  let upstreamClosed = false;
  let clientClosed = false;
  let upgraded = false;
  let upstream = null;

  // Synthesize an HTTP error response when we abort before the upgrade
  // succeeds. Without this, browsers see a bare "WebSocket connection failed"
  // with no status — making dead-EB-pod-IPs (the most common cause) impossible
  // to diagnose from DevTools.
  const writeSyntheticError = (status, statusText, bodyText) => {
    const body = Buffer.from(bodyText + "\n");
    const headers =
      `HTTP/1.1 ${status} ${statusText}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Length: ${body.length}\r\n` +
      `Connection: close\r\n\r\n`;
    try {
      realWrite(headers);
      realWrite(body);
    } catch {
      /* ignore */
    }
  };

  // teardown(reason, { hadError, clientStatus }) — on clean close (hadError=false)
  // we send a graceful FIN via end() so any data still buffered on the pipe
  // drains. On error we RST via destroy(). If clientStatus is set and we never
  // upgraded, write that synthetic HTTP response so the client gets a real code.
  const teardown = (reason, opts) => {
    const hadError = opts && opts.hadError;
    const clientStatus = opts && opts.clientStatus;
    dlog(cfg.label, "teardown:", reason, "hadError=", !!hadError);
    claimed = false;
    if (upstream && !upstreamClosed) {
      upstreamClosed = true;
      try {
        hadError ? upstream.destroy() : upstream.end();
      } catch {
        /* ignore */
      }
    }
    if (!clientClosed) {
      clientClosed = true;
      sessionOver = true;
      if (!upgraded && clientStatus) {
        writeSyntheticError(
          clientStatus.code,
          clientStatus.text,
          clientStatus.body,
        );
        try {
          realEnd();
        } catch {
          /* ignore */
        }
      } else {
        try {
          hadError ? realDestroy() : realEnd();
        } catch {
          /* ignore */
        }
      }
    }
  };

  socket.on("error", (e) => {
    dlog(cfg.label, "client error:", e.message);
    teardown("client-error", { hadError: true });
  });
  socket.on("end", () => {
    teardown("client-end", { hadError: false });
  });
  socket.on("close", (hadErr) => {
    clientClosed = true;
    teardown("client-close", { hadError: hadErr });
  });

  upstream = net.connect(cfg.port, cfg.host);
  // Short connect timeout so a stuck pool member fails fast instead of waiting
  // out the Envoy sidecar's 15s route timeout (which would surface as a 520).
  upstream.setTimeout(5_000);
  upstream.once("timeout", () => {
    if (!upgraded) {
      dlog(cfg.label, "connect timeout");
      teardown("connect-timeout", {
        hadError: true,
        clientStatus: {
          code: 504,
          text: "Gateway Timeout",
          body: `ws-proxy: upstream connect timeout (${cfg.host}:${cfg.port}) — likely a torn-down EB pod`,
        },
      });
    }
  });
  upstream.once("connect", () => {
    try {
      upstream.setTimeout(0);
    } catch {
      /* ignore */
    }
  });
  try {
    upstream.setNoDelay(true);
    upstream.setKeepAlive(true, 30_000);
  } catch {
    /* ignore */
  }
  upstream.on("error", (e) => {
    dlog(cfg.label, "upstream error:", e.message);
    teardown("upstream-error", {
      hadError: true,
      clientStatus: {
        code: 502,
        text: "Bad Gateway",
        body: `ws-proxy: upstream error (${cfg.host}:${cfg.port}): ${e.message}`,
      },
    });
  });
  upstream.on("end", () => {
    teardown("upstream-end", { hadError: false });
  });
  upstream.on("close", (hadErr) => {
    upstreamClosed = true;
    teardown("upstream-close", { hadError: hadErr });
  });

  upstream.on("connect", () => {
    dlog(cfg.label, "upstream connected", cfg.host + ":" + cfg.port);
    const lines = [
      "GET " + cfg.path + " HTTP/1.1",
      "Host: " + cfg.host + ":" + cfg.port,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: " + req.headers["sec-websocket-key"],
      "Sec-WebSocket-Version: " +
        (req.headers["sec-websocket-version"] || "13"),
    ];
    if (req.headers["sec-websocket-protocol"]) {
      lines.push(
        "Sec-WebSocket-Protocol: " + req.headers["sec-websocket-protocol"],
      );
    }
    if (req.headers["sec-websocket-extensions"]) {
      lines.push(
        "Sec-WebSocket-Extensions: " + req.headers["sec-websocket-extensions"],
      );
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
  });

  // Read the upstream response header ourselves. Only after we see a 101 do
  // we start piping — guarantees the client sees the 101 before any binary
  // frames and prevents Next.js's potential 404 from interleaving.
  let headerBuf = Buffer.alloc(0);
  const onData = (chunk) => {
    if (upgraded) return;
    headerBuf = Buffer.concat([headerBuf, chunk]);
    const sep = headerBuf.indexOf("\r\n\r\n");
    if (sep === -1) {
      if (headerBuf.length > 32_768)
        teardown("oversized-upstream-header", {
          hadError: true,
          clientStatus: {
            code: 502,
            text: "Bad Gateway",
            body: "ws-proxy: upstream header exceeded 32KiB",
          },
        });
      return;
    }
    const hbytes = headerBuf.subarray(0, sep + 4);
    const trailing = headerBuf.subarray(sep + 4);
    const statusLine = hbytes.toString("utf8", 0, hbytes.indexOf("\r\n"));
    const m = /^HTTP\/1\.[01]\s+(\d+)/.exec(statusLine);
    const code = m ? parseInt(m[1], 10) : 0;
    if (code !== 101) {
      dlog(cfg.label, "upstream refused upgrade:", statusLine);
      claimed = false; // allow our final write to go through
      try {
        realWrite(hbytes);
        if (trailing.length) realWrite(trailing);
      } catch {
        /* ignore */
      }
      teardown("upstream-non-101");
      return;
    }

    upgraded = true;
    claimed = false; // pipe(upstream→socket) needs socket.write to pass through

    try {
      realWrite(hbytes);
      if (trailing.length) realWrite(trailing);
    } catch {
      /* ignore */
    }

    upstream.removeListener("data", onData);
    upstream.pipe(socket, { end: false });
    socket.pipe(upstream, { end: false });
    dlog(cfg.label, "upgrade complete");
  };
  upstream.on("data", onData);

  const handshakeTimer = setTimeout(() => {
    if (!upgraded) {
      dlog(cfg.label, "handshake timeout");
      teardown("handshake-timeout", {
        hadError: true,
        clientStatus: {
          code: 504,
          text: "Gateway Timeout",
          body: `ws-proxy: upstream handshake timeout (${cfg.host}:${cfg.port})`,
        },
      });
    }
  }, 15_000);
  upstream.once("close", () => clearTimeout(handshakeTimer));
  socket.once("close", () => clearTimeout(handshakeTimer));
}

/**
 * Refuse an upgrade we own but will not proxy. Written directly to the socket
 * because we never opened an upstream — the client gets a real status code
 * instead of a bare "WebSocket connection failed".
 */
function rejectUpgrade(socket, reject) {
  const body = Buffer.from(reject.body + "\n");
  try {
    socket.write(
      `HTTP/1.1 ${reject.code} ${reject.text}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n` +
        `Content-Length: ${body.length}\r\n` +
        `Connection: close\r\n\r\n`,
    );
    socket.write(body);
    socket.end();
  } catch {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

function topLevelUpgrade(server, req, socket, head) {
  const cfg = parseTarget(req.url || "");
  if (!cfg) return; // not ours — let any other listener handle it
  if (cfg.reject) return rejectUpgrade(socket, cfg.reject);
  try {
    forwardUpgrade(server, req, socket, head, cfg);
  } catch (err) {
    console.error("[WS-PROXY] upgrade handler threw:", err);
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.prependListener("upgrade", topLevelUpgrade.bind(null, this));
  return originalListen.apply(this, args);
};

module.exports = { verifyStreamGrant, parseTarget };
