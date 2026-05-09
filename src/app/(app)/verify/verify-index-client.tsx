'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface VerifyIndexClientProps {
  hasRepo: boolean;
  activeBranch: string | null;
  latestBuildId: string | null;
}

export function VerifyIndexClient({ hasRepo, activeBranch, latestBuildId }: VerifyIndexClientProps) {
  const router = useRouter();

  // Navigate to the latest build via the client router instead of a server-side
  // redirect — keeps the parent server component's render lifecycle clean.
  useEffect(() => {
    if (latestBuildId) {
      router.replace(`/verify/${latestBuildId}`);
    }
  }, [latestBuildId, router]);

  if (latestBuildId) {
    // Brief flash before the client navigation kicks in.
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--secondary)' }}>
        <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>Opening latest build…</p>
      </div>
    );
  }

  if (!hasRepo) {
    return (
      <EmptyState
        title="Select a repository"
        description="Pick a repo from the sidebar to start verifying changes."
      />
    );
  }

  return (
    <EmptyState
      title="No builds yet"
      description={`No builds on ${activeBranch ?? 'this branch'}. Run tests from the Builds page to capture a baseline.`}
      actionHref="/builds"
      actionLabel="Open Builds"
    />
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}

function EmptyState({ title, description, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--secondary)' }}>
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 32, maxWidth: 460, textAlign: 'center', boxShadow: '0 1px 2px rgba(31,42,51,0.05)' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--foreground)' }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--muted-foreground)', marginBottom: actionHref ? 16 : 0 }}>{description}</p>
        {actionHref && (
          <Link
            href={actionHref}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 8,
              background: 'var(--primary)',
              color: 'white',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
