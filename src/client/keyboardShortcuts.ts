export type AppShortcutAction = "focus-search" | "dismiss";

export type AppShortcutInput = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  editable?: boolean;
  surfaceOpen?: boolean;
  documentFocused?: boolean;
};

export const resolveAppShortcut = (input: AppShortcutInput): AppShortcutAction | null => {
  if (input.documentFocused === false) return null;
  if (input.key === "Escape") return "dismiss";
  if (input.surfaceOpen === true) return null;

  const primaryModifier = input.metaKey === true || input.ctrlKey === true;
  const key = input.key.toLocaleLowerCase();
  if (
    primaryModifier &&
    input.altKey !== true &&
    input.shiftKey !== true &&
    (key === "k" || key === "f")
  ) {
    return "focus-search";
  }
  if (
    input.key === "/" &&
    input.metaKey !== true &&
    input.ctrlKey !== true &&
    input.altKey !== true &&
    input.editable !== true
  ) {
    return "focus-search";
  }
  return null;
};

export const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']");
};
