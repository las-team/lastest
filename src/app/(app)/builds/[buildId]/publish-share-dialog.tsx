'use client';

import { useState, useTransition } from 'react';
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
import { publishBuildShare, revokePublicShare } from '@/server/actions/public-shares';
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

export function PublishShareDialog({
  buildId,
  initialShares,
}: {
  buildId: string;
  initialShares: ShareRecord[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [shares, setShares] = useState<ShareRecord[]>(initialShares);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const activeShare = shares.find((s) => s.status === 'public');

  async function handlePublish() {
    startTransition(async () => {
      try {
        const result = await publishBuildShare(buildId);
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
          ...prev,
        ]);
        await navigator.clipboard.writeText(result.url).catch(() => {});
        setCopiedSlug(result.slug);
        setTimeout(() => setCopiedSlug(null), 2000);
        toast.success('Public share created and copied to clipboard');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to publish');
      }
    });
  }

  async function handleRevoke(id: string) {
    startTransition(async () => {
      try {
        await revokePublicShare(id);
        setShares((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'revoked' } : s)));
        toast.success('Public share revoked');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to revoke');
      }
    });
  }

  async function handleCopy(url: string, slug: string) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
    toast.success('Link copied');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={activeShare ? 'secondary' : 'outline'} size="sm" className="gap-2">
          <Share2 className="w-4 h-4" />
          {activeShare ? 'Shared publicly' : 'Publish share'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4" />
            Public share link
          </DialogTitle>
          <DialogDescription>
            Anyone with this URL can view the recording, screenshots, and diff for this build —
            without signing in. Only publish builds you&apos;re comfortable sharing publicly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {shares.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              This build hasn&apos;t been shared publicly yet.
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
                    disabled={isPending}
                    className="inline-flex items-center gap-1 text-destructive hover:underline underline-offset-4"
                  >
                    <XCircle className="w-3 h-3" />
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}

          <Button onClick={handlePublish} disabled={isPending || !!activeShare} className="w-full gap-2">
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            {activeShare ? 'Share already active' : 'Publish public share'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
