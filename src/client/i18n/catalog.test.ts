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
});
