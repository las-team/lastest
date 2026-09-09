/**
 * Minimal promise concurrency limiter (§8.3): `limit(fn)` runs at most
 * `concurrency` functions at once, in submission order.
 */
export interface Limit {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
  readonly concurrency: number;
}

export function pLimit(concurrency: number): Limit {
  const max = Math.max(1, Math.floor(concurrency));
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };
  const limit = (<T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    })) as Limit;
  Object.defineProperties(limit, {
    active: { get: () => active },
    pending: { get: () => queue.length },
    concurrency: { value: max },
  });
  return limit;
}

/** Run `items` through `fn` with bounded concurrency, preserving order of results. */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
