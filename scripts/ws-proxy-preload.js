const http = require('http');
const net = require('net');

const defaultStreamPort = parseInt(process.env.STREAM_PORT || '9223', 10);
const originalListen = http.Server.prototype.listen;

http.Server.prototype.listen = function (...args) {
  this.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/api/embedded/stream/ws')) return;

    // Block Next.js from ending the socket — it defers .end() after upgrade,
    // which races with the proxy pipe setup and kills the connection.
    const originalDestroy = socket.destroy.bind(socket);
    socket.end = () => { console.log('[WS-PROXY] socket.end() blocked'); return socket; };
    socket.destroy = (...a) => { console.log('[WS-PROXY] socket.destroy() called', new Error().stack?.split('\n').slice(1,4).join(' | ')); return originalDestroy(...a); };

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

    socket.on('close', (hadError) => console.log('[WS-PROXY] socket close event, hadError:', hadError));

    const proxy = net.connect(connectPort, connectHost, () => {
      console.log('[WS-PROXY] upstream connected to', connectHost, connectPort);
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
      proxy.pipe(socket, { end: false });
      socket.pipe(proxy);
    });
    proxy.on('error', (e) => { console.log('[WS-PROXY] proxy error:', e.message); socket.destroy(); });
    proxy.on('close', (hadError) => { console.log('[WS-PROXY] proxy close, hadError:', hadError); socket.destroy(); });
    socket.on('error', () => proxy.destroy());
    socket.on('close', () => proxy.destroy());
  });
  return originalListen.apply(this, args);
};
