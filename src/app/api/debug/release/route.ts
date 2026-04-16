import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { stopDebugSession } from '@/server/actions/debug';

// stopDebugSession -> queueCommandToDB touches pg/drizzle, so node runtime is required.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fire-and-forget release endpoint designed to be called via navigator.sendBeacon()
// from the debug page on tab close / reload / background. Server actions get aborted
// during page unload, but sendBeacon is guaranteed to deliver.
export async function POST(request: NextRequest) {
  // Defense-in-depth: only accept same-origin beacons. Missing header = non-browser caller,
  // which we can allow (the session cookie check still applies).
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    return new NextResponse(null, { status: 403 });
  }

  const session = await getCurrentSession();
  if (!session?.team) {
    return new NextResponse(null, { status: 401 });
  }

  let sessionId: string | null = null;
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await request.json();
      if (typeof body?.sessionId === 'string') sessionId = body.sessionId;
    } else {
      const form = await request.formData();
      const raw = form.get('sessionId');
      if (typeof raw === 'string' && raw) sessionId = raw;
    }
  } catch {
    // fall through — sessionId stays null
  }

  if (sessionId) {
    await stopDebugSession(sessionId).catch(() => {});
  }

  return new NextResponse(null, { status: 204 });
}
