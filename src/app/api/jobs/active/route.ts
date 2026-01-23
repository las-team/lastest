import { NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';

export async function GET() {
  const jobs = await queries.getRecentBackgroundJobs(10000);
  return NextResponse.json(jobs);
}
