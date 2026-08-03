import { describe, expect, test } from "vitest";
import { resolveConfig } from "./config.ts";

describe("resolveConfig", () => {
  test("enables file watching by default", () => {
    expect(resolveConfig({}).watch).toBe(true);
  });

  test("honors Commander's negated --no-watch option", () => {
    expect(resolveConfig({ watch: false }).watch).toBe(false);
  });

  test("enables every registered provider in auto mode and accepts path overrides", () => {
    const config = resolveConfig({ providerDir: ["pi=/tmp/custom-pi"] });
    expect(config.providers.has("kimi")).toBe(true);
    expect(config.providerHomes.pi).toBe("/tmp/custom-pi");
  });

  test("rejects unknown providers", () => {
    expect(() => resolveConfig({ providers: "claude,unknown" })).toThrow("Unknown provider");
  });
});
