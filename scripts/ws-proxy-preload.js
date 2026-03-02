/**
 * WebSocket Proxy Preload Script
 *
 * Loaded via `node --require ./ws-proxy-preload.js server.js` in Docker.
 * Synchronously patches http.Server.prototype.listen to proxy WebSocket
 * upgrade requests at /api/embedded/stream/ws to the embedded browser's
 * stream server on 127.0.0.1:STREAM_PORT.
 */

const http = require('http');
const net = require('net');

const streamPort = parseInt(process.env.STREAM_PORT || '9223', 10);
const originalListen = http.Server.prototype.listen;

http.Server.prototype.listen = function (...args) {
  this.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/api/embedded/stream/ws')) return;

    const qs = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    const proxy = net.connect(streamPort, '127.0.0.1', () => {
      const lines = [
        `GET /${qs} HTTP/1.1`,
        `Host: 127.0.0.1:${streamPort}`,
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
