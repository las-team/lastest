"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Github, HardDrive, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLocalRepo } from "@/server/actions/repos";

interface AddRepoEmptyStateProps {
  hasRepos: boolean;
}

export function AddRepoEmptyState({ hasRepos }: AddRepoEmptyStateProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await createLocalRepo(trimmed);
        setName("");
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not create repository",
        );
      }
    });
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {hasRepos ? "No repository selected" : "Add a repository"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {hasRepos
                ? "Pick one from the sidebar, or create a new local repo below."
                : "Start by creating a local repo or connecting a Git provider."}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            New local repository
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. my-app"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <Button onClick={handleCreate} disabled={!name.trim() || isPending}>
              <Plus className="h-4 w-4" />
              {isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Link
          href="/settings#github"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <Github className="h-4 w-4" />
          Connect GitHub or GitLab
        </Link>
      </div>
    </div>
  );
}
