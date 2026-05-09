import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSelectedRepository, getLastBuildByBranch } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import './verify-design.css';

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const session = await getCurrentSession();
  if (!isVerifyPhaseEnabled(session?.team)) {
    redirect('/run');
  }

  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  if (!selectedRepo) {
    return (
      <EmptyState
        title="Select a repository"
        description="Pick a repo from the sidebar to start verifying changes."
      />
    );
  }

  const activeBranch = selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main';
  const latestBuild = await getLastBuildByBranch(selectedRepo.id, activeBranch);

  if (!latestBuild) {
    return (
      <EmptyState
        title="No builds yet"
        description={`No builds on ${activeBranch}. Run tests from the Builds page to capture a baseline.`}
        action={
          <Link href="/builds" className="v-btn primary" style={{ textDecoration: 'none' }}>
            Open Builds
          </Link>
        }
      />
    );
  }

  redirect(`/verify/${latestBuild.id}`);
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="verify-page" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-soft-2)' }}>
      <div className="v-card" style={{ padding: 32, maxWidth: 460, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--fg-1)' }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-2)', marginBottom: action ? 16 : 0 }}>{description}</p>
        {action}
      </div>
    </div>
  );
}
