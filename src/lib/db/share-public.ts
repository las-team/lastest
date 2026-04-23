// Share-flow DB helpers for the two public API routes (view, media). Uses
// raw SQL via `./raw-client` so the route's module graph stays tiny — no
// drizzle, no `./schema`, no query barrel. That keeps cold compile under a
// second and sidesteps the 16GB OOM the share flow has been hitting.
import { sql } from './raw-client';

type ShareRow = {
  build_id: string;
  test_id: string | null;
  status: string;
};

type DiffPathRow = {
  baseline_image_path: string | null;
  current_image_path: string | null;
  diff_image_path: string | null;
  planned_image_path: string | null;
  planned_diff_image_path: string | null;
  main_baseline_image_path: string | null;
  main_diff_image_path: string | null;
};

type ResultPathRow = {
  screenshot_path: string | null;
  video_path: string | null;
  screenshots: Array<{ path: string; label?: string }> | null;
};

export async function getShareAllowlist(slug: string): Promise<Set<string> | null> {
  const shares = await sql<ShareRow[]>`
    SELECT build_id, test_id, status
    FROM public_shares
    WHERE slug = ${slug}
    LIMIT 1
  `;
  const share = shares[0];
  if (!share || share.status !== 'public') return null;

  const builds = await sql<{ test_run_id: string | null }[]>`
    SELECT test_run_id FROM builds WHERE id = ${share.build_id} LIMIT 1
  `;
  if (builds.length === 0) return null;
  const testRunId = builds[0].test_run_id;

  const diffsPromise = share.test_id
    ? sql<DiffPathRow[]>`
        SELECT baseline_image_path, current_image_path, diff_image_path,
               planned_image_path, planned_diff_image_path,
               main_baseline_image_path, main_diff_image_path
        FROM visual_diffs
        WHERE build_id = ${share.build_id} AND test_id = ${share.test_id}
      `
    : sql<DiffPathRow[]>`
        SELECT baseline_image_path, current_image_path, diff_image_path,
               planned_image_path, planned_diff_image_path,
               main_baseline_image_path, main_diff_image_path
        FROM visual_diffs
        WHERE build_id = ${share.build_id}
      `;

  const resultsPromise: Promise<ResultPathRow[]> = testRunId
    ? share.test_id
      ? sql<ResultPathRow[]>`
          SELECT screenshot_path, video_path, screenshots
          FROM test_results
          WHERE test_run_id = ${testRunId} AND test_id = ${share.test_id}
        `
      : sql<ResultPathRow[]>`
          SELECT screenshot_path, video_path, screenshots
          FROM test_results
          WHERE test_run_id = ${testRunId}
        `
    : Promise.resolve([]);

  const [diffs, results] = await Promise.all([diffsPromise, resultsPromise]);

  const allow = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (p) allow.add(p.startsWith('/') ? p : `/${p}`);
  };
  for (const d of diffs) {
    add(d.baseline_image_path);
    add(d.current_image_path);
    add(d.diff_image_path);
    add(d.planned_image_path);
    add(d.planned_diff_image_path);
    add(d.main_baseline_image_path);
    add(d.main_diff_image_path);
  }
  for (const r of results) {
    add(r.screenshot_path);
    add(r.video_path);
    for (const s of r.screenshots ?? []) add(s.path);
  }
  return allow;
}
