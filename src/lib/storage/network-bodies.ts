import fs from 'fs/promises';
import path from 'path';
import { STORAGE_DIRS } from './paths';
import type { NetworkRequest } from '@/lib/db/schema';

const BODY_FIELDS = ['requestHeaders', 'responseHeaders', 'postData', 'responseBody'] as const;

/**
 * Extract summary-only data from network requests (no bodies/headers).
 */
export function extractNetworkSummaries(requests: NetworkRequest[]): NetworkRequest[] {
  return requests.map(r => ({
    url: r.url,
    method: r.method,
    status: r.status,
    duration: r.duration,
    resourceType: r.resourceType,
    startTime: r.startTime,
    failed: r.failed,
    errorText: r.errorText,
    responseSize: r.responseSize,
  }));
}

/**
 * Check if any network requests contain body/header data worth saving.
 */
export function hasNetworkBodies(requests: NetworkRequest[]): boolean {
  return requests.some(r =>
    BODY_FIELDS.some(field => r[field] !== undefined && r[field] !== null)
  );
}

/**
 * Save full network request data (with bodies/headers) to a JSON file.
 * Returns the relative storage path for use with /api/media/.
 */
export async function saveNetworkBodies(
  requests: NetworkRequest[],
  testRunId: string,
  testId: string,
  repositoryId?: string | null,
): Promise<string> {
  const dir = path.join(STORAGE_DIRS['network-bodies'], repositoryId || 'default');
  await fs.mkdir(dir, { recursive: true });

  const filename = `${testRunId}-${testId}.json`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, JSON.stringify(requests));

  return `/network-bodies/${repositoryId || 'default'}/${filename}`;
}
