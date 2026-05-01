'use server';

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';

interface RemoteRepo {
  id: string;
  fullName: string;
  name: string;
  owner: string;
}

interface ImportResult {
  success: boolean;
  areasCreated: number;
  areasUpdated: number;
  testsCreated: number;
  testsUpdated: number;
  errors: string[];
}

export async function fetchRemoteRepositories(
  remoteUrl: string,
  apiKey: string
): Promise<{ repos?: RemoteRepo[]; error?: string }> {
  const url = remoteUrl.replace(/\/+$/, '');

  try {
    const res = await fetch(`${url}/api/v1/repos`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 401) {
      return { error: 'Invalid API key or unauthorized' };
    }

    if (!res.ok) {
      return { error: `Remote returned ${res.status}: ${res.statusText}` };
    }

    const data = await res.json();
    const repos: RemoteRepo[] = (Array.isArray(data) ? data : data.repos ?? []).map(
      (r: Record<string, unknown>) => ({
        id: r.id as string,
        fullName: (r.fullName as string) || `${r.owner}/${r.name}`,
        name: r.name as string,
        owner: r.owner as string,
      })
    );

    return { repos };
  } catch (err) {
    return { error: `Could not connect to remote: ${(err as Error).message}` };
  }
}

export async function migrateTests(
  repositoryId: string,
  remoteUrl: string,
  apiKey: string,
  remoteRepoId: string
): Promise<ImportResult> {
  await requireRepoAccess(repositoryId);

  const url = remoteUrl.replace(/\/+$/, '');

  // Fetch local data
  const [areas, tests] = await Promise.all([
    queries.getFunctionalAreasByRepo(repositoryId),
    queries.getTestsByRepo(repositoryId),
  ]);

  // Build area ID -> name map for resolving parent names and test area names
  const areaIdToName = new Map(areas.map((a) => [a.id, a.name]));
  const areaIdToParentId = new Map(areas.map((a) => [a.id, a.parentId]));

  // Resolve parentId chain to parentName
  function getParentName(areaId: string): string | null {
    const parentId = areaIdToParentId.get(areaId);
    if (!parentId) return null;
    return areaIdToName.get(parentId) ?? null;
  }

  const payload = {
    functionalAreas: areas.map((a) => ({
      name: a.name,
      parentName: getParentName(a.id),
      orderIndex: a.orderIndex ?? 0,
      isRouteFolder: a.isRouteFolder ?? false,
      agentPlan: a.agentPlan ?? null,
    })),
    tests: tests.map((t) => ({
      name: t.name,
      functionalAreaName: t.functionalAreaId
        ? areaIdToName.get(t.functionalAreaId) ?? null
        : null,
      code: t.code,
      targetUrl: t.targetUrl,
      assertions: t.assertions,
      executionMode: t.executionMode ?? 'procedural',
      setupOverrides: t.setupOverrides,
      teardownOverrides: t.teardownOverrides,
      stabilizationOverrides: t.stabilizationOverrides,
      viewportOverride: t.viewportOverride,
      diffOverrides: t.diffOverrides,
      playwrightOverrides: t.playwrightOverrides,
      requiredCapabilities: t.requiredCapabilities,
      quarantined: t.quarantined ?? false,
      isPlaceholder: t.isPlaceholder ?? false,
    })),
  };

  try {
    const res = await fetch(`${url}/api/v1/repos/${remoteRepoId}/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      return {
        success: false,
        areasCreated: 0,
        areasUpdated: 0,
        testsCreated: 0,
        testsUpdated: 0,
        errors: ['Invalid API key or unauthorized on remote'],
      };
    }

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        areasCreated: 0,
        areasUpdated: 0,
        testsCreated: 0,
        testsUpdated: 0,
        errors: [`Remote returned ${res.status}: ${text}`],
      };
    }

    return await res.json();
  } catch (err) {
    return {
      success: false,
      areasCreated: 0,
      areasUpdated: 0,
      testsCreated: 0,
      testsUpdated: 0,
      errors: [`Could not connect to remote: ${(err as Error).message}`],
    };
  }
}
