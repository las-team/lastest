const http = require('http');
const net = require('net');

const defaultStreamPort = parseInt(process.env.STREAM_PORT || '9223', 10);
const originalListen = http.Server.prototype.listen;

http.Server.prototype.listen = function (...args) {
  this.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/api/embedded/stream/ws')) return;

    // Prevent Next.js from ending the socket after upgrade
    const originalEnd = socket.end.bind(socket);
    let owned = true;
    socket.end = (...a) => owned ? socket : originalEnd(...a);

    const searchParams = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    const target = searchParams.get('target');

    let connectHost = '127.0.0.1';
    let connectPort = defaultStreamPort;
    if (target) {
      const parts = target.split(':');
      connectHost = parts[0];
      if (parts[1]) connectPort = parseInt(parts[1], 10);
    }

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
      owned = false;
      proxy.pipe(socket);
      socket.pipe(proxy);
    });
    proxy.on('error', () => { owned = false; socket.destroy(); });
    socket.on('error', () => proxy.destroy());
    socket.on('close', () => proxy.destroy());
  });
  return originalListen.apply(this, args);
};
