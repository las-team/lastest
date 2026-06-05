/**
 * Team/repo ownership checks for the authenticated `/api/media/[...path]`
 * endpoint. Each subdir under `storage/` has its own scope rule — extracted
 * here so the route handler stays readable and so callers (server-side
 * thumbnail generators, share pages) can reuse the same authorization.
 *
 * The default contract: `requireMediaAccess(segments, session)` returns a
 * boolean — true iff `session` may read the file at `storage/<segments…>`.
 * `traces` is public and never reaches this helper; the route handles its
 * exemption directly.
 */

import { db } from "@/lib/db";
import {
  baselines,
  bugReports,
  repositories,
  testFixtures,
  tests,
  visualDiffs,
} from "@/lib/db/schema";
import { getRepository, getBackgroundJob } from "@/lib/db/queries";
import { eq, or } from "drizzle-orm";
import type { SessionData } from "./session";

type MediaSegments = readonly string[];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Subdirs that lay files out as `<subdir>/<repoId>/<file>`. For these we
 * simply look up the repo and check its team.
 */
const REPO_PREFIXED_SUBDIRS = new Set([
  "screenshots",
  "videos",
  "planned",
  "network-bodies",
  "csv-sources",
]);

export type MediaAccessDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; message: string };

export async function checkMediaAccess(
  segments: MediaSegments,
  session: SessionData,
): Promise<MediaAccessDecision> {
  const subdir = segments[0];
  if (!subdir) return { ok: false, status: 400, message: "Missing path" };
  const teamId = session.team?.id;
  if (!teamId) return { ok: false, status: 403, message: "Forbidden" };

  if (REPO_PREFIXED_SUBDIRS.has(subdir)) {
    const repoId = segments[1];
    if (!repoId || !UUID_RE.test(repoId)) {
      return { ok: false, status: 400, message: "Missing repository id" };
    }
    const repo = await getRepository(repoId);
    if (!repo) return { ok: false, status: 404, message: "Not found" };
    if (repo.teamId !== teamId)
      return { ok: false, status: 403, message: "Forbidden" };
    return { ok: true };
  }

  if (subdir === "url-diffs") {
    const jobId = segments[1];
    if (!jobId) return { ok: false, status: 400, message: "Missing job id" };
    const job = await getBackgroundJob(jobId);
    if (!job) return { ok: false, status: 404, message: "Not found" };
    const meta = (job.metadata ?? {}) as { teamId?: string };
    const teamMatches = meta.teamId && meta.teamId === teamId;
    let repoMatches = false;
    if (job.repositoryId) {
      const repo = await getRepository(job.repositoryId);
      repoMatches = !!repo && repo.teamId === teamId;
    }
    return teamMatches || repoMatches
      ? { ok: true }
      : { ok: false, status: 403, message: "Forbidden" };
  }

  if (subdir === "bug-reports") {
    // Layout: bug-reports/<reportId>.png — reportId is a UUID.
    const filename = segments[1];
    if (!filename)
      return { ok: false, status: 400, message: "Missing report id" };
    const reportId = filename.replace(/\.png$/i, "");
    if (!UUID_RE.test(reportId)) {
      return { ok: false, status: 400, message: "Invalid report id" };
    }
    const [row] = await db
      .select({ teamId: bugReports.teamId })
      .from(bugReports)
      .where(eq(bugReports.id, reportId))
      .limit(1);
    if (!row) return { ok: false, status: 404, message: "Not found" };
    return row.teamId === teamId
      ? { ok: true }
      : { ok: false, status: 403, message: "Forbidden" };
  }

  if (subdir === "baselines") {
    // Layout: baselines/<file.png> (flat). Filenames are not user-facing
    // secrets — must look up by stored imagePath and confirm team.
    const imagePath = "/" + segments.join("/");
    const [row] = await db
      .select({ teamId: repositories.teamId })
      .from(baselines)
      .innerJoin(repositories, eq(repositories.id, baselines.repositoryId))
      .where(eq(baselines.imagePath, imagePath))
      .limit(1);
    if (!row) return { ok: false, status: 404, message: "Not found" };
    return row.teamId === teamId
      ? { ok: true }
      : { ok: false, status: 403, message: "Forbidden" };
  }

  if (subdir === "diffs") {
    // Layout: diffs/<file.png> (flat). Look up the row by either the diff
    // image path or the current image path — diffs/ holds both products.
    const imagePath = "/" + segments.join("/");
    const [row] = await db
      .select({ teamId: repositories.teamId })
      .from(visualDiffs)
      .innerJoin(tests, eq(tests.id, visualDiffs.testId))
      .innerJoin(repositories, eq(repositories.id, tests.repositoryId))
      .where(
        or(
          eq(visualDiffs.diffImagePath, imagePath),
          eq(visualDiffs.currentImagePath, imagePath),
        ),
      )
      .limit(1);
    if (!row) return { ok: false, status: 404, message: "Not found" };
    return row.teamId === teamId
      ? { ok: true }
      : { ok: false, status: 403, message: "Forbidden" };
  }

  if (subdir === "fixtures") {
    // Layout: fixtures/<…>. The DB stores `storagePath` as a relative URL
    // path; match exactly.
    const storagePath = "/" + segments.join("/");
    const [row] = await db
      .select({ teamId: repositories.teamId })
      .from(testFixtures)
      .innerJoin(repositories, eq(repositories.id, testFixtures.repositoryId))
      .where(eq(testFixtures.storagePath, storagePath))
      .limit(1);
    if (!row) return { ok: false, status: 404, message: "Not found" };
    return row.teamId === teamId
      ? { ok: true }
      : { ok: false, status: 403, message: "Forbidden" };
  }

  // Unknown subdir reaches this point. The route's allowlist
  // (resolveStoragePath) already rejects unknown subdirs, but if a new one
  // is added without updating this file we fail closed.
  return { ok: false, status: 403, message: "Unscoped media subdirectory" };
}
