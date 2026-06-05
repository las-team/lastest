"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteRepo } from "@/server/actions/repos";

interface DeleteRepoDialogProps {
  repoId: string;
  fullName: string;
  provider: string;
}

function providerCopy(provider: string, fullName: string) {
  if (provider === "local") {
    return (
      <>
        Permanently delete{" "}
        <span className="font-mono font-semibold text-foreground">
          {fullName}
        </span>{" "}
        along with every test, run, build, baseline, diff, screenshot, and
        setting attached to it. This action cannot be undone.
      </>
    );
  }
  const label = provider === "gitlab" ? "GitLab" : "GitHub";
  return (
    <>
      Remove all Lastest data for{" "}
      <span className="font-mono font-semibold text-foreground">
        {fullName}
      </span>{" "}
      — tests, runs, builds, baselines, diffs, screenshots, and settings. Your{" "}
      {label} repository is{" "}
      <span className="font-semibold text-foreground">not affected</span> and
      can be re-imported later.
    </>
  );
}

export function DeleteRepoDialog({
  repoId,
  fullName,
  provider,
}: DeleteRepoDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const matches = confirmation.trim() === fullName.trim();

  async function handleConfirm() {
    if (!matches || submitting) return;
    setSubmitting(true);
    try {
      const result = await deleteRepo(repoId, confirmation);
      if ("error" in result) {
        toast.error(result.error);
        setSubmitting(false);
        return;
      }
      toast.success(`Deleted ${result.fullName}`);
      setOpen(false);
      setConfirmation("");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete repository",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          setOpen(next);
          if (!next) setConfirmation("");
        }
      }}
    >
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete repository
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete repository
          </DialogTitle>
          <DialogDescription>
            {providerCopy(provider, fullName)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="confirm-repo">
            Type{" "}
            <span className="font-mono font-semibold text-foreground">
              {fullName}
            </span>{" "}
            to confirm
          </Label>
          <Input
            id="confirm-repo"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={fullName}
            autoComplete="off"
            disabled={submitting}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!matches || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
