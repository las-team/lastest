/**
 * Capability-based authorization.
 *
 * Server actions don't ask "what role is this user?" — they ask
 * "is this session allowed to do `tests:write`?". The mapping from
 * (role, plan, team status) → capability set lives in one place
 * (`capabilitiesFor`). New plans, suspended-account behaviour, or a
 * new "trial limited" tier are added by editing this single function;
 * action files don't change.
 *
 * Capabilities are intentionally coarse — one per write surface, not
 * per server action. Resource-ownership (this repo belongs to your
 * team) is still enforced by `requireRepoAccess` / the ownership
 * helpers; capabilities answer "is this kind of write allowed at all"
 * before ownership is checked.
 */
import * as queries from '@/lib/db/queries';
import { requireTeamAccess } from './session';
import type { SessionData } from './session';
import type { Team, Repository } from '@/lib/db/schema';

export type Capability =
  // Test definitions: create / edit / delete / clone.
  | 'tests:write'
  // Anything that drives a recording session (start/stop/screenshot/assertion).
  | 'recording:write'
  // Functional area CRUD.
  | 'areas:write'
  // Connect / sync / create repositories.
  | 'repos:manage'
  // Per-repo settings (baselines, branch selection, comparison config).
  | 'repos:settings'
  // Manage team members, invitations, billing.
  | 'team:admin';

type SessionForCaps = Pick<SessionData, 'user' | 'team'>;

/**
 * Static (role, plan, status) → capability set. Pure function, no I/O,
 * safe to call from anywhere including UI components that already have
 * the session in props.
 */
export function capabilitiesFor(session: SessionForCaps): ReadonlySet<Capability> {
  const caps = new Set<Capability>();
  const team = session.team;
  if (!team) return caps;

  // Suspended teams are fully read-only until reactivated.
  if (team.status === 'suspended') return caps;

  // Demo plan: shared sandbox, read-only regardless of role.
  if (team.plan === 'demo') return caps;

  // Viewer role: read-only on any plan (defense-in-depth so demo users
  // who somehow end up off the demo plan still can't write).
  if (session.user.role === 'viewer') return caps;

  // Member-and-up writes on any non-demo, non-suspended plan.
  caps.add('tests:write');
  caps.add('recording:write');
  caps.add('areas:write');
  caps.add('repos:settings');
  // Repo provisioning (sync/connect/create-local) is currently open to
  // any non-viewer member — preserved so we don't break existing flows.
  // Tighten to admin/owner only by moving this into the role branch below.
  caps.add('repos:manage');

  if (session.user.role === 'admin' || session.user.role === 'owner') {
    caps.add('team:admin');
  }

  return caps;
}

export function hasCapability(
  session: SessionForCaps,
  capability: Capability,
): boolean {
  return capabilitiesFor(session).has(capability);
}

/**
 * UI-side predicate: "should this session see write affordances at all?".
 * Equivalent to `tests:write` since every interactive write path needs it.
 */
export function isReadOnlySession(session: SessionForCaps): boolean {
  return !hasCapability(session, 'tests:write');
}

function deny(capability: Capability): never {
  throw new Error(`Forbidden: missing capability ${capability}`);
}

/**
 * Standard chokepoint for write actions. Equivalent to `requireTeamAccess`
 * + a capability check.
 */
export async function requireCapability(
  capability: Capability,
): Promise<SessionData & { team: Team }> {
  const session = await requireTeamAccess();
  if (!hasCapability(session, capability)) deny(capability);
  return session;
}

/**
 * Variant for repo-scoped writes — combines tenant ownership of `repoId`
 * with the capability check in one call.
 */
export async function requireRepoCapability(
  repoId: string,
  capability: Capability,
): Promise<SessionData & { team: Team; repo: Repository }> {
  const session = await requireTeamAccess();
  if (!hasCapability(session, capability)) deny(capability);
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Repository does not belong to your team');
  }
  return { ...session, repo };
}

/**
 * Higher-order wrapper for server actions. Lets a 'use server' module
 * declare its action's required capability at the top instead of as the
 * first line of the body — useful when adopting capabilities incrementally
 * or wiring up new actions.
 *
 * Usage:
 *   export const createTest = mutation('tests:write', async (data) => {
 *     // session is already validated; do the work.
 *   });
 *
 * The wrapped function passes the session as an extra trailing argument
 * isn't done here — the wrapper intentionally stays opaque so call-sites
 * don't change shape. Re-fetch the session inside if you need it.
 */
export function mutation<TArgs extends unknown[], TR>(
  capability: Capability,
  fn: (...args: TArgs) => Promise<TR>,
): (...args: TArgs) => Promise<TR> {
  return async (...args: TArgs) => {
    await requireCapability(capability);
    return fn(...args);
  };
}
