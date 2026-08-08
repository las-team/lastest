/**
 * Who is asking: teams, users, sessions, auth tokens, billing.
 *
 * Tenancy and authentication. `teams` and `users` are two of the four hub
 * tables the whole schema hangs off (10 and 14 inbound FKs), so this module is
 * imported by nearly every other one and should stay close to the bottom of the
 * graph.
 *
 * `subscription` is owned by the @better-auth/stripe plugin and is read-only
 * from app code; `stripe_webhook_events` is the app-owned idempotency log.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  doublePrecision,
} from "drizzle-orm/pg-core";

import { repositories } from "./repos";

// ============================================
// Teams & Auth Tables
// ============================================

export type UserRole = "owner" | "admin" | "member" | "viewer";

// Subscription tier the team is on. Demo teams are shared, read-only
// sandboxes; the rest are normal billable tiers. The capability layer in
// `src/lib/auth/capabilities.ts` derives the allowed action set from
// (role, plan, status) — adding a new tier means one branch there, not
// editing every server action.
//
// Quotas, prices, and Stripe price IDs for the billable tiers live in
// `src/lib/billing/plans.ts`; webhook handlers sync subscription state
// back into the team row.
export type TeamPlan = "demo" | "free" | "trial" | "starter" | "growth" | "pro";

export type TeamStatus = "active" | "suspended";

// Mirror of Stripe's subscription.status enum, narrowed to what we react to.
// `null` means the team has never had a paid subscription (free plan).
export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

// Teams - Multi-tenancy support
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").$type<TeamPlan>().notNull().default("free"),
  status: text("status").$type<TeamStatus>().notNull().default("active"),
  selectedRepositoryId: text("selected_repository_id"),
  earlyAdopterMode: boolean("early_adopter_mode").default(false),
  /** QuickStart agent: email template for the demo user it registers.
   *  Tokens: {slug} = kebab-case product name, {stamp} = UTC YYYYMMDDHHMM.
   *  Default lands the verification mail in Viktor's inbox via plus-addressing. */
  quickstartEmailTemplate: text("quickstart_email_template").default(
    "viktor+{slug}{stamp}@lastest.cloud",
  ),
  banAiMode: boolean("ban_ai_mode").default(false),
  /** AI mode switch (MCP-first). false = MCP mode: in-product AI CTAs +
   *  background AI are hidden and users drive Lastest from their own agent over
   *  MCP. true = built-in AI: Lastest runs AI server-side. Default MCP.
   *  This is the dedicated gate; it replaces inferring availability from whether
   *  an AI key/provider happens to be configured. */
  builtInAiEnabled: boolean("built_in_ai_enabled").default(false),
  /** Leaderboard / seasons / Bug Blitz. Opt-in — new teams start with it off
   *  and enable it in Settings → Features. */
  gamificationEnabled: boolean("gamification_enabled").default(false),
  /** Verify phase (v1.14+) — when true, /verify is the primary surface and
   *  appears as the first sidebar entry. /run and /review are demoted. */
  verifyPhaseEnabled: boolean("verify_phase_enabled").default(true),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).default(
    10737418240,
  ), // 10 GB
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).default(0),
  storageLastCalculatedAt: timestamp("storage_last_calculated_at"),
  // Monthly test-run usage. usageMonth is a 'YYYY-MM' UTC stamp; counters reset
  // atomically on first run of a new month (see recordTeamRunCompletion).
  // Minutes are tracked for measurement only; only runsThisMonth is gated by
  // monthlyRunQuota when ENFORCE_RUN_LIMITS=true.
  monthlyRunQuota: integer("monthly_run_quota").default(500),
  runsThisMonth: integer("runs_this_month").default(0),
  runMinutesThisMonth: doublePrecision("run_minutes_this_month").default(0),
  usageMonth: text("usage_month"), // 'YYYY-MM'
  runUsageLastCalculatedAt: timestamp("run_usage_last_calculated_at"),
  // ── Stripe billing ────────────────────────────────────────────────────
  // Per-team Stripe customer. The better-auth Stripe plugin reads/writes
  // this column directly via its `organization` model mapping
  // (src/lib/auth/auth.ts plugin schema override → modelName='teams').
  // Live subscription state lives in the plugin's `subscription` table
  // keyed by `referenceId = teams.id`; `getTeamBilling()` joins both.
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type Team = typeof teams.$inferSelect;

export type NewTeam = typeof teams.$inferInsert;

// "ai" / "agent" are legacy in-product-AI paths kept for back-compat with rows
// written before the MCP-first onboarding; new onboardings pick "manual" or "mcp".
export type OnboardingPath = "manual" | "ai" | "agent" | "mcp";

// Users - Core identity
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  hashedPassword: text("hashed_password"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  teamId: text("team_id").references(() => teams.id), // Single team membership
  role: text("role").notNull().default("member"), // 'owner' | 'admin' | 'member' | 'viewer'
  selectedRepositoryId: text("selected_repository_id").references(
    () => repositories.id,
    { onDelete: "set null" },
  ),
  emailVerified: boolean("email_verified").default(false),
  // Onboarding wizard state (v3 fork-at-start). Null = wizard not yet completed.
  // Existing users are backfilled to NOW() on migration so they don't see the wizard.
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  onboardingPath: text("onboarding_path").$type<OnboardingPath>(), // 'manual' | 'ai' | 'agent'
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;

export type NewUser = typeof users.$inferInsert;

// Sessions - Database sessions for auth
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  // 'browser' = standard interactive session (default)
  // 'api'     = long-lived programmatic API token (MCP, VSCode extension, scripts)
  // 'launch'  = short-lived scoped token minted by the /oauth/authorize handoff
  //             for the launch.lastest.cloud frontend (see DEFAULT_LAUNCH).
  kind: text("kind").notNull().default("browser"),
  // Human label for 'api' tokens (e.g. "Claude Code laptop"). Null for browser sessions.
  label: text("label"),
  // Last time the token was used (for 'api' tokens). Null for browser sessions.
  lastUsedAt: timestamp("last_used_at"),
  // Space-separated OAuth-style scopes for 'launch' tokens
  // (e.g. "launch:vote launch:submit"). Null for browser/api sessions.
  scope: text("scope"),
  // Mirrors users.teamId onto the session so the Stripe plugin's
  // organization-scoped subscription lookup resolves without running
  // better-auth's organization plugin. Declared as a session
  // additionalField in auth.ts and stamped by the session.create hook —
  // the Drizzle adapter requires this matching column or session
  // creation throws ("field does not exist in the session schema").
  activeOrganizationId: text("active_organization_id"),
});

export type Session = typeof sessions.$inferSelect;

export type NewSession = typeof sessions.$inferInsert;

// OAuth accounts - Link providers to users
export const oauthAccounts = pgTable("oauth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  provider: text("provider").notNull(), // 'github' | 'google' | 'credential'
  providerAccountId: text("provider_account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  tokenExpiresAt: timestamp("token_expires_at"),
  password: text("password"), // BetterAuth stores credential passwords here
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type OAuthAccount = typeof oauthAccounts.$inferSelect;

export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

// BetterAuth verification table (email verification, password reset, etc.)
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at"),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// Email verification tokens
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
});

export type EmailVerificationToken =
  typeof emailVerificationTokens.$inferSelect;

export type NewEmailVerificationToken =
  typeof emailVerificationTokens.$inferInsert;

// User invitations - Team-scoped invitations
export const userInvitations = pgTable("user_invitations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").references(() => teams.id), // Team to join on accept
  email: text("email").notNull(),
  invitedById: text("invited_by_id").references(() => users.id),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("member"), // Role to assign on accept
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at"),
});

export type UserInvitation = typeof userInvitations.$inferSelect;

export type NewUserInvitation = typeof userInvitations.$inferInsert;

// User consent records - GDPR audit trail
export const userConsents = pgTable("user_consents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  consentType: text("consent_type").notNull(), // 'terms_of_service' | 'privacy_policy' | 'marketing_emails'
  granted: boolean("granted").notNull(),
  version: text("version").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  grantedAt: timestamp("granted_at").notNull(),
  revokedAt: timestamp("revoked_at"),
});

export type ConsentType =
  | "terms_of_service"
  | "privacy_policy"
  | "marketing_emails";

export type UserConsent = typeof userConsents.$inferSelect;

export type NewUserConsent = typeof userConsents.$inferInsert;

// ============================================
// Billing — Stripe integration
// ============================================
//
// Subscription state is managed by the better-auth Stripe plugin
// (@better-auth/stripe). The plugin auto-creates the `subscription`
// table (defined below for type-safe reads); the team's Stripe
// customer ID sits on `teams.stripeCustomerId` via the plugin's
// organization-model schema override.
//
// What lives here, not in the plugin:
//
//  * `stripe_webhook_events` — durable idempotency for webhook
//    deliveries. Stripe retries on 5xx, so we record every delivery by
//    its event ID and process only on first insert. Survives restarts
//    and gives admins a forensic record. Pure internal — never gates a
//    user-visible flow.
//
// v1 is monthly + yearly subscriptions only. No metered overage, no
// audit log, no admin gates: subscribe → pay → plan flips on the
// `customer.subscription.created` webhook, no human in the loop.

// ─────────────────────────────────────────────────────────────────────
// `subscription` — managed by @better-auth/stripe; we mirror the
// definition here so reads stay type-safe via drizzle. The plugin
// performs all writes via the better-auth adapter; we treat this
// table as read-only from app code.
// ─────────────────────────────────────────────────────────────────────

export const subscriptions = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    /** Plan name from src/lib/billing/plans.ts (e.g. 'starter', 'pro'). */
    plan: text("plan").notNull(),
    /** Our internal teamId — set via plugin's `customerType: 'organization'`. */
    referenceId: text("referenceId").notNull(),
    stripeCustomerId: text("stripeCustomerId"),
    stripeSubscriptionId: text("stripeSubscriptionId"),
    status: text("status").$type<SubscriptionStatus>().default("incomplete"),
    periodStart: timestamp("periodStart"),
    periodEnd: timestamp("periodEnd"),
    trialStart: timestamp("trialStart"),
    trialEnd: timestamp("trialEnd"),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false),
    cancelAt: timestamp("cancelAt"),
    canceledAt: timestamp("canceledAt"),
    endedAt: timestamp("endedAt"),
    // Written by @better-auth/stripe on every subscription create/update
    // (member count for org subs / quantity = 1 otherwise). We don't bill
    // per seat and never read this, but the column must exist or the
    // plugin's adapter writes fail — so it stays as part of the plugin's
    // managed table, not something we added.
    seats: integer("seats"),
    billingInterval: text("billingInterval"),
    stripeScheduleId: text("stripeScheduleId"),
  },
  (table) => [
    index("idx_subscription_reference").on(table.referenceId),
    index("idx_subscription_stripe_sub").on(table.stripeSubscriptionId),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;

export type NewSubscription = typeof subscriptions.$inferInsert;

export type StripeWebhookEventStatus = "received" | "processed" | "failed";

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    // Stripe's `evt_*` event ID — globally unique per delivery, guarantees
    // idempotency across retries (Stripe Standard Webhooks spec).
    eventId: text("event_id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at")
      .$defaultFn(() => new Date())
      .notNull(),
    processedAt: timestamp("processed_at"),
    error: text("error"),
  },
  (table) => [
    index("idx_stripe_webhook_events_type").on(table.type),
    index("idx_stripe_webhook_events_received").on(table.receivedAt),
  ],
);

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;

export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
