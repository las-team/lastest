import { NextResponse } from 'next/server';

/**
 * GET /api/embedded/stream/ws
 *
 * Placeholder route so Next.js doesn't 404/redirect WebSocket upgrade requests.
 * The actual WebSocket upgrade is handled by ws-proxy-preload.js at the raw HTTP level.
 * If this route is hit as a normal HTTP request (not upgrade), return 426.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'WebSocket upgrade required' },
    { status: 426 }
  );
}
