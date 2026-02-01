import { NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { cleanupStaleJobs } from '@/server/actions/jobs';

// Track last cleanup time to avoid running too frequently
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 60000; // Run cleanup at most once per minute

export async function GET() {
  // Periodically clean up stale jobs (5 min timeout) and reset stuck runners
  const now = Date.now();
  if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;
    // Run cleanup async - don't block the response
    cleanupStaleJobs(300000).catch(() => {});
  }

  const jobs = await queries.getRecentBackgroundJobs(10000);
  return NextResponse.json(jobs);
}
