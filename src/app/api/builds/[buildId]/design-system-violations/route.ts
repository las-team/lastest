/**
 * Per-rule design-system violation drill-in for a build. Same data the
 * `DesignSystemViolationsCard` renders in the UI, exposed for
 * programmatic access (CI gates, dashboards, custom reports). Accepts a
 * session cookie OR an API key `Bearer <token>` — mirrors the rest of
 * the /api/builds surface.
 *
 * Query params:
 *   ?format=json (default) → JSON array of BuildDesignSystemViolationRow
 *   ?format=csv            → CSV with one row per (rule × sample test).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { verifyBearerToken } from "@/lib/auth/api-key";
import * as queries from "@/lib/db/queries";

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyBearerToken(authHeader.slice(7));
  }
  return null;
}

function escapeCsv(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ buildId: string }> },
) {
  const session = await verifyAuth(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.team)
    return NextResponse.json({ error: "No team" }, { status: 403 });

  const { buildId } = await params;
  const build = await queries.getBuild(buildId);
  if (!build)
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (!build.testRunId)
    return NextResponse.json({ error: "Build has no run" }, { status: 404 });
  const run = await queries.getTestRun(build.testRunId);
  if (!run?.repositoryId)
    return NextResponse.json(
      { error: "Build has no repo binding" },
      { status: 404 },
    );
  const repo = await queries.getRepository(run.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const violations = await queries.getBuildDesignSystemViolations(buildId);
  const format = new URL(request.url).searchParams.get("format");

  if (format === "csv") {
    const header = [
      "rule_id",
      "category",
      "property",
      "actual",
      "expected",
      "expected_name",
      "impact",
      "occurrence_count",
      "total_nodes",
      "sample_test_id",
      "sample_test_name",
      "sample_area",
      "sample_selector",
    ].join(",");
    const lines = [header];
    for (const v of violations) {
      const samples =
        v.samples.length > 0
          ? v.samples
          : [
              {
                testResultId: "",
                testId: null,
                testName: null,
                areaName: null,
                nodes: 0,
                sampleNode: undefined,
              },
            ];
      for (const s of samples) {
        lines.push(
          [
            escapeCsv(v.id),
            escapeCsv(v.category),
            escapeCsv(v.property),
            escapeCsv(v.actual),
            escapeCsv(v.expected),
            escapeCsv(v.expectedName),
            escapeCsv(v.impact),
            escapeCsv(v.occurrenceCount),
            escapeCsv(v.totalNodes),
            escapeCsv(s.testId),
            escapeCsv(s.testName),
            escapeCsv(s.areaName),
            escapeCsv(s.sampleNode?.target?.join(" ")),
          ].join(","),
        );
      }
    }
    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="build-${buildId}-design-system-violations.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ buildId, violations });
}
