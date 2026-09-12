/**
 * Relative-time formatting for cards, tables and history rails.
 *
 * Originally `timeAgo` in the app's `src/lib/utils.ts`, then copied verbatim
 * into `plugins/qa-agent/src/ui/format.ts` because a plugin may not import
 * `@/lib/utils`. That copy's own comment set the condition for promoting it:
 * *"Fold it into a shared formatting lib the day a second plugin copies it."*
 * `plugins/veeva-migration` is that second plugin, so here it is.
 *
 * It lands in `@lastest/ui` rather than a new one-function package for the
 * reason that comment also gave — a package per helper is more surface than the
 * duplication it removes — and every consumer already depends on this one. The
 * app keeps its own `timeAgo` in `src/lib/utils.ts`: core is free to import a
 * library, but rewiring every existing caller is not this migration's business.
 */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "Unknown";
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
