import { db } from "../index";
import { encryptKnowledgeRow, decryptKnowledgeRow } from "@/lib/crypto-fields";
import { agentKnowledge } from "../schema";
import type { AgentKnowledge, NewAgentKnowledge } from "../schema";
import { matchUrlPattern } from "@/lib/explorer/url-match";
import { eq, and, desc } from "drizzle-orm";

/**
 * Explorer-agent knowledge notes: human-provided markdown hints matched to
 * pages by URL pattern (explorbot's `knowledge/` directory, DB-backed).
 * credPassword is AES-256-GCM encrypted at rest here — callers always see
 * plaintext.
 */

export async function listKnowledgeByRepo(
  repositoryId: string,
): Promise<AgentKnowledge[]> {
  const rows = await db
    .select()
    .from(agentKnowledge)
    .where(eq(agentKnowledge.repositoryId, repositoryId))
    .orderBy(desc(agentKnowledge.updatedAt));
  return rows.map((r) => decryptKnowledgeRow(r));
}

export async function getKnowledge(
  id: string,
): Promise<AgentKnowledge | undefined> {
  const [row] = await db
    .select()
    .from(agentKnowledge)
    .where(eq(agentKnowledge.id, id));
  return row ? decryptKnowledgeRow(row) : undefined;
}

export async function createKnowledge(
  data: Omit<NewAgentKnowledge, "id" | "createdAt" | "updatedAt">,
): Promise<AgentKnowledge> {
  const now = new Date();
  const [row] = await db
    .insert(agentKnowledge)
    .values({
      ...encryptKnowledgeRow(data),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return decryptKnowledgeRow(row);
}

export async function updateKnowledge(
  id: string,
  patch: Partial<
    Pick<
      NewAgentKnowledge,
      | "title"
      | "urlPattern"
      | "matchKind"
      | "body"
      | "credEmail"
      | "credPassword"
      | "pageAutomation"
      | "enabled"
    >
  >,
): Promise<AgentKnowledge | undefined> {
  const [row] = await db
    .update(agentKnowledge)
    .set({ ...encryptKnowledgeRow(patch), updatedAt: new Date() })
    .where(eq(agentKnowledge.id, id))
    .returning();
  return row ? decryptKnowledgeRow(row) : undefined;
}

export async function deleteKnowledge(id: string): Promise<void> {
  await db.delete(agentKnowledge).where(eq(agentKnowledge.id, id));
}

/** Enabled notes whose URL pattern matches the given page URL, decrypted.
 *  Pattern matching happens in-process (repo note counts are small). */
export async function matchKnowledgeForUrl(
  repositoryId: string,
  url: string,
): Promise<AgentKnowledge[]> {
  const rows = await db
    .select()
    .from(agentKnowledge)
    .where(
      and(
        eq(agentKnowledge.repositoryId, repositoryId),
        eq(agentKnowledge.enabled, true),
      ),
    );
  return rows
    .filter((r) => matchUrlPattern(r.urlPattern, r.matchKind, url))
    .map((r) => decryptKnowledgeRow(r));
}
