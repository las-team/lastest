'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { RemoteRouteScanner } from '@/lib/scanner/remote-scanner';
import { generateSmokeTestCode } from '@/lib/scanner/test-generator';
import type { RouteInfo } from '@/lib/scanner/types';

export async function startRemoteRouteScan(repositoryId: string, branch: string) {
  const account = await queries.getGithubAccount();
  if (!account) {
    return {
      success: false,
      error: 'GitHub account not connected. Please connect your GitHub account first.',
    };
  }

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    return {
      success: false,
      error: 'Repository not found.',
    };
  }

  // Delete existing routes and scan status for this repo
  await queries.deleteRoutesByRepo(repositoryId);
  await queries.deleteScanStatus(repositoryId);

  // Update selected branch on repository
  await queries.updateRepository(repositoryId, { selectedBranch: branch });

  // Create initial scan status
  const status = await queries.createScanStatus({
    repositoryId,
    status: 'scanning',
    progress: 0,
    routesFound: 0,
    startedAt: new Date(),
  });

  try {
    const scanner = new RemoteRouteScanner(
      {
        accessToken: account.accessToken,
        owner: repo.owner,
        repo: repo.name,
        branch,
      },
      async (progress) => {
        // Update scan progress
        await queries.updateScanStatus(status.id, {
          progress: progress.progress,
          routesFound: progress.routesFound,
        });
      }
    );

    const result = await scanner.scan();

    // Save discovered routes
    const routesToCreate = result.routes.map((r: RouteInfo) => ({
      repositoryId,
      path: r.path,
      type: r.type,
      filePath: r.filePath,
      framework: r.framework,
      routerType: r.routerType,
      hasTest: false,
      scannedAt: new Date(),
    }));

    const createdRoutes = await queries.createRoutes(routesToCreate);

    // Create or get the "Routes" folder
    const routesFolder = await queries.getOrCreateRoutesFolder(repositoryId);

    // Create sub-folders for each discovered route under the Routes folder
    for (const route of createdRoutes) {
      const area = await queries.createFunctionalArea({
        repositoryId,
        name: route.path,
        description: `Route: ${route.path}`,
        parentId: routesFolder.id,
        isRouteFolder: true,
      });
      await queries.linkRouteToFunctionalArea(route.id, area.id);
    }

    // Update scan status to completed
    await queries.updateScanStatus(status.id, {
      status: 'completed',
      progress: 100,
      routesFound: result.routes.length,
      framework: result.framework,
      completedAt: new Date(),
    });

    revalidatePath('/repo');
    revalidatePath('/tests');
    revalidatePath('/');

    return {
      success: true,
      routesFound: result.routes.length,
      framework: result.framework,
    };
  } catch (error) {
    await queries.updateScanStatus(status.id, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      completedAt: new Date(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getScanProgress(repositoryId: string) {
  return queries.getScanStatus(repositoryId);
}

export async function getRoutes(repositoryId: string) {
  return queries.getRoutesByRepo(repositoryId);
}

export async function getRouteCoverage(repositoryId: string) {
  return queries.getRouteCoverageStats(repositoryId);
}

export async function addRoutesAsFunctionalAreas(repositoryId: string, routeIds: string[]) {
  const routesToAdd = await queries.getRoutesByIds(routeIds);
  let areasCreated = 0;
  let areasMerged = 0;

  for (const route of routesToAdd) {
    // Get or create functional area (case-insensitive deduplication)
    const existingAreas = await queries.getFunctionalAreasByRepo(repositoryId);
    const existing = existingAreas.find(a => a.name.toLowerCase() === route.path.toLowerCase());

    let area;
    if (existing) {
      area = existing;
      areasMerged++;
    } else {
      area = await queries.createFunctionalArea({
        repositoryId,
        name: route.path,
        description: `Auto-generated area for route ${route.path}`,
      });
      areasCreated++;
    }

    // Link route to area
    await queries.linkRouteToFunctionalArea(route.id, area.id);
  }

  revalidatePath('/tests');
  revalidatePath('/');

  return { areasCreated, areasMerged };
}

export async function generateBasicTests(repositoryId: string, routeIds: string[], baseUrl: string) {
  const routesToTest = await queries.getRoutesByIds(routeIds);
  let testsCreated = 0;
  let testsUpdated = 0;

  for (const route of routesToTest) {
    // Ensure route has a functional area (with case-insensitive deduplication)
    let functionalAreaId = route.functionalAreaId;

    if (!functionalAreaId) {
      const area = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        route.path,
        `Auto-generated area for route ${route.path}`
      );
      functionalAreaId = area.id;
      await queries.linkRouteToFunctionalArea(route.id, area.id);
    }

    // Generate smoke test code
    const testCode = generateSmokeTestCode(
      {
        path: route.path,
        type: route.type as 'static' | 'dynamic',
        routerType: route.routerType as 'hash' | 'browser' | undefined,
      },
      baseUrl
    );

    const targetUrl = route.routerType === 'hash' ? `${baseUrl}/#${route.path}` : `${baseUrl}${route.path}`;

    // Upsert test (update if exists, create if not)
    const result = await queries.upsertTestByTargetUrl({
      repositoryId,
      functionalAreaId,
      name: `Smoke test: ${route.path}`,
      code: testCode,
      targetUrl,
    });

    // Track if created or updated
    if (result.createdAt && result.createdAt.getTime() === result.updatedAt?.getTime()) {
      testsCreated++;
    } else {
      testsUpdated++;
    }

    // Mark route as having a test
    await queries.updateRoute(route.id, { hasTest: true });
  }

  revalidatePath('/tests');
  revalidatePath('/');

  return { testsCreated, testsUpdated };
}
