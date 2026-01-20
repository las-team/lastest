'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { RouteScanner } from '@/lib/scanner';
import { generateSmokeTestCode } from '@/lib/scanner/test-generator';
import type { RouteInfo } from '@/lib/scanner/types';

export async function startRouteScan(repositoryId: string, scanPath?: string) {
  // Default to current working directory if no path provided
  const pathToScan = scanPath || process.cwd();

  // Delete existing routes and scan status for this repo
  await queries.deleteRoutesByRepo(repositoryId);
  await queries.deleteScanStatus(repositoryId);

  // Create initial scan status
  const status = await queries.createScanStatus({
    repositoryId,
    status: 'scanning',
    progress: 0,
    routesFound: 0,
    startedAt: new Date(),
  });

  try {
    const scanner = new RouteScanner(pathToScan, async (progress) => {
      // Update scan progress
      await queries.updateScanStatus(status.id, {
        progress: progress.progress,
        routesFound: progress.routesFound,
      });
    });

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

    await queries.createRoutes(routesToCreate);

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

  for (const route of routesToAdd) {
    // Create functional area with route path as name
    const area = await queries.createFunctionalArea({
      repositoryId,
      name: route.path,
      description: `Auto-generated area for route ${route.path}`,
    });

    // Link route to area
    await queries.linkRouteToFunctionalArea(route.id, area.id);
    areasCreated++;
  }

  revalidatePath('/tests');
  revalidatePath('/');

  return { areasCreated };
}

export async function generateBasicTests(repositoryId: string, routeIds: string[], baseUrl: string) {
  const routesToTest = await queries.getRoutesByIds(routeIds);
  let testsCreated = 0;

  for (const route of routesToTest) {
    // Ensure route has a functional area
    let functionalAreaId = route.functionalAreaId;

    if (!functionalAreaId) {
      const area = await queries.createFunctionalArea({
        repositoryId,
        name: route.path,
        description: `Auto-generated area for route ${route.path}`,
      });
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

    // Create test
    await queries.createTest({
      repositoryId,
      functionalAreaId,
      name: `Smoke test: ${route.path}`,
      pathType: 'happy',
      code: testCode,
      targetUrl: route.routerType === 'hash' ? `${baseUrl}/#${route.path}` : `${baseUrl}${route.path}`,
    });

    // Mark route as having a test
    await queries.updateRoute(route.id, { hasTest: true });
    testsCreated++;
  }

  revalidatePath('/tests');
  revalidatePath('/');

  return { testsCreated };
}
