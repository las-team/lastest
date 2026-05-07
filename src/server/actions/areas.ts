'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess, requireWriteAccess, requireRepoWriteAccess } from '@/lib/auth';
import { requireAreaOwnership, requireTestOwnership } from '@/lib/auth/ownership';
import type { NewFunctionalArea, FunctionalAreaPlanSnapshot } from '@/lib/db/schema';

export async function createArea(data: {
  name: string;
  agentPlan?: string;
  repositoryId?: string;
  parentId?: string;
}) {
  if (data.repositoryId) await requireRepoWriteAccess(data.repositoryId);
  else await requireWriteAccess();

  // Deduplicate: find existing area with same name (case-insensitive) in same repo+parent
  const allAreas = data.repositoryId
    ? await queries.getFunctionalAreasByRepo(data.repositoryId)
    : await queries.getFunctionalAreas();
  const trimmedName = data.name.trim();
  const existing = allAreas.find(
    a => a.name.toLowerCase() === trimmedName.toLowerCase()
      && a.parentId === (data.parentId ?? null)
  );

  if (existing) {
    // Merge plan if provided and existing has none
    if (data.agentPlan && !existing.agentPlan) {
      await queries.updateFunctionalArea(existing.id, { agentPlan: data.agentPlan, planGeneratedAt: new Date() });
    }
    revalidatePath('/areas');
    revalidatePath('/tests');
    return existing;
  }

  const result = await queries.createFunctionalArea({
    name: trimmedName,
    agentPlan: data.agentPlan,
    planGeneratedAt: data.agentPlan ? new Date() : null,
    repositoryId: data.repositoryId,
    parentId: data.parentId,
  });
  revalidatePath('/areas');
  revalidatePath('/tests');
  return result;
}

export async function updateArea(id: string, data: Partial<Pick<NewFunctionalArea, 'name' | 'agentPlan' | 'parentId'>>) {
  await requireAreaOwnership(id);
  await queries.updateFunctionalArea(id, data);
  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function deleteArea(id: string) {
  await requireAreaOwnership(id);
  // Get all tests in this area and move them to uncategorized
  const tests = await queries.getTestsByFunctionalArea(id);
  for (const test of tests) {
    await queries.moveTestToArea(test.id, null);
  }

  // Get child areas and move them to root
  const allAreas = await queries.getFunctionalAreas();
  const childAreas = allAreas.filter(a => a.parentId === id);
  for (const child of childAreas) {
    await queries.updateFunctionalAreaParent(child.id, null);
  }

  await queries.deleteFunctionalArea(id);
  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function deleteAreaWithContents(id: string) {
  await requireAreaOwnership(id);
  const allAreas = await queries.getFunctionalAreas();

  // Collect this area and all descendant area IDs
  const idsToDelete: string[] = [];
  const collect = (parentId: string) => {
    idsToDelete.push(parentId);
    for (const area of allAreas.filter(a => a.parentId === parentId)) {
      collect(area.id);
    }
  };
  collect(id);

  // Soft-delete all tests in those areas
  for (const areaId of idsToDelete) {
    const areaTests = await queries.getTestsByFunctionalArea(areaId);
    for (const test of areaTests) {
      await queries.softDeleteTest(test.id);
    }
    await queries.deleteFunctionalArea(areaId);
  }

  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function moveArea(id: string, newParentId: string | null) {
  const { area } = await requireAreaOwnership(id);
  // If moving under a parent, ensure parent area is owned by same team and
  // belongs to the same repository as the area being moved.
  if (newParentId) {
    const { area: parentArea } = await requireAreaOwnership(newParentId);
    if (parentArea.repositoryId !== area.repositoryId) {
      throw new Error('Forbidden: parent area belongs to a different repository');
    }
    const allAreas = await queries.getFunctionalAreas();
    const areaMap = new Map(allAreas.map(a => [a.id, a]));

    let current = newParentId;
    while (current) {
      if (current === id) {
        throw new Error('Cannot move area into its own descendant');
      }
      const parent = areaMap.get(current);
      current = parent?.parentId || '';
    }
  }

  await queries.updateFunctionalAreaParent(id, newParentId);
  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function moveTestToArea(testId: string, areaId: string | null) {
  const { test } = await requireTestOwnership(testId);
  if (areaId) {
    const { area } = await requireAreaOwnership(areaId);
    if (area.repositoryId !== test.repositoryId) {
      throw new Error('Forbidden: target area belongs to a different repository');
    }
  }
  await queries.moveTestToArea(testId, areaId);
  revalidatePath('/areas');
  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
}

export async function reorderAreas(repositoryId: string, orderedIds: string[]) {
  await requireRepoWriteAccess(repositoryId);
  await queries.reorderFunctionalAreas(repositoryId, orderedIds);
  revalidatePath('/areas');
}

export async function getAreasTree(repositoryId: string) {
  return queries.getFunctionalAreasTree(repositoryId);
}

export async function getArea(id: string) {
  return queries.getFunctionalArea(id);
}

export async function updateAreaPlan(id: string, agentPlan: string) {
  await requireWriteAccess();
  const area = await queries.getFunctionalArea(id);
  if (!area) throw new Error('Area not found');

  // Save current plan to snapshot for rollback
  const currentSnapshot: FunctionalAreaPlanSnapshot = area.planSnapshot
    ? JSON.parse(area.planSnapshot)
    : { previousPlan: null, generatedTestIds: [] };

  const snapshot: FunctionalAreaPlanSnapshot = {
    previousPlan: area.agentPlan,
    generatedTestIds: currentSnapshot.generatedTestIds,
  };

  await queries.updateFunctionalArea(id, {
    agentPlan,
    planGeneratedAt: new Date(),
    planSnapshot: JSON.stringify(snapshot),
  });

  revalidatePath('/areas');
}

export async function rollbackAreaPlan(id: string) {
  await requireWriteAccess();
  const area = await queries.getFunctionalArea(id);
  if (!area || !area.planSnapshot) throw new Error('No snapshot to rollback');

  const snapshot: FunctionalAreaPlanSnapshot = JSON.parse(area.planSnapshot);

  // Restore plan
  await queries.updateFunctionalArea(id, {
    agentPlan: snapshot.previousPlan,
    planSnapshot: null,
    planGeneratedAt: snapshot.previousPlan ? new Date() : null,
  });

  // Soft-delete generated tests
  if (snapshot.generatedTestIds.length > 0) {
    for (const testId of snapshot.generatedTestIds) {
      await queries.softDeleteTest(testId);
    }
  }

  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function rollbackAllAreaPlans(repositoryId: string) {
  await requireRepoWriteAccess(repositoryId);
  const areas = await queries.getFunctionalAreasByRepo(repositoryId);
  const areasWithSnapshot = areas.filter(a => a.planSnapshot);

  if (areasWithSnapshot.length === 0) throw new Error('No snapshots to rollback');

  for (const area of areasWithSnapshot) {
    await rollbackAreaPlan(area.id);
  }

  revalidatePath('/areas');
  revalidatePath('/tests');
  return areasWithSnapshot.length;
}

export async function exportAllPlans(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  const areas = await queries.getFunctionalAreasByRepo(repositoryId);
  const areasWithPlans = areas.filter(a => a.agentPlan);

  if (areasWithPlans.length === 0) return '# Testing Manifesto\n\nNo test plans generated yet.\n';

  const repo = await queries.getRepository(repositoryId);
  const repoName = repo?.name || 'Project';

  const sections: string[] = [
    `# Testing Manifesto — ${repoName}`,
    `> Generated: ${new Date().toISOString().split('T')[0]}`,
    '',
  ];

  for (const area of areasWithPlans) {
    sections.push(`## ${area.name}`);
    if (area.agentPlan) {
      sections.push('', area.agentPlan);
    }

    // Include specs with status indicators
    const areaSpecs = await queries.getSpecsForArea(area.id);
    if (areaSpecs.length > 0) {
      sections.push('', '### Specs', '');
      for (const spec of areaSpecs) {
        const check = spec.testId ? 'x' : ' ';
        const testInfo = spec.testId ? '' : ' — no test';
        sections.push(`- [${check}] **${spec.title}**${testInfo}`);
      }
    }

    // Include test cases — uses linked test_specs.title for the short form
    const areaTests = await queries.getTestsByFunctionalArea(area.id);
    if (areaTests.length > 0) {
      sections.push('', '### Test Cases', '');
      for (const test of areaTests) {
        const spec = await queries.getTestSpec(test.id);
        const desc = spec?.title && spec.title !== test.name ? `: ${spec.title}` : '';
        sections.push(`- **${test.name}**${desc}`);
      }
    }

    sections.push('', '---', '');
  }

  return sections.join('\n');
}

export async function exportAreaPlan(areaId: string) {
  await requireTeamAccess();
  const area = await queries.getFunctionalArea(areaId);
  if (!area) throw new Error('Area not found');

  const sections: string[] = [`# ${area.name}`];
  if (area.agentPlan) sections.push('', area.agentPlan);

  const areaTests = await queries.getTestsByFunctionalArea(areaId);
  if (areaTests.length > 0) {
    sections.push('', '## Test Cases', '');
    for (const test of areaTests) {
      const spec = await queries.getTestSpec(test.id);
      const desc = spec?.title && spec.title !== test.name ? `: ${spec.title}` : '';
      sections.push(`- **${test.name}**${desc}`);
    }
  }

  return sections.join('\n');
}
