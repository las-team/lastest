import { NextRequest, NextResponse } from 'next/server';
import { runInspection, listInspectableRuns } from '@/server/actions/inspector';
import type { DiffEngineType, InspectorDimension, InspectorOptions } from '@/lib/db/schema';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const runs = await listInspectableRuns(id);
    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.startsWith('Forbidden') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

interface InspectRequestBody {
  currentResultId: string;
  baselineResultId: string;
  engine?: DiffEngineType;
  dimensions?: InspectorDimension[];
  options?: InspectorOptions;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: InspectRequestBody;
  try {
    body = (await request.json()) as InspectRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.currentResultId || !body.baselineResultId) {
    return NextResponse.json(
      { error: 'currentResultId and baselineResultId are required' },
      { status: 400 },
    );
  }

  try {
    const result = await runInspection({
      testId: id,
      currentResultId: body.currentResultId,
      baselineResultId: body.baselineResultId,
      engine: body.engine,
      dimensions: body.dimensions,
      options: body.options,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.startsWith('Forbidden') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
