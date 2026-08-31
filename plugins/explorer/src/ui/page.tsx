import type { ComponentType, ReactNode } from "react";
import { Compass } from "lucide-react";

import { orm } from "../data/db";
import * as q from "../data/queries";
import { explorerPlugin } from "../index";
import { explorerWiring } from "../wiring";
import { ExplorerClient } from "./explorer-client";
import type { ExplorerSessionWithFindings } from "./use-explorer-agent";

/**
 * The `/explorer` route, owned by the plugin.
 *
 * Spike S1 proved a route page can live in a workspace package with a one-line
 * `export { default } from "…"` on the app side, so there is no codegen here
 * and no generated `page.tsx` to keep in sync.
 *
 * Two things are passed in rather than reached for, and both are the boundary
 * working as intended:
 *
 * - **`repositoryId`** — the app knows which repo the user has selected;
 *   selection is a core concern (it is per-user state on core tables) and not
 *   something a plugin should be able to read or change.
 * - **`browserViewer`** — see `explorer-client.tsx`.
 */
export interface ExplorerPageProps {
  repositoryId: string | null;
  defaultUrl: string;
  aiConfigured: boolean;
  /** Rendered when a run has a live stream grant. Supplied by the app. */
  browserViewer?: ComponentType<{ streamUrl: string }>;
  /** Shown instead of the tool when the team's plan does not include it. */
  upgradeGate?: ReactNode;
  /** Rendered above the title. Core passes the "Agents › Explorer" trail —
   *  the console is the only sidebar entry for agent work, so this page needs
   *  a visible parent. A plugin cannot import a core component, so it arrives
   *  as a node, the same seam `upgradeGate` and `noRepository` already use. */
  breadcrumb?: ReactNode;
  /** Shown when no repository is selected. */
  noRepository?: ReactNode;
}

export default async function ExplorerPage({
  repositoryId,
  defaultUrl,
  aiConfigured,
  browserViewer,
  upgradeGate,
  noRepository,
  breadcrumb,
}: ExplorerPageProps) {
  if (!repositoryId) return <>{noRepository ?? null}</>;

  const { runtime, host } = explorerWiring();
  const ctx = await runtime.contextFor(explorerPlugin, { repositoryId });
  if (!ctx.team.entitlements.has("qa-agent")) return <>{upgradeGate ?? null}</>;

  const db = { db: orm(ctx.data), host };
  const [session, knowledge, experience] = await Promise.all([
    q.getLatestSession(db, repositoryId).catch(() => undefined),
    q.listKnowledgeByRepo(db, repositoryId).catch(() => []),
    q.listExperienceByRepo(db, repositoryId, 50).catch(() => []),
  ]);

  const findings = session
    ? await q.listFindingsBySession(db, session.id).catch(() => [])
    : [];

  // Credentials never reach the client. The session row holds the target app's
  // password so the login step can replay it; the browser has no use for it.
  const initialSession: ExplorerSessionWithFindings | null = session
    ? {
        ...session,
        metadata: (({ password: _password, ...rest }) => rest)(
          session.metadata,
        ),
        findings,
      }
    : null;

  const initialKnowledge = knowledge.map((n) => ({
    id: n.id,
    title: n.title,
    urlPattern: n.urlPattern,
    matchKind: n.matchKind,
    body: n.body,
    credEmail: n.credEmail,
    hasCredentials: Boolean(n.credPassword),
    enabled: n.enabled,
  }));

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          {breadcrumb}
          <h1 className="text-2xl font-semibold flex items-center gap-2 pt-1">
            <Compass className="h-6 w-6" />
            Explorer
          </h1>
          <p className="text-sm text-muted-foreground">
            An autonomous exploratory tester — it researches each page, plans
            scenarios in rotating styles, drives a live browser, records defects
            and UX findings, learns from every run, and keeps passing flows as
            tests.
          </p>
        </header>
        <ExplorerClient
          repositoryId={repositoryId}
          defaultUrl={defaultUrl}
          aiConfigured={aiConfigured}
          initialSession={initialSession}
          initialKnowledge={initialKnowledge}
          initialExperience={experience}
          BrowserViewer={browserViewer}
        />
      </div>
    </div>
  );
}
