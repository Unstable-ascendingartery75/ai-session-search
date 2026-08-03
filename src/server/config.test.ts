import { describe, expect, test } from "vitest";
import { resolveConfig } from "./config.ts";

describe("resolveConfig", () => {
  test("enables file watching by default", () => {
    expect(resolveConfig({}).watch).toBe(true);
  });

  test("honors Commander's negated --no-watch option", () => {
    expect(resolveConfig({ watch: false }).watch).toBe(false);
  });
});
