'use server';

import { revalidatePath } from 'next/cache';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as queries from '@/lib/db/queries';
import { RouteScanner } from '@/lib/scanner';
import { generateSmokeTestCode } from '@/lib/scanner/test-generator';
import type { RouteInfo } from '@/lib/scanner/types';

export async function validateLocalPath(localPath: string): Promise<{
  valid: boolean;
  hasPackageJson: boolean;
  framework?: string;
  error?: string;
  resolvedPath?: string;
  isMonorepo?: boolean;
  frontendPath?: string;
}> {
  try {
    const resolvedPath = localPath.startsWith('~')
      ? path.join(os.homedir(), localPath.slice(1))
      : path.resolve(localPath);

    // Check if directory exists
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return { valid: false, hasPackageJson: false, error: 'Path is not a directory' };
    }

    // Check for package.json at root
    let hasPackageJson = false;
    let framework: string | undefined;
    let isMonorepo = false;
    let frontendPath: string | undefined;

    try {
      const packageJsonPath = path.join(resolvedPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      hasPackageJson = true;

      const packageJson = JSON.parse(content);
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (deps.next) framework = 'Next.js';
      else if (deps['react-router'] || deps['react-router-dom']) framework = 'React Router';
      else if (deps.vue && deps['vue-router']) framework = 'Vue';
      else if (deps.react) framework = 'React';
    } catch {
      // No package.json at root - check for monorepo structure
      const frontendDirs = ['frontend', 'client', 'web', 'app', 'packages/frontend', 'packages/web', 'packages/client'];

      for (const dir of frontendDirs) {
        const checkPath = path.join(resolvedPath, dir);
        try {
          const pkgPath = path.join(checkPath, 'package.json');
          const content = await fs.readFile(pkgPath, 'utf-8');
          const pkg = JSON.parse(content);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          if (deps.next || deps.react || deps.vue) {
            isMonorepo = true;
            frontendPath = checkPath;
            hasPackageJson = true;

            if (deps.next) framework = 'Next.js';
            else if (deps['react-router'] || deps['react-router-dom']) framework = 'React Router';
            else if (deps.vue && deps['vue-router']) framework = 'Vue';
            else if (deps.react) framework = 'React';
            break;
          }
        } catch {
          // Not a valid frontend directory
        }
      }
    }

    if (!hasPackageJson) {
      return {
        valid: false,
        hasPackageJson: false,
        error: 'No package.json found (checked root and common frontend directories)',
        resolvedPath,
      };
    }

    return {
      valid: true,
      hasPackageJson,
      framework,
      resolvedPath,
      isMonorepo,
      frontendPath,
    };
  } catch (error) {
    return {
      valid: false,
      hasPackageJson: false,
      error: error instanceof Error ? error.message : 'Path does not exist',
    };
  }
}

export async function getDefaultLocalPath(repoName: string): Promise<string> {
  const home = os.homedir();
  return `${home}/dev/${repoName}`;
}

export async function startRouteScan(repositoryId: string, scanPath?: string) {
  // Use provided path, or get from repository's localPath
  let pathToScan = scanPath;

  if (!pathToScan) {
    const repo = await queries.getRepository(repositoryId);
    pathToScan = repo?.localPath || undefined;
  }

  if (!pathToScan) {
    return {
      success: false,
      error: 'No local path configured. Please set the repository local path first.',
    };
  }

  // Resolve ~ to home directory
  if (pathToScan.startsWith('~')) {
    pathToScan = path.join(os.homedir(), pathToScan.slice(1));
  }
  pathToScan = path.resolve(pathToScan);

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
      pathType: 'happy',
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
