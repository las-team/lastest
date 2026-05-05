/**
 * Centralized entity-ownership guards.
 *
 * Every helper here loads the entity by id, walks to its repo (or team),
 * verifies the caller's team owns it, and throws `Error('Forbidden: …')`
 * on mismatch. Pair these with `requireTeamAccess` / `requireRepoAccess`
 * from `./session` so server actions get a consistent IDOR-proof shape.
 *
 * Conventions:
 *   - Throws on missing or cross-team. Never returns undefined.
 *   - Returns `{ session, <entity> }` so callers don't need a second fetch.
 *   - For entities whose `repositoryId` may be null (team-wide rows),
 *     we fall back to `teamId` and require the row's team to match.
 */
import * as queries from '@/lib/db/queries';
import { db } from '@/lib/db';
import { embeddedSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireTeamAccess } from './session';
import type { SessionData } from './session';
import type {
  Team,
  Build,
  TestRun,
  TestResult,
  Test,
  FunctionalArea,
  VisualDiff,
  PlannedScreenshot,
  BuildSchedule,
  SetupConfig,
  SetupScript,
  StorageState,
  BackgroundJob,
  Runner,
  EmbeddedSession,
  SpecImport,
  TestFixture,
  CsvDataSource,
  Repository,
} from '@/lib/db/schema';

type SessionWithTeam = SessionData & { team: Team };

function forbid(reason: string): never {
  throw new Error(`Forbidden: ${reason}`);
}

async function assertRepoTeam(
  repositoryId: string,
  teamId: string,
): Promise<Repository> {
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== teamId) forbid('Resource does not belong to your team');
  return repo;
}

// ──────────────────────────────────────────────────────────────────────────
// Repository (already wrapped by requireRepoAccess; re-exported as a
// thin wrapper so call-sites have a uniform shape).

export async function requireRepoOwnership(repositoryId: string): Promise<{
  session: SessionWithTeam;
  repo: Repository;
}> {
  const session = await requireTeamAccess();
  const repo = await assertRepoTeam(repositoryId, session.team.id);
  return { session, repo };
}

// ──────────────────────────────────────────────────────────────────────────
// Test

export async function requireTestOwnership(testId: string): Promise<{
  session: SessionWithTeam;
  test: Test;
}> {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) forbid('Test not found');
  if (!test.repositoryId) forbid('Test has no repository binding');
  await assertRepoTeam(test.repositoryId, session.team.id);
  return { session, test };
}

// ──────────────────────────────────────────────────────────────────────────
// FunctionalArea

export async function requireAreaOwnership(areaId: string): Promise<{
  session: SessionWithTeam;
  area: FunctionalArea;
}> {
  const session = await requireTeamAccess();
  const area = await queries.getFunctionalArea(areaId);
  if (!area) forbid('Area not found');
  if (!area.repositoryId) forbid('Area has no repository binding');
  await assertRepoTeam(area.repositoryId, session.team.id);
  return { session, area };
}

// ──────────────────────────────────────────────────────────────────────────
// TestRun

export async function requireRunOwnership(runId: string): Promise<{
  session: SessionWithTeam;
  run: TestRun;
}> {
  const session = await requireTeamAccess();
  const run = await queries.getTestRun(runId);
  if (!run) forbid('Test run not found');
  if (!run.repositoryId) forbid('Test run has no repository binding');
  await assertRepoTeam(run.repositoryId, session.team.id);
  return { session, run };
}

// ──────────────────────────────────────────────────────────────────────────
// Build (build → testRun → repo)

export async function requireBuildOwnership(buildId: string): Promise<{
  session: SessionWithTeam;
  build: Build;
}> {
  const session = await requireTeamAccess();
  const build = await queries.getBuild(buildId);
  if (!build) forbid('Build not found');
  if (!build.testRunId) forbid('Build has no test run');
  const run = await queries.getTestRun(build.testRunId);
  if (!run || !run.repositoryId) forbid('Build has no repository binding');
  await assertRepoTeam(run.repositoryId, session.team.id);
  return { session, build };
}

// ──────────────────────────────────────────────────────────────────────────
// VisualDiff (diff → build → testRun → repo)

export async function requireDiffOwnership(diffId: string): Promise<{
  session: SessionWithTeam;
  diff: VisualDiff;
}> {
  const session = await requireTeamAccess();
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) forbid('Diff not found');
  const build = await queries.getBuild(diff.buildId);
  if (!build || !build.testRunId) forbid('Diff has no build');
  const run = await queries.getTestRun(build.testRunId);
  if (!run || !run.repositoryId) forbid('Diff has no repository binding');
  await assertRepoTeam(run.repositoryId, session.team.id);
  return { session, diff };
}

// ──────────────────────────────────────────────────────────────────────────
// TestResult (result → testRun → repo)

export async function requireTestResultOwnership(resultId: string): Promise<{
  session: SessionWithTeam;
  result: TestResult;
}> {
  const session = await requireTeamAccess();
  const result = await queries.getTestResultById(resultId);
  if (!result) forbid('Test result not found');
  if (!result.testRunId) forbid('Test result has no run');
  const run = await queries.getTestRun(result.testRunId);
  if (!run || !run.repositoryId) forbid('Test result has no repository binding');
  await assertRepoTeam(run.repositoryId, session.team.id);
  return { session, result };
}

// ──────────────────────────────────────────────────────────────────────────
// PlannedScreenshot

export async function requirePlannedScreenshotOwnership(plannedId: string): Promise<{
  session: SessionWithTeam;
  planned: PlannedScreenshot;
}> {
  const session = await requireTeamAccess();
  const planned = await queries.getPlannedScreenshot(plannedId);
  if (!planned) forbid('Planned screenshot not found');
  if (!planned.repositoryId) forbid('Planned screenshot has no repository binding');
  await assertRepoTeam(planned.repositoryId, session.team.id);
  return { session, planned };
}

// ──────────────────────────────────────────────────────────────────────────
// Schedule

export async function requireScheduleOwnership(scheduleId: string): Promise<{
  session: SessionWithTeam;
  schedule: BuildSchedule;
}> {
  const session = await requireTeamAccess();
  const schedule = await queries.getBuildSchedule(scheduleId);
  if (!schedule) forbid('Schedule not found');
  if (!schedule.repositoryId) forbid('Schedule has no repository binding');
  await assertRepoTeam(schedule.repositoryId, session.team.id);
  return { session, schedule };
}

// ──────────────────────────────────────────────────────────────────────────
// SetupConfig

export async function requireSetupConfigOwnership(configId: string): Promise<{
  session: SessionWithTeam;
  config: SetupConfig;
}> {
  const session = await requireTeamAccess();
  const config = await queries.getSetupConfig(configId);
  if (!config) forbid('Setup config not found');
  if (!config.repositoryId) forbid('Setup config has no repository binding');
  await assertRepoTeam(config.repositoryId, session.team.id);
  return { session, config };
}

// ──────────────────────────────────────────────────────────────────────────
// SetupScript

export async function requireSetupScriptOwnership(scriptId: string): Promise<{
  session: SessionWithTeam;
  script: SetupScript;
}> {
  const session = await requireTeamAccess();
  const script = await queries.getSetupScript(scriptId);
  if (!script) forbid('Setup script not found');
  if (!script.repositoryId) forbid('Setup script has no repository binding');
  await assertRepoTeam(script.repositoryId, session.team.id);
  return { session, script };
}

// ──────────────────────────────────────────────────────────────────────────
// StorageState (repositoryId may be null → team-wide; require any repo in
// the row is the caller's, otherwise require team-wide rows have no repo)

export async function requireStorageStateOwnership(stateId: string): Promise<{
  session: SessionWithTeam;
  state: StorageState;
}> {
  const session = await requireTeamAccess();
  const state = await queries.getStorageState(stateId);
  if (!state) forbid('Storage state not found');
  if (state.repositoryId) {
    await assertRepoTeam(state.repositoryId, session.team.id);
  }
  // Team-wide (null) storage states: there is no per-team binding on the
  // row, so we deliberately refuse cross-tenant access by id since we
  // can't prove ownership. Callers that legitimately need team-wide
  // rows should list them by team-scoped repos rather than by id.
  if (!state.repositoryId) forbid('Storage state has no repository binding');
  return { session, state };
}

// ──────────────────────────────────────────────────────────────────────────
// BackgroundJob (job.repositoryId may be null for "global" jobs — refuse
// cross-tenant access since there is no team binding on those rows.)

export async function requireBackgroundJobOwnership(jobId: string): Promise<{
  session: SessionWithTeam;
  job: BackgroundJob;
}> {
  const session = await requireTeamAccess();
  const job = await queries.getBackgroundJob(jobId);
  if (!job) forbid('Job not found');
  if (!job.repositoryId) forbid('Job is not bound to a team-owned repository');
  await assertRepoTeam(job.repositoryId, session.team.id);
  return { session, job };
}

// ──────────────────────────────────────────────────────────────────────────
// Runner (runner.teamId is the binding)

export async function requireRunnerOwnership(runnerId: string): Promise<{
  session: SessionWithTeam;
  runner: Runner;
}> {
  const session = await requireTeamAccess();
  const runner = await queries.getRunnerById(runnerId);
  if (!runner) forbid('Runner not found');
  if (runner.teamId !== session.team.id) forbid('Runner does not belong to your team');
  return { session, runner };
}

// ──────────────────────────────────────────────────────────────────────────
// EmbeddedSession (session.teamId is the binding)

export async function requireEmbeddedSessionOwnership(sessionId: string): Promise<{
  session: SessionWithTeam;
  embedded: EmbeddedSession;
}> {
  const sessionData = await requireTeamAccess();
  const [embedded] = await db
    .select()
    .from(embeddedSessions)
    .where(eq(embeddedSessions.id, sessionId));
  if (!embedded) forbid('Embedded session not found');
  if (embedded.teamId !== sessionData.team.id) {
    forbid('Embedded session does not belong to your team');
  }
  return { session: sessionData, embedded };
}

// ──────────────────────────────────────────────────────────────────────────
// SpecImport

export async function requireSpecImportOwnership(importId: string): Promise<{
  session: SessionWithTeam;
  specImport: SpecImport;
}> {
  const session = await requireTeamAccess();
  const specImport = await queries.getSpecImport(importId);
  if (!specImport) forbid('Spec import not found');
  if (!specImport.repositoryId) forbid('Spec import has no repository binding');
  await assertRepoTeam(specImport.repositoryId, session.team.id);
  return { session, specImport };
}

// ──────────────────────────────────────────────────────────────────────────
// TestFixture

export async function requireTestFixtureOwnership(fixtureId: string): Promise<{
  session: SessionWithTeam;
  fixture: TestFixture;
}> {
  const session = await requireTeamAccess();
  const fixture = await queries.getTestFixture(fixtureId);
  if (!fixture) forbid('Test fixture not found');
  if (!fixture.repositoryId) forbid('Test fixture has no repository binding');
  await assertRepoTeam(fixture.repositoryId, session.team.id);
  return { session, fixture };
}

// ──────────────────────────────────────────────────────────────────────────
// CSV Data Source (also used for Google Sheets sources)

export async function requireDataSourceOwnership(dsId: string): Promise<{
  session: SessionWithTeam;
  dataSource: CsvDataSource;
}> {
  const session = await requireTeamAccess();
  const dataSource = await queries.getCsvDataSource(dsId);
  if (!dataSource) forbid('Data source not found');
  if (!dataSource.repositoryId) forbid('Data source has no repository binding');
  await assertRepoTeam(dataSource.repositoryId, session.team.id);
  return { session, dataSource };
}
