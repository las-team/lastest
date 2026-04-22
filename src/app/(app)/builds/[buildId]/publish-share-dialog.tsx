'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Share2, Copy, Check, Link as LinkIcon, XCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  publishBuildShare,
  publishLatestTestShare,
  revokePublicShare,
  listBuildShares,
  listTestShares,
} from '@/server/actions/public-shares';
import { buildShareUrl } from '@/lib/share/slug';
import { toast } from 'sonner';

export interface ShareRecord {
  id: string;
  slug: string;
  url: string;
  status: 'public' | 'revoked';
  createdAt: Date | null;
  viewCount: number;
  claimedAt: Date | null;
}

export interface PublishShareDialogProps {
  buildId?: string;
  testId?: string;
  initialShares: ShareRecord[];
  size?: 'sm' | 'default' | 'icon';
  variant?: 'outline' | 'secondary' | 'ghost';
  iconOnly?: boolean;
}

export function PublishShareDialog({
  buildId,
  testId,
  initialShares,
  size = 'sm',
  variant = 'outline',
  iconOnly = false,
}: PublishShareDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shares, setShares] = useState<ShareRecord[]>(initialShares);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const activeShare = shares.find((s) => s.status === 'public');

  // Refresh the list from the server whenever the dialog opens, so revokes /
  // publishes made in other tabs (or in prior sessions) show up correctly.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = buildId
          ? await listBuildShares(buildId)
          : testId
            ? await listTestShares(testId)
            : [];
        if (cancelled) return;
        setShares(
          rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            url: buildShareUrl(r.slug),
            status: r.status,
            createdAt: r.createdAt,
            viewCount: r.viewCount ?? 0,
            claimedAt: r.claimedAt,
          })),
        );
      } catch {
        // Silent — keep whatever local state we have.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, buildId, testId]);

  async function handlePublish() {
    if (busy) return;
    setBusy(true);
    try {
      const result = buildId
        ? await publishBuildShare(buildId)
        : testId
          ? await publishLatestTestShare(testId)
          : null;
      if (!result) {
        toast.error('Nothing to publish');
        return;
      }
      setShares((prev) => [
        {
          id: result.shareId,
          slug: result.slug,
          url: result.url,
          status: 'public',
          createdAt: new Date(),
          viewCount: 0,
          claimedAt: null,
        },
        ...prev.filter((s) => s.id !== result.shareId),
      ]);
      await navigator.clipboard.writeText(result.url).catch(() => {});
      setCopiedSlug(result.slug);
      setTimeout(() => setCopiedSlug(null), 2000);
      toast.success('Public share created and copied to clipboard');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await revokePublicShare(id);
      setShares((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: 'revoked' as const } : s,
        ),
      );
      toast.success('Public share revoked');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(url: string, slug: string) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
    toast.success('Link copied');
  }

  const triggerLabel = activeShare ? 'Shared publicly' : 'Publish share';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {iconOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={variant}
                size="icon"
                aria-label={triggerLabel}
                className={activeShare ? 'text-primary' : undefined}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{triggerLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant={activeShare ? 'secondary' : variant}
            size={size === 'icon' ? 'sm' : size}
            className="gap-2"
          >
            <Share2 className="h-4 w-4" />
            {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4" />
            Public share link
          </DialogTitle>
          <DialogDescription>
            Anyone with this URL can view the recording, screenshots, and diff for this
            {testId ? ' test' : ' build'} — without signing in. Only publish runs you&apos;re
            comfortable sharing publicly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {shares.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Not shared publicly yet.
            </div>
          )}

          {shares.map((s) => (
            <div
              key={s.id}
              className={`rounded-md border p-3 space-y-2 ${
                s.status === 'revoked' ? 'opacity-60 border-dashed' : 'border-border'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={s.url}
                  className="flex-1 bg-muted rounded px-2 py-1.5 text-xs font-mono truncate"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(s.url, s.slug)}
                  disabled={s.status === 'revoked'}
                  className="gap-1.5 shrink-0"
                >
                  {copiedSlug === s.slug ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  Copy
                </Button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {s.status === 'revoked' ? (
                    <span className="text-destructive font-medium">Revoked</span>
                  ) : (
                    <>
                      {s.viewCount} {s.viewCount === 1 ? 'view' : 'views'}
                      {s.claimedAt && <span className="ml-2 text-primary">· Claimed</span>}
                    </>
                  )}
                </span>
                {s.status === 'public' && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(s.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-destructive hover:underline underline-offset-4 disabled:opacity-50"
                  >
                    <XCircle className="w-3 h-3" />
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}

          <Button
            onClick={handlePublish}
            disabled={busy || !!activeShare}
            className="w-full gap-2"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            {activeShare ? 'Active share exists — revoke first' : 'Publish public share'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
