import Link from "next/link";
import { ChevronRight, Network } from "lucide-react";

/**
 * "Agents › <this agent>" — the way back out of a drill-through.
 *
 * Once `/agents` is the only sidebar entry for agent work, an agent page is
 * reached by opening a roster row, so it needs a visible parent. Shared by the
 * QA agent page and (in the next change in the stack) the Explorer page.
 */
export function AgentBreadcrumb({ current }: { current: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 hover:text-foreground"
      >
        <Network className="h-3.5 w-3.5" />
        Agents
      </Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <span className="text-foreground">{current}</span>
    </nav>
  );
}
