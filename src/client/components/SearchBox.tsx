import type { RefObject } from "react";
import type { Translator } from "../i18n/index.ts";

export const SearchBox = ({
  inputRef,
  query,
  shortcutLabel,
  t,
  onQueryChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  shortcutLabel: string;
  t: Translator;
  onQueryChange: (query: string) => void;
}) => (
  <div className="search-box">
    <span>⌕</span>
    <input
      ref={inputRef}
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      placeholder={t("search.placeholder")}
      aria-label={t("search.placeholder")}
      aria-keyshortcuts="Meta+K Control+K Meta+F Control+F /"
      autoFocus
    />
    {query === "" ? (
      <kbd className="search-shortcut" title={t("search.shortcutHint", { shortcut: shortcutLabel })}>
        {shortcutLabel}
      </kbd>
    ) : (
      <button aria-label={t("search.clear")} onClick={() => onQueryChange("")}>×</button>
    )}
  </div>
);
