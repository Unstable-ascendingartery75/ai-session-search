import { describe, expect, test } from "vitest";
import { clampSidebarWidth, parseStoredSidebarWidth } from "./sidebarWidth.ts";

describe("sidebar width", () => {
  test("clamps dragging to useful desktop bounds", () => {
    expect(clampSidebarWidth(120, 1440)).toBe(280);
    expect(clampSidebarWidth(520, 1440)).toBe(520);
    expect(clampSidebarWidth(900, 1440)).toBe(720);
    expect(clampSidebarWidth(520, 760)).toBe(340);
  });

  test("accepts only finite persisted widths", () => {
    expect(parseStoredSidebarWidth("460")).toBe(460);
    expect(parseStoredSidebarWidth("not-a-number")).toBeNull();
    expect(parseStoredSidebarWidth(null)).toBeNull();
  });
});
