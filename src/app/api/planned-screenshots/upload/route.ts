import { NextRequest, NextResponse } from 'next/server';
import { uploadPlannedScreenshot } from '@/server/actions/planned-screenshots';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const session = await getCurrentSession();
    if (!session?.team) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const repositoryId = formData.get('repositoryId') as string | null;
    const testId = formData.get('testId') as string | null;
    const stepLabel = formData.get('stepLabel') as string | null;
    const routeId = formData.get('routeId') as string | null;
    const name = formData.get('name') as string | null;
    const description = formData.get('description') as string | null;
    const sourceUrl = formData.get('sourceUrl') as string | null;

    // Validation
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!repositoryId) {
      return NextResponse.json({ error: 'repositoryId is required' }, { status: 400 });
    }

    // Verify repo belongs to team
    const repo = await queries.getRepository(repositoryId);
    if (!repo || repo.teamId !== session.team.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!testId && !routeId) {
      return NextResponse.json(
        { error: 'Either testId or routeId must be provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload using server action
    const result = await uploadPlannedScreenshot(
      {
        repositoryId,
        testId: testId || undefined,
        stepLabel: stepLabel || undefined,
        routeId: routeId || undefined,
        name: name || undefined,
        description: description || undefined,
        sourceUrl: sourceUrl || undefined,
      },
      buffer,
      file.name
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to upload planned screenshot:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
