import type { AgentKnowledge, AgentExperience } from "@/lib/db/schema";

/**
 * Prompt-injection helpers for the two explorer memory systems: knowledge
 * (human hints) and experience (agent-learned notes). Both render to capped
 * markdown blocks the planner/tester prompts embed verbatim.
 *
 * SECURITY: credentials are NEVER rendered here. Matched credentials flow
 * through the deterministic login path (attemptLogin) only — they must not
 * appear in prompts or aiPromptLogs.
 */

const MAX_KNOWLEDGE_CHARS = 4000;
const MAX_EXPERIENCE_CHARS = 3000;

export function renderKnowledgeBlock(notes: AgentKnowledge[]): string {
  if (notes.length === 0) return "";
  let block = "";
  for (const note of notes) {
    const entry = `### ${note.title} (matches ${note.urlPattern})\n${note.body.trim()}\n\n`;
    if (block.length + entry.length > MAX_KNOWLEDGE_CHARS) break;
    block += entry;
  }
  return block
    ? `OPERATOR KNOWLEDGE for this page (authoritative hints — follow them):\n${block.trim()}`
    : "";
}

export function renderExperienceBlock(rows: AgentExperience[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const row of rows) {
    for (const note of row.notes.slice(-8)) {
      const line = `- [${note.kind}] ${note.text.replace(/\s+/g, " ").slice(0, 240)}`;
      if (total + line.length > MAX_EXPERIENCE_CHARS) break;
      lines.push(line);
      total += line.length;
    }
  }
  return lines.length > 0
    ? `LEARNED EXPERIENCE from previous runs on this page state (reuse what worked, avoid what failed):\n${lines.join("\n")}`
    : "";
}

/** First matched note carrying credentials — the deterministic login input. */
export function pickKnowledgeCredentials(
  notes: AgentKnowledge[],
): { email: string; password: string } | null {
  for (const note of notes) {
    if (note.credPassword) {
      return { email: note.credEmail ?? "", password: note.credPassword };
    }
  }
  return null;
}

/** Concatenated page-automation steps from matched notes (execution order =
 *  note recency order as returned by the matcher). */
export function collectPageAutomation(
  notes: AgentKnowledge[],
): NonNullable<AgentKnowledge["pageAutomation"]> {
  return notes.flatMap((n) => n.pageAutomation ?? []).slice(0, 12);
}
