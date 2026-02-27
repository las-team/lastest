/**
 * Next.js Instrumentation Hook
 *
 * Intercepts the Node.js HTTP server to proxy WebSocket upgrade requests
 * at /api/embedded/stream/ws to the embedded browser's stream server on localhost:9223.
 */

import type { IncomingMessage } from 'http';
import type { Socket } from 'net';

export async function onRequestError() {
  // Required export — intentionally empty
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { Server } = await import('http');
    const net = await import('net');

    const streamPort = parseInt(process.env.STREAM_PORT || '9223', 10);

    const originalListen = Server.prototype.listen;

    Server.prototype.listen = function (this: InstanceType<typeof Server>, ...args: unknown[]) {
      this.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const url = req.url || '';

        // Only proxy /api/embedded/stream/ws requests
        if (!url.startsWith('/api/embedded/stream/ws')) return;

        // Forward query string (auth token etc.)
        const qs = url.includes('?') ? url.slice(url.indexOf('?')) : '';

        // Create a TCP connection to the stream server
        const proxy = net.connect(streamPort, '127.0.0.1', () => {
          const upgradeReq = [
            `GET /${qs} HTTP/1.1`,
            `Host: 127.0.0.1:${streamPort}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`,
            `Sec-WebSocket-Version: ${req.headers['sec-websocket-version']}`,
          ];

          if (req.headers['sec-websocket-protocol']) {
            upgradeReq.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
          }
          if (req.headers['sec-websocket-extensions']) {
            upgradeReq.push(`Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}`);
          }

          proxy.write(upgradeReq.join('\r\n') + '\r\n\r\n');
          if (head.length > 0) {
            proxy.write(head);
          }

          proxy.pipe(socket);
          socket.pipe(proxy);
        });

        proxy.on('error', () => socket.destroy());
        socket.on('error', () => proxy.destroy());
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalListen.apply(this, args as any);
    } as typeof originalListen;
  }
}
