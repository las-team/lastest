import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { hash, verify } from "@node-rs/argon2";
import * as queries from "@/lib/db/queries";
import { getGitHubUser } from "@/lib/github/oauth";

async function syncGithubAccount(account: { userId: string; accessToken?: string | null }) {
  if (!account.accessToken) return;
  try {
    const ghUser = await getGitHubUser(account.accessToken);
    if (!ghUser) return;
    const user = await queries.getUserById(account.userId);
    const teamId = user?.teamId ?? null;
    const existing = teamId ? await queries.getGithubAccountByTeam(teamId) : null;
    if (existing) {
      await queries.updateGithubAccount(existing.id, {
        accessToken: account.accessToken,
        githubUserId: ghUser.id.toString(),
        githubUsername: ghUser.login,
      });
    } else {
      await queries.createGithubAccount({
        githubUserId: ghUser.id.toString(),
        githubUsername: ghUser.login,
        accessToken: account.accessToken,
        teamId,
      });
    }
  } catch {
    // Don't block sign-in if github_accounts sync fails
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
    : undefined,

  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.oauthAccounts,
      verification: schema.verification,
    },
  }),

  user: {
    fields: { image: "avatarUrl" },
    additionalFields: {
      teamId: { type: "string", required: false },
      role: { type: "string", required: false, defaultValue: "member" },
      hashedPassword: { type: "string", required: false },
    },
  },

  account: {
    fields: {
      providerId: "provider",
      accountId: "providerAccountId",
    },
    additionalFields: {
      tokenExpiresAt: { type: "number", required: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    password: {
      hash: (password) =>
        hash(password, {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
          outputLen: 32,
        }),
      verify: ({ hash: h, password }) => verify(h, password),
    },
  },

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scope: ["read:user", "user:email", "repo", "workflow"],
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh daily
  },

  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          if (account.providerId === "github" && account.accessToken) {
            await syncGithubAccount(account);
          }
        },
      },
      update: {
        after: async (account) => {
          if (account.providerId === "github" && account.accessToken) {
            await syncGithubAccount(account);
          }
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          const invite = await queries.getInvitationByEmail(user.email);
          if (invite && !invite.acceptedAt && invite.expiresAt && invite.expiresAt > new Date()) {
            await queries.updateUser(user.id, {
              teamId: invite.teamId ?? undefined,
              role: (invite.role as schema.UserRole) ?? "member",
            });
            await queries.markInvitationAccepted(invite.token);
          } else {
            const team = await queries.createTeam({
              name: `${user.name || user.email.split("@")[0]}'s Team`,
            });
            await queries.updateUser(user.id, { teamId: team.id, role: "owner" });
          }
        },
      },
    },
  },

  plugins: [nextCookies()],
});
