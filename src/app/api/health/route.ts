import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    // Check database connectivity
    await db.run(sql`SELECT 1`);

    return NextResponse.json({
      status: 'healthy',
      version: process.env.NEXT_PUBLIC_GIT_HASH || 'dev',
      commitCount: process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT || '0',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    console.error('[health] Database check failed:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      },
      { status: 503 }
    );
  }
}
