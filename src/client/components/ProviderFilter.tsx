import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ProviderDescriptor, ProviderId } from "../../shared/types.ts";
import type { Translator } from "../i18n/index.ts";

type ProviderFilterProps = {
  providers: readonly ProviderDescriptor[];
  value: ProviderId | "all";
  t: Translator;
  onChange: (provider: ProviderId | "all") => void;
};

export const ProviderFilter = ({ providers, value, t, onChange }: ProviderFilterProps) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const options: Array<{ value: ProviderId | "all"; label: string }> = [
    { value: "all", label: t("common.all") },
    ...providers.map((provider) => ({ value: provider.id, label: provider.label })),
  ];
  const selectedLabel = options.find((option) => option.value === value)?.label ?? t("common.all");

  useEffect(() => {
    const closeWhenClickingOutside = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickingOutside);
  }, []);

  const openList = (): void => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };

  const selectProvider = (provider: ProviderId | "all"): void => {
    onChange(provider);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) selectProvider(option.value);
    }
  };

  return (
    <div className="provider-filter compact-select-filter" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="compact-select-trigger"
        aria-label={t("filter.allProviders")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        title={selectedLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className="compact-filter-label">{t("filter.providerLabel")}</span>
        <span className="compact-filter-value">{selectedLabel}</span>
        <span className="compact-filter-arrow" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="provider-options compact-filter-options" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <button
              type="button"
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={activeIndex === index ? "active" : undefined}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectProvider(option.value)}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
