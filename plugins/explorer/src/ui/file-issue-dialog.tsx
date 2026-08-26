"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@lastest/ui";
import { ExternalLink, Loader2 } from "lucide-react";

import { fileFindingIssue, getFindingIssueContext } from "../actions";
import type { ExplorerFinding } from "../schema";

/**
 * "File issue" for one finding.
 *
 * Deliberately thinner than core's verify issue picker: that dialog also
 * *browses* open issues so a reviewer can attach a case to a ticket that
 * already exists, which needs a search port explorer does not have yet. What
 * both share is the part that matters — the reviewer edits a title and adds a
 * note, and the server composes the evidence-carrying body, because the client
 * cannot see the action log or the console/network capture that make the issue
 * worth filing.
 */
export function FileIssueDialog({
  finding,
  open,
  onClose,
  onFiled,
}: {
  finding: ExplorerFinding;
  open: boolean;
  onClose: () => void;
  onFiled: (issue: { url: string; number?: number }) => void;
}) {
  const [title, setTitle] = useState(`[Explorer] ${finding.title}`);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    connected: boolean;
    repoFullName: string | null;
    error?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  // Asked before the reviewer writes anything: a missing GitHub connection
  // should not be discovered by losing a composed note to a failed submit.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getFindingIssueContext(finding.repositoryId)
      .then((ctx) => {
        if (!cancelled) setTarget(ctx);
      })
      .catch(() => {
        if (!cancelled)
          setTarget({ connected: false, repoFullName: null, error: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [open, finding.repositoryId]);

  const handleFile = () => {
    setError(null);
    startTransition(async () => {
      const res = await fileFindingIssue({
        findingId: finding.id,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (res.ok && res.issueUrl) {
        onFiled({ url: res.issueUrl, number: res.issueNumber });
        onClose();
        return;
      }
      setError(res.error ?? "Could not create the issue");
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>File this finding as an issue</DialogTitle>
          <DialogDescription>
            {target?.connected && target.repoFullName
              ? `Opens a GitHub issue on ${target.repoFullName} with the scenario, the steps the explorer took and the console/network evidence attached.`
              : "Opens a GitHub issue with the scenario, the steps the explorer took and the console/network evidence attached."}
          </DialogDescription>
        </DialogHeader>

        {target && !target.connected && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            {target.error ??
              "Connect GitHub in Settings → Integrations to file issues."}
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="explorer-issue-title">Title</Label>
            <Input
              id="explorer-issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="explorer-issue-note">Note (optional)</Label>
            <Textarea
              id="explorer-issue-note"
              rows={4}
              placeholder="What you want the assignee to know — impact, priority, anything the explorer couldn't see."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Attached automatically: severity, page URL, scenario and rationale,
            the explorer&apos;s action log
            {(finding.evidence?.consoleErrors?.length ?? 0) > 0
              ? `, ${finding.evidence!.consoleErrors!.length} console error${finding.evidence!.consoleErrors!.length === 1 ? "" : "s"}`
              : ""}
            {(finding.evidence?.failedRequests?.length ?? 0) > 0
              ? `, ${finding.evidence!.failedRequests!.length} failed request${finding.evidence!.failedRequests!.length === 1 ? "" : "s"}`
              : ""}
            , and a link back to this run.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleFile}
            disabled={pending || target?.connected === false}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Create issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
