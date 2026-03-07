/**
 * WebSocket Proxy Preload Script
 *
 * Loaded via `node --require ./ws-proxy-preload.js server.js` in Docker.
 * Synchronously patches http.Server.prototype.listen to proxy WebSocket
 * upgrade requests at /api/embedded/stream/ws to the embedded browser's
 * stream server.
 *
 * Supports two modes:
 * - Local: connects to 127.0.0.1:STREAM_PORT (single-container setup)
 * - Remote: connects to target host:port from ?target= query param (multi-container setup)
 */

const http = require('http');
const net = require('net');

const defaultStreamPort = parseInt(process.env.STREAM_PORT || '9223', 10);
const originalListen = http.Server.prototype.listen;

http.Server.prototype.listen = function (...args) {
  this.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/api/embedded/stream/ws')) return;

    const searchParams = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    const target = searchParams.get('target');

    // Determine connection target
    let connectHost = '127.0.0.1';
    let connectPort = defaultStreamPort;

    if (target) {
      // Multi-container: parse target=host:port from query string
      const parts = target.split(':');
      connectHost = parts[0];
      if (parts[1]) connectPort = parseInt(parts[1], 10);
    }

    // Build upstream query string (forward token but strip target)
    searchParams.delete('target');
    const upstreamQs = searchParams.toString() ? '?' + searchParams.toString() : '';

    const proxy = net.connect(connectPort, connectHost, () => {
      const lines = [
        `GET /${upstreamQs} HTTP/1.1`,
        `Host: ${connectHost}:${connectPort}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`,
        `Sec-WebSocket-Version: ${req.headers['sec-websocket-version']}`,
      ];
      if (req.headers['sec-websocket-protocol'])
        lines.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
      if (req.headers['sec-websocket-extensions'])
        lines.push(`Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}`);

      proxy.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length > 0) proxy.write(head);
      proxy.pipe(socket);
      socket.pipe(proxy);
    });
    proxy.on('error', () => socket.destroy());
    socket.on('error', () => proxy.destroy());
  });
  return originalListen.apply(this, args);
};
