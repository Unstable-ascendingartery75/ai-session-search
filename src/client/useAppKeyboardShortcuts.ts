import { useEffect, type RefObject } from "react";
import { isEditableShortcutTarget, resolveAppShortcut } from "./keyboardShortcuts.ts";

type ShortcutOptions = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  surfaceOpen: boolean;
  dismissActiveSurface: () => boolean;
};

export const useAppKeyboardShortcuts = ({
  searchInputRef,
  surfaceOpen,
  dismissActiveSurface,
}: ShortcutOptions): void => {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const action = resolveAppShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        editable: isEditableShortcutTarget(event.target),
        surfaceOpen,
        documentFocused: document.hasFocus(),
      });
      if (action === null) return;
      if (action === "dismiss") {
        if (dismissActiveSurface()) event.preventDefault();
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [dismissActiveSurface, searchInputRef, surfaceOpen]);
};

export const useDialogFocus = (
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  wasOpenRef: RefObject<boolean>,
): void => {
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [initialFocusRef, open, triggerRef, wasOpenRef]);
};
