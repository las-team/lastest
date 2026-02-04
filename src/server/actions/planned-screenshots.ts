'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { hashImage } from '@/lib/diff/hasher';
import { getCurrentSession } from '@/lib/auth';
import path from 'path';
import fs from 'fs/promises';

const PLANNED_DIR = path.join(process.cwd(), 'public', 'planned');

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
  const session = await getCurrentSession();
  const userId = session?.user?.id;

  const dir = await ensurePlannedDir(input.repositoryId);

  // Generate unique filename
  const timestamp = Date.now();
  const ext = path.extname(fileName) || '.png';
  const baseName = input.testId
    ? `${input.testId}${input.stepLabel ? `-${input.stepLabel}` : ''}`
    : input.routeId || 'planned';
  const newFileName = `${baseName}-${timestamp}${ext}`;
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
  return queries.getPlannedScreenshotByTest(testId, stepLabel || null);
}

/**
 * Get planned screenshot by route
 */
export async function getPlannedScreenshotByRoute(routeId: string) {
  return queries.getPlannedScreenshotByRoute(routeId);
}

/**
 * List all planned screenshots for a repository
 */
export async function listPlannedScreenshots(repositoryId: string) {
  return queries.getPlannedScreenshotsByRepo(repositoryId);
}

/**
 * List all planned screenshots for a specific test
 */
export async function listPlannedScreenshotsForTest(testId: string) {
  return queries.getPlannedScreenshotsByTest(testId);
}

/**
 * Delete a planned screenshot (soft delete)
 */
export async function deletePlannedScreenshot(id: string) {
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
  await queries.updatePlannedScreenshot(id, data);
  revalidatePath('/tests');
  revalidatePath('/routes');
  return { success: true };
}

/**
 * Get planned screenshot by ID
 */
export async function getPlannedScreenshotById(id: string) {
  return queries.getPlannedScreenshot(id);
}
