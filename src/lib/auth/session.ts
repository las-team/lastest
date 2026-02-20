import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./auth";
import * as queries from "@/lib/db/queries";
import type { User, Team, UserRole, Repository } from "@/lib/db/schema";

export interface SessionData {
  user: User;
  sessionId: string;
  team: Team | null;
}

export const getCurrentSession = cache(
  async (): Promise<SessionData | null> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return null;

    const user = await queries.getUserById(session.user.id);
    if (!user) return null;

    const team = user.teamId ? await queries.getTeam(user.teamId) : null;

    return {
      user,
      sessionId: session.session.id,
      team: team ?? null,
    };
  }
);

export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth();
  if (session.user.role !== "admin" && session.user.role !== "owner") {
    throw new Error("Forbidden: Admin access required");
  }
  return session;
}

export async function requireTeamAccess(): Promise<
  SessionData & { team: Team }
> {
  const session = await requireAuth();
  if (!session.team) {
    throw new Error("Forbidden: No team access");
  }
  return session as SessionData & { team: Team };
}

export async function requireTeamRole(
  roles: UserRole[]
): Promise<SessionData & { team: Team }> {
  const session = await requireTeamAccess();
  if (!roles.includes(session.user.role as UserRole)) {
    throw new Error(
      `Forbidden: Requires one of these roles: ${roles.join(", ")}`
    );
  }
  return session;
}

export async function requireTeamAdmin(): Promise<
  SessionData & { team: Team }
> {
  return requireTeamRole(["owner", "admin"]);
}

export async function requireRepoAccess(
  repoId: string
): Promise<SessionData & { team: Team; repo: Repository }> {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error("Forbidden: Repository does not belong to your team");
  }
  return { ...session, repo };
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getCurrentSession();
  return session !== null;
}
