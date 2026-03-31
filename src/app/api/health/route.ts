import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

function getBuildInfo() {
  try {
    const infoPath = path.join(process.cwd(), 'build-info.json');
    if (fs.existsSync(infoPath)) {
      return JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    }
  } catch {}
  return { gitHash: 'dev', commitCount: '0', version: '0.0.0', runnerVersion: '0.0.0' };
}

const buildInfo = getBuildInfo();

export async function GET() {
  try {
    // Check database connectivity
    await db.execute(sql`SELECT 1`);

    return NextResponse.json({
      status: 'healthy',
      version: buildInfo.gitHash,
      commitCount: buildInfo.commitCount,
      appVersion: buildInfo.version,
      runnerVersion: buildInfo.runnerVersion,
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
