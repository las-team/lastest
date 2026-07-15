import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { stripe as stripePlugin } from "@better-auth/stripe";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { hash, verify } from "@node-rs/argon2";
import * as queries from "@/lib/db/queries";
import { encryptField, decryptField } from "@/lib/crypto";
import { getGitHubUser } from "@/lib/github/oauth";
import { socialProviderEnabled } from "@/lib/auth/social-providers";
import { sendPasswordResetEmail } from "@/lib/email";
import { syncReposIfStale } from "@/server/actions/repos";
import { syncUserToTwentyCRM } from "@/lib/integrations/twenty-crm";
import { getStripeClient } from "@/lib/billing/stripe";
import {
  getCatalog,
  invalidateCatalog,
  selectPrice,
} from "@/lib/billing/catalog";
import {
  handleSubscriptionComplete,
  handleSubscriptionUpdate,
  handleSubscriptionDeleted,
} from "@/lib/billing/webhook-sync";

async function syncGithubAccount(account: {
  userId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}) {
  if (!account.accessToken) return;
  try {
    const ghUser = await getGitHubUser(account.accessToken);
    if (!ghUser) return;
    const user = await queries.getUserById(account.userId);
    const teamId = user?.teamId ?? null;
    const existing = teamId
      ? await queries.getGithubAccountByTeam(teamId)
      : null;
    const refreshToken = account.refreshToken ?? null;
    const tokenExpiresAt = account.tokenExpiresAt ?? null;
    if (existing) {
      await queries.updateGithubAccount(existing.id, {
        accessToken: account.accessToken,
        refreshToken,
        tokenExpiresAt,
        githubUserId: ghUser.id.toString(),
        githubUsername: ghUser.login,
      });
    } else {
      await queries.createGithubAccount({
        githubUserId: ghUser.id.toString(),
        githubUsername: ghUser.login,
        accessToken: account.accessToken,
        refreshToken,
        tokenExpiresAt,
        teamId,
      });
    }
    // Auto-sync repos on login/reconnect
    if (teamId) {
      syncReposIfStale(teamId).catch(() => {});
    }
  } catch {
    // Don't block sign-in if github_accounts sync fails
  }
}

// B4: cookie attributes need to permit the auth cookie to ride along on the
// EB recorder iframe / WebSocket handshake. SameSite=Lax (the better-auth
// default) drops the cookie on cross-site WS upgrade, which surfaces as a
// 403 on /api/embedded/stream during a Recording Meta run.
//
// We honour env overrides so prod can opt into SameSite=None + Secure +
// shared cookie domain (`.lastest.cloud`) without a code change. The defaults
// stay dev-friendly (lax / non-secure / no domain) so localhost still works.
const COOKIE_SAMESITE =
  (process.env.BETTER_AUTH_COOKIE_SAMESITE as
    | "strict"
    | "lax"
    | "none"
    | undefined) || "lax";
const COOKIE_SECURE = process.env.BETTER_AUTH_COOKIE_SECURE
  ? process.env.BETTER_AUTH_COOKIE_SECURE === "true"
  : process.env.NODE_ENV === "production";
const COOKIE_DOMAIN = process.env.BETTER_AUTH_COOKIE_DOMAIN || undefined;

export const auth = betterAuth({
  baseURL:
    process.env.BETTER_AUTH_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
    : undefined,

  // Filter one benign startup line. @better-auth/stripe logs
  // "Organization plugin not found" at init because we enable its
  // organization-scoped subscriptions (customerType: "organization") without
  // running better-auth's organization plugin — we bridge teams -> org by hand
  // via session.activeOrganizationId (see below). The plugin only looks up the
  // org plugin to wire optional hooks (name sync, seat billing, deletion
  // guard) we never use, so the warning is pure noise; subscriptions still
  // register and work. Everything else logs as before, in better-auth's own
  // non-color format (level filtering is unchanged — default stays "warn").
  logger: {
    log: (level, message, ...args) => {
      if (message.includes("Organization plugin not found")) return;
      const line = `${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}`;
      if (level === "error") console.error(line, ...args);
      else if (level === "warn") console.warn(line, ...args);
      else console.log(line, ...args);
    },
  },

  advanced: {
    defaultCookieAttributes: {
      sameSite: COOKIE_SAMESITE,
      secure: COOKIE_SECURE,
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    },
    ...(COOKIE_DOMAIN
      ? { crossSubDomainCookies: { enabled: true, domain: COOKIE_DOMAIN } }
      : {}),
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.oauthAccounts,
      verification: schema.verification,
      // Stripe plugin tables: subscription is managed by the plugin; the
      // `organization` slot is bridged to our `teams` table so the
      // plugin reads/writes `teams.stripeCustomerId` directly.
      subscription: schema.subscriptions,
      organization: schema.teams,
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
    accountLinking: {
      // Connecting GitHub goes through `linkSocial` (see
      // components/settings/connect-github-button.tsx), which binds the
      // provider account to whoever is already signed in. Demanding that the
      // GitHub email equal the app email would then block the ordinary case of
      // a work login plus a personal GitHub. better-auth still refuses to bind
      // a GitHub identity that is already attached to a different user
      // ("account_already_linked_to_different_user"), which is the check that
      // actually matters here.
      //
      // Deliberately NOT setting `requireLocalEmailVerified: false`: that gate
      // guards the sign-IN path, where an attacker who pre-registers a victim's
      // address (sign-up does not prove control of it — see the user-create
      // hook below) would otherwise be handed the account when the victim later
      // signs in with GitHub. The link path doesn't consult it.
      allowDifferentEmails: true,
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
    sendResetPassword: async ({ user, token }) => {
      await sendPasswordResetEmail(user.email, token);
    },
  },

  // Only register providers whose client id + secret are present. An
  // unconfigured provider used to register with `process.env.X!` = undefined,
  // which made better-auth emit a broken `client_id=undefined` authorize URL
  // (Discord 500'd on click in envs without the secret). The login/register UI
  // gates its buttons off the same check (see social-providers.ts).
  socialProviders: {
    ...(socialProviderEnabled.github()
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            scope: ["read:user", "user:email", "repo", "workflow"],
            mapProfileToUser: (profile) => ({
              email: profile.email ?? `${profile.id}@github.placeholder.local`,
            }),
          },
        }
      : {}),
    ...(socialProviderEnabled.google()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        }
      : {}),
    ...(socialProviderEnabled.discord()
      ? {
          discord: {
            clientId: process.env.DISCORD_CLIENT_ID!,
            clientSecret: process.env.DISCORD_CLIENT_SECRET!,
            // better-auth's Discord provider builds the authorize URL with
            // `prompt=${options.prompt || "none"}`. The default `prompt=none`
            // tells Discord to authorize SILENTLY — never showing the
            // login/consent screen. For any user who hasn't already granted
            // this app (first login, or after a scope change), Discord can't
            // consent silently, so it bounces straight back to our callback
            // with an `?error=` instead of a code. better-auth then can't
            // complete sign-in and lands the user back on /login (the
            // "Discord → loads a sec → back to login" loop). Force the consent
            // screen so the grant actually happens.
            prompt: "consent",
            // Phone-only Discord accounts return email: null even with the `email` scope.
            // Fall back to a synthetic .local placeholder so onboarding doesn't fail.
            mapProfileToUser: (profile: {
              id: string;
              email?: string | null;
            }) => ({
              email: profile.email ?? `${profile.id}@discord.placeholder.local`,
            }),
          },
        }
      : {}),
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh daily
    // The Stripe plugin's `customerType: 'organization'` flow reads
    // `session.activeOrganizationId` to scope subscriptions to a team.
    // We don't run better-auth's organization plugin — instead we mirror
    // `users.teamId` into this field at session create (see databaseHooks
    // below) so the plugin can find the team without us touching its
    // internals.
    additionalFields: {
      activeOrganizationId: { type: "string", required: false },
    },
  },

  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // Stamp the user's current teamId onto the session so the
          // Stripe plugin's organization-scoped subscription lookup
          // works without us running better-auth's organization plugin.
          const u = await queries.getUserById(session.userId);
          if (u?.teamId) {
            return { data: { ...session, activeOrganizationId: u.teamId } };
          }
          return { data: session };
        },
      },
    },
    account: {
      create: {
        before: async (account) => ({
          data: {
            ...account,
            accessToken: encryptField(account.accessToken),
            refreshToken: encryptField(account.refreshToken),
            idToken: encryptField(account.idToken),
          },
        }),
        after: async (account) => {
          if (account.providerId === "github" && account.accessToken) {
            await syncGithubAccount({
              userId: account.userId,
              accessToken: decryptField(account.accessToken),
              refreshToken: account.refreshToken
                ? decryptField(account.refreshToken)
                : null,
              tokenExpiresAt: account.accessTokenExpiresAt ?? null,
            });
          }
        },
      },
      update: {
        before: async (account) => ({
          data: {
            ...account,
            ...(account.accessToken !== undefined && {
              accessToken: encryptField(account.accessToken),
            }),
            ...(account.refreshToken !== undefined && {
              refreshToken: encryptField(account.refreshToken),
            }),
            ...(account.idToken !== undefined && {
              idToken: encryptField(account.idToken),
            }),
          },
        }),
        after: async (account) => {
          if (account.providerId === "github" && account.accessToken) {
            await syncGithubAccount({
              userId: account.userId,
              accessToken: decryptField(account.accessToken),
              refreshToken: account.refreshToken
                ? decryptField(account.refreshToken)
                : null,
              tokenExpiresAt: account.accessTokenExpiresAt ?? null,
            });
          }
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          const { isDemoEmail, ensureDemoEnvironment } = await import("./demo");
          if (isDemoEmail(user.email)) {
            const { team } = await ensureDemoEnvironment();
            await queries.updateUser(user.id, {
              teamId: team.id,
              role: "viewer",
              onboardingCompletedAt: new Date(),
            });
            return;
          }
          // SECURITY: do NOT auto-join a team by matching user.email against a
          // pending invitation. Email/password sign-up does not prove control
          // of the address, so an attacker could register a victim's invited
          // email and inherit the team + role. Every new account starts in its
          // own personal team; joining an invited team happens only via the
          // token-bound acceptInvitation() flow (see server/actions/users.ts),
          // which verifies the invite token AND that it was issued to this email.
          const team = await queries.createTeam({
            name: `${user.name || user.email.split("@")[0]}'s Team`,
          });
          await queries.updateUser(user.id, {
            teamId: team.id,
            role: "owner",
          });
          syncUserToTwentyCRM({
            name: user.name || "",
            email: user.email,
          }).catch(() => {});
        },
      },
    },
  },

  plugins: [
    nextCookies(),
    // Lazily skip the Stripe plugin when STRIPE_SECRET_KEY is unset so
    // self-hosters who don't want billing don't have to set fake env vars.
    ...buildStripePlugin(),
  ],
});

function buildStripePlugin() {
  const stripeClient = getStripeClient();
  if (!stripeClient) return [];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return [];

  // Translate the live Stripe catalog into the plugin's plan shape on
  // every resolution (the plugin re-invokes this per call, so dashboard
  // price changes apply without a restart — getCatalog() is TTL-cached).
  // `selectPrice()` honors the EA-pricing flag with fall-through to the
  // full price.
  const plans = async () => {
    const catalog = await getCatalog();
    return catalog
      .filter((p) => p.live && p.prices.monthly)
      .map((p) => ({
        name: p.id,
        priceId: selectPrice(p, "monthly")!.priceId,
        annualDiscountPriceId: selectPrice(p, "yearly")?.priceId,
        limits: {
          monthlyRunQuota: p.monthlyRunQuota,
          projectLimit: p.projectLimit,
        },
      }));
  };

  return [
    stripePlugin({
      stripeClient,
      stripeWebhookSecret: webhookSecret,
      createCustomerOnSignUp: false, // we create lazily on first checkout
      // Required for customerType: "organization" subscriptions (per-team
      // billing). We don't run better-auth's organization plugin; the
      // resulting "Organization plugin not found" init warning is filtered
      // out in the `logger` config above.
      organization: { enabled: true },
      subscription: {
        enabled: true,
        plans,
        // managed_payments lets Stripe orchestrate auth challenges /
        // dynamic payment method ordering (and customer-facing tax) for
        // us — we deliberately do NOT enable Stripe Tax / automatic_tax.
        getCheckoutSessionParams: () => ({
          params: {
            managed_payments: { enabled: true },
            allow_promotion_codes: true,
          },
        }),
        // Gate every subscription mutation on team-admin role.
        authorizeReference: async ({ user, referenceId }) => {
          const u = await queries.getUserById(user.id);
          if (!u || u.teamId !== referenceId) return false;
          return u.role === "admin" || u.role === "owner";
        },
        // Mirror plugin events into our app: keep teams.plan +
        // monthlyRunQuota in sync the moment payment lands so the
        // capability layer (capabilitiesFor) sees the new tier on the
        // very next request — no admin review, no audit log gate.
        onSubscriptionComplete: handleSubscriptionComplete,
        onSubscriptionUpdate: handleSubscriptionUpdate,
        onSubscriptionDeleted: handleSubscriptionDeleted,
      },
      // Forensic webhook log: the plugin performs the subscription sync
      // itself (above) — this just records every delivery so admins can
      // reconcile against Stripe. Stripe retries are no-op'd by the
      // primary key on event id; it does not gate the plugin's sync.
      onEvent: async (event) => {
        // Dashboard catalog edits (price/product create/update/archive)
        // bust the in-memory catalog cache so the UI + plugin pick up
        // the change on the next read instead of waiting out the TTL.
        if (
          event.type.startsWith("price.") ||
          event.type.startsWith("product.")
        ) {
          invalidateCatalog();
        }
        try {
          await queries.recordStripeWebhookReceipt({
            eventId: event.id,
            type: event.type,
            payload: event as unknown as Record<string, unknown>,
          });
          await queries.markStripeWebhookProcessed(event.id);
        } catch (err) {
          console.error("[better-auth/stripe] webhook log write failed", err);
        }
      },
    }),
  ];
}
