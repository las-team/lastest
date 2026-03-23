import { PlanPageClient } from './plan-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getFunctionalAreasByRepo,
  getTestsByFunctionalArea,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export default async function PlanPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  if (!selectedRepo) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Select a repository first</p>
        </div>
      </div>
    );
  }

  const [tree, allAreas] = await Promise.all([
    getFunctionalAreasTree(selectedRepo.id),
    getFunctionalAreasByRepo(selectedRepo.id),
  ]);

  // Fetch tests per area for display
  const areasWithTests = await Promise.all(
    allAreas
      .filter(a => a.agentPlan)
      .map(async (area) => {
        const tests = await getTestsByFunctionalArea(area.id);
        return {
          id: area.id,
          name: area.name,
          description: area.description,
          agentPlan: area.agentPlan!,
          planGeneratedAt: area.planGeneratedAt,
          planSnapshot: area.planSnapshot,
          tests: tests.map(t => ({ id: t.id, name: t.name, description: t.description })),
        };
      })
  );

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <PlanPageClient
        areas={areasWithTests}
        repoName={selectedRepo.name || 'Project'}
        repositoryId={selectedRepo.id}
      />
    </div>
  );
}
