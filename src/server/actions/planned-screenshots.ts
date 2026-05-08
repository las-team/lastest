'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { hashImage } from '@/lib/diff/hasher';
import { getCurrentSession, requireRepoAccess } from '@/lib/auth';
import { requireTestOwnership, requirePlannedScreenshotOwnership } from '@/lib/auth/ownership';
import path from 'path';
import fs from 'fs/promises';
import { STORAGE_DIRS } from '@/lib/storage/paths';

const PLANNED_DIR = STORAGE_DIRS.planned;

// Ensure planned directory exists
async function ensurePlannedDir(repositoryId: string) {
  const dir = path.join(PLANNED_DIR, repositoryId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export interface UploadPlannedScreenshotInput {
  repositoryId: string;
  testId?: string;
  stepLabel?: string;
  routeId?: string;
  name?: string;
  description?: string;
  sourceUrl?: string;
}

/**
 * Upload a planned screenshot from a file buffer
 */
export async function uploadPlannedScreenshot(
  input: UploadPlannedScreenshotInput,
  fileBuffer: Buffer,
  fileName: string
) {
  await requireRepoAccess(input.repositoryId);
  const session = await getCurrentSession();
  const userId = session?.user?.id;

  const dir = await ensurePlannedDir(input.repositoryId);

  // Generate unique filename with sanitized inputs. The testId/routeId fields
  // come from the upload form and would otherwise allow path traversal via
  // `path.join(dir, "../../../etc/foo-…png")`. Strip every unsafe character
  // first, then re-base the result via path.basename as defense-in-depth.
  const timestamp = Date.now();
  const rawExt = path.extname(fileName).toLowerCase();
  const ext = ['.png', '.jpg', '.jpeg', '.webp'].includes(rawExt) ? rawExt : '.png';
  const safeStepLabel = input.stepLabel?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
  const cleanTestId = input.testId?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
  const cleanRouteId = input.routeId?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
  const baseName = cleanTestId
    ? `${cleanTestId}${safeStepLabel ? `-${safeStepLabel}` : ''}`
    : cleanRouteId || 'planned';
  const rawFileName = `${baseName}-${timestamp}${ext}`;
  const newFileName = path.basename(rawFileName);
  const filePath = path.join(dir, newFileName);

  // Write file
  await fs.writeFile(filePath, fileBuffer);

  // Generate hash
  const imageHash = hashImage(filePath);

  // Create relative path for storage
  const relativePath = `/planned/${input.repositoryId}/${newFileName}`;

  // Deactivate any existing planned screenshot for this test/step or route
  if (input.testId) {
    const existing = await queries.getPlannedScreenshotByTest(input.testId, input.stepLabel || null);
    if (existing) {
      await queries.deletePlannedScreenshot(existing.id);
    }
  } else if (input.routeId) {
    const existing = await queries.getPlannedScreenshotByRoute(input.routeId);
    if (existing) {
      await queries.deletePlannedScreenshot(existing.id);
    }
  }

  // Create new planned screenshot record
  const planned = await queries.createPlannedScreenshot({
    repositoryId: input.repositoryId,
    testId: input.testId || null,
    stepLabel: input.stepLabel || null,
    routeId: input.routeId || null,
    imagePath: relativePath,
    imageHash,
    name: input.name || null,
    description: input.description || null,
    uploadedBy: userId || null,
    sourceUrl: input.sourceUrl || null,
    isActive: true,
  });

  revalidatePath('/tests');
  revalidatePath('/routes');

  return { success: true, plannedScreenshot: planned };
}

/**
 * Get planned screenshot for a test (optionally with step label)
 */
export async function getPlannedScreenshot(testId: string, stepLabel?: string) {
  await requireTestOwnership(testId);
  return queries.getPlannedScreenshotByTest(testId, stepLabel || null);
}

/**
 * Get planned screenshot by route
 */
export async function getPlannedScreenshotByRoute(routeId: string) {
  // Look up the planned screenshot first; verify caller's team owns its
  // repository before returning it.
  const planned = await queries.getPlannedScreenshotByRoute(routeId);
  if (!planned) return null;
  if (!planned.repositoryId) return null;
  await requireRepoAccess(planned.repositoryId);
  return planned;
}

/**
 * List all planned screenshots for a repository
 */
export async function listPlannedScreenshots(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return queries.getPlannedScreenshotsByRepo(repositoryId);
}

/**
 * List all planned screenshots for a specific test
 */
export async function listPlannedScreenshotsForTest(testId: string) {
  await requireTestOwnership(testId);
  return queries.getPlannedScreenshotsByTest(testId);
}

/**
 * Delete a planned screenshot (soft delete)
 */
export async function deletePlannedScreenshot(id: string) {
  await requirePlannedScreenshotOwnership(id);
  await queries.deletePlannedScreenshot(id);
  revalidatePath('/tests');
  revalidatePath('/routes');
  return { success: true };
}

/**
 * Update planned screenshot metadata
 */
export async function updatePlannedScreenshot(
  id: string,
  data: { name?: string; description?: string; sourceUrl?: string }
) {
  await requirePlannedScreenshotOwnership(id);
  await queries.updatePlannedScreenshot(id, data);
  revalidatePath('/tests');
  revalidatePath('/routes');
  return { success: true };
}

/**
 * Get planned screenshot by ID
 */
export async function getPlannedScreenshotById(id: string) {
  const { planned } = await requirePlannedScreenshotOwnership(id);
  return planned;
}

/**
 * Assign a planned screenshot to a specific test step
 */
export async function assignPlannedToStep(
  plannedId: string,
  testId: string,
  stepLabel: string
) {
  const { planned } = await requirePlannedScreenshotOwnership(plannedId);
  const { test } = await requireTestOwnership(testId);
  if (planned.repositoryId !== test.repositoryId) {
    return { success: false, error: 'Forbidden: planned screenshot and test belong to different repositories' };
  }

  await queries.updatePlannedScreenshot(plannedId, {
    testId,
    stepLabel,
  });

  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

/**
 * Remove the step assignment from a planned screenshot
 */
export async function unassignPlannedFromStep(plannedId: string) {
  const { planned } = await requirePlannedScreenshotOwnership(plannedId);

  await queries.updatePlannedScreenshot(plannedId, {
    stepLabel: null,
  });

  if (planned.testId) {
    revalidatePath(`/tests/${planned.testId}`);
  }
  return { success: true };
}
