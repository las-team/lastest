import { NextResponse } from 'next/server';
import { validateRunnerToken } from '@/server/actions/runners';
import { db } from '@/lib/db';
import { repositories, tests } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const runner = await validateRunnerToken(token);
    if (!runner) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Get repos for the runner's team with test counts
    const repos = await db
      .select({
        id: repositories.id,
        name: repositories.name,
        fullName: repositories.fullName,
        testCount: count(tests.id),
      })
      .from(repositories)
      .leftJoin(tests, eq(tests.repositoryId, repositories.id))
      .where(eq(repositories.teamId, runner.teamId))
      .groupBy(repositories.id);

    return NextResponse.json({ repos });
  } catch (error) {
    console.error('Failed to list repos:', error);
    return NextResponse.json({ error: 'Failed to list repos' }, { status: 500 });
  }
}
