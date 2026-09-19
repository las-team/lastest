import { describe, expect, it } from "vitest";
import { mapLimit, pLimit } from "./p-limit";

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

describe("pLimit (§8.3)", () => {
  it("never runs more than `concurrency` functions at once and preserves order", async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          order.push(i);
          active--;
          return i * 10;
        }),
      ),
    );
    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
    expect(limit.active).toBe(0);
    expect(limit.pending).toBe(0);
    expect(limit.concurrency).toBe(2);
  });

  it("propagates rejections and keeps draining the queue", async () => {
    const limit = pLimit(1);
    const a = limit(async () => {
      throw new Error("boom");
    });
    const b = limit(async () => "ok");
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
  });

  it("mapLimit bounds concurrency and clamps silly values to 1", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4], 0, async (x, i) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return x + i;
    });
    expect(out).toEqual([1, 3, 5, 7]);
    expect(peak).toBe(1);
    expect(pLimit(2.9).concurrency).toBe(2);
  });
});
