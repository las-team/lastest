/**
 * Tool-surface policy: how much of the MCP surface a given caller may see.
 *
 * Why this exists
 * ---------------
 * The 29 tools here were designed for a caller who *is* the user: the stdio CLI
 * running on their laptop under their own API key. `/api/mcp` now also accepts
 * OAuth 2.1 tokens issued to third-party agent platforms (Salesforce
 * Agentforce, ChatGPT, Claude web, …) that registered themselves dynamically.
 * That caller is not the user; it is software the user pointed at their data
 * once, and it should not be handed `action:"delete"`.
 *
 * So a caller resolves to one of three levels:
 *
 *   read   — observe only. No build is started, nothing is written.
 *   write  — read, plus everything that creates or updates Lastest's own
 *            objects and runs tests. Approving a diff lives here: it rewrites a
 *            baseline, which is a normal reviewer action and is reversible.
 *   full   — everything, including deletes and anything that makes data
 *            public. Only an API key (the user's own credential) gets this.
 *
 * The levels are cumulative (`read` ⊂ `write` ⊂ `full`), and the mapping from an
 * OAuth scope to a level lives app-side in `src/lib/mcp/tool-policy.ts`.
 *
 * How it is enforced
 * ------------------
 * Not by rejecting calls after the fact. `createServer()` routes every
 * registration through `defineTool`, which:
 *
 *   1. skips the tool entirely when the caller's level is below its floor, and
 *   2. rewrites the tool's `action` enum down to the permitted values.
 *
 * So an under-privileged caller never *sees* `delete` in the schema. That
 * matters more than a runtime check: an agent picks tools by reading schemas,
 * and one that can see a forbidden action will keep trying it. The runtime
 * check in `filterActions()` stays as a backstop for a caller that guesses.
 *
 * This is deliberately a coarse, hand-maintained table rather than something
 * derived from the tool definitions. Whether an action is "destructive" is a
 * product judgement, not a property of its zod schema — and a table you have to
 * edit is a table someone reviews. `policy.test.ts` fails when a tool or an
 * action listed here stops existing, which is what keeps it honest.
 */

export type ToolAccessLevel = "read" | "write" | "full";

const LEVEL_RANK: Record<ToolAccessLevel, number> = {
  read: 0,
  write: 1,
  full: 2,
};

export function levelAllows(
  caller: ToolAccessLevel,
  required: ToolAccessLevel,
): boolean {
  return LEVEL_RANK[caller] >= LEVEL_RANK[required];
}

export interface ToolRule {
  /** Minimum level needed to see this tool at all. */
  level: ToolAccessLevel;
  /**
   * Per-action minimum levels, keyed by the value of the tool's discriminating
   * parameter. Every value the tool accepts must appear here; an action missing
   * from the map is treated as `full` (fail closed) and `policy.test.ts` flags
   * it.
   */
  actions?: Record<string, ToolAccessLevel>;
  /** The discriminating parameter's name. Almost always `action`. */
  actionParam?: string;
}

/**
 * The table. `level` is the floor for the tool; `actions` refines it per value.
 *
 * Judgement calls worth knowing about:
 *  - **Deletes are `full` everywhere.** No OAuth scope reaches them.
 *  - **`lastest_publish_share` is `full`.** It mints a `/r/<slug>` URL that
 *    anyone can open. An agent platform making a customer's screenshots
 *    world-readable is a different category of mistake from it approving a
 *    baseline, so it needs the user's own credential.
 *  - **`lastest_quickstart` is `full`** for the same reason — it ends in a
 *    published demo.
 *  - **`lastest_decide_diff` is `write`.** Approving is the single most useful
 *    thing an agent does here and it is reversible from the UI.
 *  - **The browser-driving tools (`scout_url`, `ranger`, `explorer`) are
 *    `write`.** They cost a browser and reach out to a URL the caller chose;
 *    that is not a read.
 */
export const TOOL_RULES: Record<string, ToolRule> = {
  lastest_status: {
    level: "read",
    actions: { health: "read", jobs: "read", job: "read" },
  },
  lastest_repo: {
    level: "read",
    actions: {
      list: "read",
      get: "read",
      get_settings: "read",
      create: "write",
      update: "write",
      update_settings: "write",
    },
  },
  lastest_area: {
    level: "read",
    actions: {
      list: "read",
      list_tests: "read",
      create: "write",
      update: "write",
      delete: "full",
    },
  },
  lastest_test: {
    level: "read",
    actions: { list: "read", get: "read", update: "write", delete: "full" },
  },
  lastest_storage_state: {
    level: "write",
    actions: { list: "read", create: "write", delete: "full" },
  },
  lastest_setup_script: {
    level: "read",
    actions: {
      list: "read",
      get: "read",
      create: "write",
      update: "write",
      delete: "full",
    },
  },
  lastest_get_diffs: { level: "read" },
  lastest_decide_diff: {
    level: "write",
    actions: { approve: "write", reject: "write" },
  },
  lastest_build: {
    level: "read",
    // "review" reads a build and summarizes it; it mutates nothing.
    actions: { list: "read", get: "read", review: "read" },
  },
  lastest_share: {
    level: "read",
    actions: { list: "read", revoke: "full" },
  },
  lastest_verify: {
    level: "read",
    actions: { view: "read", change_map: "read" },
  },
  lastest_insights: {
    level: "read",
    actions: { coverage: "read", data_coverage: "read", qa: "read" },
  },
  lastest_qa_agent: {
    level: "read",
    actions: {
      status: "read",
      run_status: "read",
      list_tasks: "read",
      start_run: "write",
      add_task: "write",
    },
  },
  lastest_run_tests: { level: "write" },
  lastest_validate_diff: { level: "write" },
  lastest_scout_url: { level: "write" },
  lastest_ranger: { level: "write" },
  lastest_ranger_status: { level: "read" },
  lastest_explorer: { level: "write" },
  lastest_explorer_status: { level: "read" },
  lastest_explorer_findings: { level: "read" },
  lastest_explorer_learn: { level: "write" },
  lastest_create_test: { level: "write" },
  lastest_heal_test: { level: "write" },
  // Advisory only — returns a suggested application-code change, never applies
  // one, and Lastest does not write to the customer's repo.
  lastest_suggest_app_fix: { level: "read" },
  lastest_publish_share: { level: "full" },
  lastest_approve_layer: { level: "write" },
  lastest_quickstart: { level: "full" },
  lastest_quickstart_status: { level: "read" },
};

export interface ToolDecision {
  /** False when the tool must not be registered for this caller at all. */
  registered: boolean;
  /** Name of the discriminating parameter, when the tool has one. */
  actionParam?: string;
  /**
   * The subset of action values this caller may use. Undefined when the tool
   * has no action parameter, or when nothing was filtered out.
   */
  allowedActions?: string[];
}

/** What a caller at `level` may do with `toolName`. */
export function decideTool(
  toolName: string,
  level: ToolAccessLevel,
): ToolDecision {
  const rule = TOOL_RULES[toolName];
  // Fail closed: a tool added without a rule is only visible to `full`, which
  // is the API-key path. That keeps a forgotten entry from silently widening
  // the OAuth surface.
  if (!rule) return { registered: level === "full" };
  if (!levelAllows(level, rule.level)) return { registered: false };
  if (!rule.actions) return { registered: true };

  const allowed = Object.entries(rule.actions)
    .filter(([, required]) => levelAllows(level, required))
    .map(([action]) => action);
  if (allowed.length === 0) return { registered: false };

  const total = Object.keys(rule.actions).length;
  return {
    registered: true,
    actionParam: rule.actionParam ?? "action",
    allowedActions: allowed.length === total ? undefined : allowed,
  };
}

/**
 * Human-readable reason handed back when a caller invokes an action that was
 * filtered out of its schema. Names the level it would need, so the agent can
 * tell its user what to do instead of retrying.
 */
export function deniedActionMessage(
  toolName: string,
  action: string,
  level: ToolAccessLevel,
): string {
  const required = TOOL_RULES[toolName]?.actions?.[action];
  const needs =
    required === "full"
      ? "an API key created in Settings → Runners & API Access (this action is never available to an OAuth-connected app)"
      : `the '${required === "write" ? "lastest:write" : "lastest:read"}' scope`;
  return `'${action}' is not permitted for this connection (access level: ${level}). It requires ${needs}.`;
}
