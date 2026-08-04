import { describe, expect, test } from "vitest";
import { mapWithConcurrency } from "./files.ts";

describe("mapWithConcurrency", () => {
  test("preserves result order while enforcing the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, value % 2 === 0 ? 1 : 3));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(3);
  });
});
