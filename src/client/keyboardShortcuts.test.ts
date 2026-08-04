import { describe, expect, test } from "vitest";
import { resolveAppShortcut } from "./keyboardShortcuts.ts";

describe("resolveAppShortcut", () => {
  test("focuses search with app-local primary shortcuts", () => {
    expect(resolveAppShortcut({ key: "k", metaKey: true })).toBe("focus-search");
    expect(resolveAppShortcut({ key: "f", ctrlKey: true })).toBe("focus-search");
    expect(resolveAppShortcut({ key: "/" })).toBe("focus-search");
  });

  test("does not steal slash from editable controls or any shortcut while unfocused", () => {
    expect(resolveAppShortcut({ key: "/", editable: true })).toBeNull();
    expect(resolveAppShortcut({ key: "k", metaKey: true, documentFocused: false })).toBeNull();
    expect(resolveAppShortcut({ key: "k", metaKey: true, surfaceOpen: true })).toBeNull();
  });

  test("uses Escape only for the currently focused application", () => {
    expect(resolveAppShortcut({ key: "Escape", editable: true, surfaceOpen: true })).toBe("dismiss");
    expect(resolveAppShortcut({ key: "Escape", documentFocused: false })).toBeNull();
  });
});
