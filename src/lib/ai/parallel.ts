/**
 * Parallel AI execution with semaphore-based concurrency control.
 *
 * Provides a fire-and-forget pattern for long-running operations
 * with bounded concurrency (default: 5) and progress callbacks.
 */

export interface ParallelTask<T> {
  id: string;
  execute: () => Promise<T>;
}

export interface ParallelResult<T> {
  id: string;
  success: boolean;
  result?: T;
  error?: string;
}

/**
 * Run tasks in parallel with bounded concurrency using a semaphore pattern.
 *
 * - Maintains result order matching input order
 * - Individual task failures don't abort others
 * - Progress callbacks for job tracking
 */
export async function runParallel<T>(
  tasks: ParallelTask<T>[],
  maxConcurrent: number = 5,
  onProgress?: (completed: number, total: number, activeCount: number) => Promise<void>
): Promise<ParallelResult<T>[]> {
  if (tasks.length === 0) return [];

  const results: ParallelResult<T>[] = new Array(tasks.length);
  let completedCount = 0;
  let activeCount = 0;

  // Semaphore: resolve functions waiting for a slot
  const waitQueue: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (activeCount < maxConcurrent) {
      activeCount++;
      return;
    }
    return new Promise<void>((resolve) => {
      waitQueue.push(() => {
        activeCount++;
        resolve();
      });
    });
  }

  function release(): void {
    activeCount--;
    if (waitQueue.length > 0) {
      const next = waitQueue.shift()!;
      next();
    }
  }

  const promises = tasks.map(async (task, index) => {
    await acquire();

    try {
      const result = await task.execute();
      results[index] = { id: task.id, success: true, result };
    } catch (err) {
      results[index] = {
        id: task.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      release();
      completedCount++;
      if (onProgress) {
        await onProgress(completedCount, tasks.length, activeCount).catch(() => {});
      }
    }
  });

  await Promise.all(promises);

  return results;
}
