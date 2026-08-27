"use client";

/**
 * Baseline branch for a comparison run.
 *
 * The persisted half of what `/run` called the "Comparison Run" toggle. The
 * *decision* to run a comparison is now an explicit item in Verify's Run
 * split-button, so there is nothing left to toggle — only the branch to
 * compare against, which is a repository setting rather than a per-run one.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateComparisonRunSettings } from "@/server/actions/repos";

interface ComparisonBaselineSelectProps {
  repositoryId: string;
  branches: string[];
  current: string | null;
  defaultBranch: string;
}

export function ComparisonBaselineSelect({
  repositoryId,
  branches,
  current,
  defaultBranch,
}: ComparisonBaselineSelectProps) {
  const [value, setValue] = useState(current || defaultBranch);
  const [isPending, startTransition] = useTransition();
  const options = branches.length > 0 ? branches : [defaultBranch];

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <span className="text-muted-foreground text-sm">
          Comparison baseline branch
        </span>
        <p className="text-xs text-muted-foreground/70">
          &ldquo;Run comparison&rdquo; on Verify runs this branch first and
          auto-approves it as the baseline, overwriting existing baselines, then
          runs the current branch against it.
        </p>
      </div>
      <Select
        value={value}
        disabled={isPending}
        onValueChange={(next) => {
          setValue(next);
          startTransition(async () => {
            try {
              await updateComparisonRunSettings(repositoryId, true, next);
              toast.success(`Comparison baseline set to ${next}`);
            } catch {
              toast.error("Failed to update setting");
            }
          });
        }}
      >
        <SelectTrigger className="w-[180px] h-8 text-xs shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((b) => (
            <SelectItem key={b} value={b} className="text-xs">
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
