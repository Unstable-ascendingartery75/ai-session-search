import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveConfig } from "./config.ts";

describe("resolveConfig", () => {
  test("enables file watching by default", () => {
    expect(resolveConfig({}).watch).toBe(true);
  });

  test("honors Commander's negated --no-watch option", () => {
    expect(resolveConfig({ watch: false }).watch).toBe(false);
  });

  test("accepts port zero so desktop clients can request an available port", () => {
    expect(resolveConfig({ port: "0" }).port).toBe(0);
  });

  test("enables every registered provider in auto mode and accepts path overrides", () => {
    const config = resolveConfig({ providerDir: ["cursor=/tmp/custom-cursor"] });
    expect(config.providers.has("kimi")).toBe(true);
    expect(config.providerHomes.cursor).toBe(resolve("/tmp/custom-cursor"));
  });

  test("rejects unknown providers", () => {
    expect(() => resolveConfig({ providers: "claude,unknown" })).toThrow("Unknown provider");
  });
});
