'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { claimPublicShare } from '@/server/actions/public-shares';

export function ClaimRunner({ slug }: { slug: string }) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const result = await claimPublicShare(slug);
        const dest = result.newTestId ? `/tests/${result.newTestId}` : '/tests';
        window.location.href = dest;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to claim this test');
      }
    })();
  }, [slug]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="text-center space-y-4 max-w-sm">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-sm text-muted-foreground">
              Refresh to try again, or contact support if the issue persists.
            </p>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Claiming your test…</p>
          </>
        )}
      </div>
    </div>
  );
}
