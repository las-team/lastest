import { cache } from "react";
import { headers } from "next/headers";
import * as queries from "@/lib/db/queries";
import type { User, Team, UserRole, Repository } from "@/lib/db/schema";

export interface SessionData {
  user: User;
  sessionId: string;
  team: Team | null;
}

function getAuthZoneUrl(): string {
  return (process.env.AUTH_ZONE || "http://localhost:3001").replace(/\/$/, "");
}

/**
 * Resolves the current session by calling the auth sub-zone's REST API.
 * The main app no longer hosts the BetterAuth server instance.
 */
export const getCurrentSession = cache(
  async (): Promise<SessionData | null> => {
    const h = await headers();

    // Try cookie-based session from auth sub-zone
    const cookieHeader = h.get("cookie");
    if (cookieHeader) {
      try {
        const res = await fetch(`${getAuthZoneUrl()}/api/auth/session`, {
          headers: { cookie: cookieHeader },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            const user = await queries.getUserById(data.session.user.id);
            if (!user) return null;
            const team = user.teamId ? await queries.getTeam(user.teamId) : null;
            return {
              user,
              sessionId: data.session.sessionId,
              team: team ?? null,
            };
          }
        }
      } catch {
        // If auth zone is unreachable, fall through to bearer token
      }
    }

    // Fallback: Bearer-token auth for programmatic API clients (VS Code ext,
    // MCP server, CI/CD). Lets server actions reached via v1 API routes
    // transparently resolve a session when there are no cookies.
    const authHeader = h.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { verifyBearerToken } = await import("./api-key");
      return verifyBearerToken(authHeader.slice(7));
    }

    return null;
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
