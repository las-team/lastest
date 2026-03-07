import { NextResponse } from 'next/server';

/**
 * GET /api/config
 *
 * Returns public configuration for the client.
 * No auth required — only exposes non-sensitive flags.
 */
export async function GET() {
  return NextResponse.json({
    disableLocalRunner: process.env.DISABLE_LOCAL_RUNNER === 'true',
  });
}
