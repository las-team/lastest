import type { TriageHistoryMark } from "@/components/triage/types";

const FILL: Record<TriageHistoryMark, string> = {
  passed: "var(--tri-ok-fill)",
  failed: "var(--tri-bad-fill)",
  other: "var(--muted-foreground)",
};

/**
 * Prior outcomes of the same test, oldest first. Renders nothing when this
 * test has no earlier runs — an empty row of grey squares would imply a
 * history that does not exist.
 */
export function TriageSparkline({ history }: { history: TriageHistoryMark[] }) {
  if (history.length === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Last ${history.length} runs: ${history.join(", ")}`}
    >
      <span className="text-muted-foreground">runs</span>
      <span className="inline-flex gap-[3px]" aria-hidden>
        {history.map((h, i) => (
          <span
            key={i}
            className="inline-block h-[7px] w-[7px] rounded-[2px]"
            style={{ background: FILL[h] }}
          />
        ))}
      </span>
      <span className="sr-only">
        Previous {history.length} runs: {history.join(", ")}
      </span>
    </span>
  );
}
