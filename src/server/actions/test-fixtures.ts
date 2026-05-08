'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { requireTestOwnership, requireTestFixtureOwnership } from '@/lib/auth/ownership';
import path from 'path';
import fs from 'fs/promises';
import { STORAGE_DIRS } from '@/lib/storage/paths';

const MAX_FIXTURE_SIZE = 10 * 1024 * 1024; // 10MB

async function ensureFixtureDir(repositoryId: string, testId: string) {
  const dir = path.join(STORAGE_DIRS.fixtures, repositoryId, testId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function uploadTestFixture(
  repositoryId: string,
  testId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType?: string,
) {
  await requireRepoAccess(repositoryId);
  // Confirm the test belongs to that repo — without this, an attacker can
  // pass their own repoId + a victim's testId and write fixtures into the
  // victim's test directory.
  const test = await queries.getTest(testId);
  if (!test || test.repositoryId !== repositoryId) {
    return { success: false, error: 'Forbidden: test does not belong to that repository' };
  }

  if (fileBuffer.length > MAX_FIXTURE_SIZE) {
    return { success: false, error: 'File exceeds 10MB limit' };
  }

  const dir = await ensureFixtureDir(repositoryId, testId);

  // Sanitize filename
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(dir, safeName);

  await fs.writeFile(filePath, fileBuffer);

  const relativePath = `/fixtures/${repositoryId}/${testId}/${safeName}`;

  // Delete existing fixture with same filename for this test
  const existing = await queries.getTestFixtures(testId);
  const dup = existing.find(f => f.filename === safeName);
  if (dup) {
    await queries.deleteTestFixture(dup.id);
    // Try to remove old file
    try { await fs.unlink(path.join(STORAGE_DIRS.fixtures, dup.storagePath.replace(/^\/fixtures\//, ''))); } catch {}
  }

  const fixture = await queries.createTestFixture({
    repositoryId,
    testId,
    filename: safeName,
    storagePath: relativePath,
    mimeType: mimeType || 'application/octet-stream',
    sizeBytes: fileBuffer.length,
  });

  revalidatePath('/tests');
  return { success: true, fixture };
}

export async function getTestFixturesAction(testId: string) {
  await requireTestOwnership(testId);
  return queries.getTestFixtures(testId);
}

export async function deleteTestFixtureAction(id: string) {
  const { fixture } = await requireTestFixtureOwnership(id);

  // Try to remove file from disk
  try {
    const absPath = path.join(STORAGE_DIRS.fixtures, fixture.storagePath.replace(/^\/fixtures\//, ''));
    await fs.unlink(absPath);
  } catch {}
  await queries.deleteTestFixture(id);

  revalidatePath('/tests');
  return { success: true };
}
