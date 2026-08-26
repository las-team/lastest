/**
 * Relative-time formatting for the board/history/trigger cards.
 *
 * A verbatim copy of `timeAgo` from the app's `src/lib/utils.ts` — a plugin
 * may not import `@/lib/utils`, and eleven lines of date arithmetic guard
 * nothing, so recipe §5's promotion test says "library"; it is duplicated
 * here rather than promoted because a one-function `libs/` package for one
 * consumer is more surface than the duplication. Fold it into a shared
 * formatting lib the day a second plugin copies it.
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
