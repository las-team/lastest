/**
 * QuickStart's own domain types.
 *
 * These describe data that physically lives in two **core** tables —
 * `agent_sessions.metadata` (kind `"quickstart"`) and `build_demo_notes.payload`
 * — because QuickStart owns no schema of its own (see `index.ts`'s header for
 * why). Recipe §6.1's "narrow, or promote?" table calls this the *promote*
 * case: the shape is QuickStart's own payload, not core's, so it is declared
 * here rather than imported from `@/lib/db/schema`. `src/lib/core/
 * quickstart-host.ts` reads/writes the real jsonb columns and is the
 * assertion that the shape still matches — the same route
 * `rca`/`app-map`'s narrowed core-adjacent types took.
 */

export type QuickstartStepId =
  | "qs_preflight"
  | "qs_scout_public"
  | "qs_auth_setup"
  | "qs_scout_authed"
  | "qs_generate"
  | "qs_run_and_notes"
  | "qs_approve_baselines"
  | "qs_rerun_after_approval"
  | "qs_publish_share";

export type QuickstartStepStatus =
  | "pending"
  | "active"
  | "waiting_user"
  | "completed"
  | "failed"
  | "skipped";

export interface QuickstartStepState {
  id: QuickstartStepId;
  status: QuickstartStepStatus;
  label: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export type QuickstartSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface QuickstartAuthClassification {
  classification:
    | "email_password"
    | "login_email_password"
    | "magic_link_only"
    | "oauth_only"
    | "captcha_gated"
    | "otp"
    | "no_public_register"
    | "unknown";
  authAutomatable: boolean;
}

export interface QuickstartBusinessInteraction {
  primaryInputLabel?: string;
  primaryCtaLabel?: string;
  demoInputValue?: string;
}

export type QuickstartProductArchetype =
  | "canvas"
  | "search"
  | "form"
  | "upload"
  | "dashboard"
  | "ecommerce"
  | "other";

export interface QuickstartPublicScout extends QuickstartAuthClassification {
  tagline?: string;
  concept?: string;
  navLinks: Array<{ path: string; label: string }>;
  registerPath?: string | null;
  loginPath?: string | null;
  apiLoginEndpoint?: string | null;
  authLibrary?: string;
  tokenLocation?:
    | "cookie"
    | "localstorage"
    | "indexeddb"
    | "sessionstorage"
    | "unknown";
  cookieBannerSelectorHint?: string;
  friction?: Array<{ kind: string; note: string }>;
  businessInteraction?: QuickstartBusinessInteraction;
  productArchetype?: QuickstartProductArchetype;
}

export interface QuickstartAuthedScout {
  inAppNavLinks: Array<{ path: string; label: string }>;
  safeCtaCandidates: Array<{ label: string; selectorHint?: string }>;
  observedRoutes: string[];
  friction?: Array<{ kind: string; note: string }>;
}

export interface QuickstartAuthSetupMeta {
  testId?: string;
  storageStateId?: string;
  captured: boolean;
  failureReason?: string;
  mode?: "login" | "signup";
}

export interface QuickstartSessionMetadata {
  quickstartEmail?: string;
  /** Encrypted at rest by core's agent-session query layer; callers always see
   *  plaintext. */
  quickstartPassword?: string;
  quickstartSlug?: string;
  quickstartStamp?: string;
  credsProvided?: boolean;
  authMode?: "login" | "signup" | "public_only";
  publicScout?: QuickstartPublicScout;
  authedScout?: QuickstartAuthedScout;
  authSetup?: QuickstartAuthSetupMeta;
  streamUrl?: string;
  queuedForBrowser?: boolean;
  walkthroughTestId?: string;
  buildId?: string;
  rerunBuildId?: string;
  demoNotesId?: string;
  shareId?: string;
  shareSlug?: string;
  shareUrl?: string;
  disabledReason?: string;
}

export interface QuickstartSessionRow {
  readonly id: string;
  readonly repositoryId: string;
  readonly teamId: string | null;
  readonly status: QuickstartSessionStatus;
  readonly currentStepId: QuickstartStepId | null;
  readonly steps: QuickstartStepState[];
  readonly metadata: QuickstartSessionMetadata;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly completedAt: string | null;
}

export interface QuickstartDemoNoteItem {
  label: string;
  note: string;
}

export interface QuickstartDemoNoteSkippedRoute {
  path: string;
  reason: string;
}

export interface QuickstartDemoNotes {
  uxSummary: string;
  highlights: QuickstartDemoNoteItem[];
  frictionPoints: QuickstartDemoNoteItem[];
  testingStruggles: QuickstartDemoNoteItem[];
  skippedRoutes?: QuickstartDemoNoteSkippedRoute[];
  outreachHook?: string;
  fallbackSummary?: boolean;
  generatedAt: string;
  modelId?: string;
}
