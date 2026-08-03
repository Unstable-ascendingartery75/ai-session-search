import { describe, expect, test } from "vitest";
import { DEFAULT_LOCALE, resolvePreferredLocale } from "./localeDetection.ts";

describe("resolvePreferredLocale", () => {
  test("uses Chinese for Chinese browser languages", () => {
    expect(resolvePreferredLocale({ languages: ["zh-CN", "en-US"], language: "en-US" })).toBe(
      "zh-CN",
    );
    expect(resolvePreferredLocale({ languages: ["zh-TW"], language: "zh-TW" })).toBe("zh-CN");
  });

  test("selects the first supported browser language", () => {
    expect(
      resolvePreferredLocale({ languages: ["ja-JP", "zh-CN", "en-US"], language: "ja-JP" }),
    ).toBe("zh-CN");
  });

  test("falls back to navigator.language and then English", () => {
    expect(resolvePreferredLocale({ languages: [], language: "zh-CN" })).toBe("zh-CN");
    expect(resolvePreferredLocale({ languages: ["fr-FR"], language: "fr-FR" })).toBe(
      DEFAULT_LOCALE,
    );
    expect(resolvePreferredLocale()).toBe(DEFAULT_LOCALE);
  });
});
