import { NextResponse } from 'next/server';
import { getUserCount } from '@/lib/db/queries/auth';

function validateApiKey(request: Request): boolean {
  const key = process.env.STATS_API_KEY;
  if (!key) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === key;
  }

  const url = new URL(request.url);
  return url.searchParams.get('key') === key;
}

export async function GET(request: Request) {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userCount = await getUserCount();

    return NextResponse.json(
      {
        users: userCount,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
      }
    );
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
