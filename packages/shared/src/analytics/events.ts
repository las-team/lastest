export const Events = {
  signup_completed: "signup_completed",

  repo_linked: "repo_linked",
  area_created: "area_created",
  route_added: "route_added",
  setup_script_saved: "setup_script_saved",
  storage_state_saved: "storage_state_saved",

  test_recorded: "test_recorded",
  test_created: "test_created",

  test_run_started: "test_run_started",
  test_run_completed: "test_run_completed",

  baseline_approved: "baseline_approved",
  baseline_rejected: "baseline_rejected",
  diff_approved: "diff_approved",
  diff_rejected: "diff_rejected",

  schedule_created: "schedule_created",
  pr_linked: "pr_linked",
  runner_connected: "runner_connected",
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

export type RunTrigger = "manual" | "scheduled" | "ci" | "mcp";
