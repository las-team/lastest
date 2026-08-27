import type { QaStepId } from "./types";

/**
 * The QA agent's nine-phase pipeline, in order.
 *
 * Single source of truth for both halves of the app: the server action seeds a
 * new session's `steps` from this list, and the QA agent screen renders the
 * pipeline strip from it (so the strip has a shape to draw before the repo has
 * ever run the agent).
 */
export const QA_PHASES: Array<{
  id: QaStepId;
  label: string;
  description: string;
}> = [
  {
    id: "qa_setup",
    label: "Preflight",
    description: "Validate target URL, AI provider, and GitHub connection",
  },
  {
    id: "qa_login",
    label: "Login",
    description:
      "Resolve authentication — existing setup, provided credentials, or an agent-registered account",
  },
  {
    id: "qa_discover",
    label: "Discover",
    description: "Scan source routes and crawl the live app for DOM/selectors",
  },
  {
    id: "qa_plan",
    label: "Plan",
    description: "Design a risk-prioritized test plan from real discovery data",
  },
  {
    id: "qa_plan_review",
    label: "Review",
    description: "Human review gate — approve or request plan changes",
  },
  {
    id: "qa_generate",
    label: "Generate",
    description: "Generate tests per plan item with live selector verification",
  },
  {
    id: "qa_execute",
    label: "Execute",
    description: "Run the generated suite against the target app",
  },
  {
    id: "qa_heal",
    label: "Heal",
    description: "Fix failing tests and re-run them",
  },
  {
    id: "qa_summary",
    label: "Summary",
    description: "Coverage matrix and journey traceability",
  },
];
