import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { activateLocale, i18n, translate } from "./index.ts";

afterEach(() => activateLocale("en"));

describe("translation catalogs", () => {
  test("translates English messages and interpolates values", () => {
    activateLocale("en");
    expect(translate("session.messageCount", { count: 12 })).toBe("12 messages");
    expect(translate("sessions.searchResults", { query: "callback" })).toBe(
      "Results for “callback”",
    );
  });

  test("translates Chinese messages", () => {
    activateLocale("zh-CN");
    expect(i18n.locale).toBe("zh-CN");
    expect(translate("session.messageCount", { count: 12 })).toBe("12 条消息");
  });

  test("interpolates raw catalog values in production", () => {
    const script = [
      'import { activateLocale, translate } from "./src/client/i18n/index.ts";',
      'activateLocale("zh-CN");',
      'process.stdout.write(translate("session.messageCount", { count: 12 }));',
    ].join("\n");
    const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("12 条消息");
  });
});
