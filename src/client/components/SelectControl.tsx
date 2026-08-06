import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type SelectControlOption<Value extends string> = {
  value: Value;
  label: string;
};

type SelectControlProps<Value extends string> = {
  value: Value;
  options: readonly SelectControlOption<Value>[];
  ariaLabel: string;
  onChange: (value: Value) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
};

export const SelectControl = <Value extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  className,
  id,
  disabled = false,
}: SelectControlProps<Value>) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const generatedListboxId = useId();
  const listboxId = `${id ?? generatedListboxId}-options`;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    const closeWhenClickingOutside = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickingOutside);
  }, []);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, options.length - 1)));
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const openList = (): void => {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const selectOption = (index: number): void => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
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
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) selectOption(activeIndex);
      else openList();
    }
  };

  return (
    <div className={["select-control", className].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        id={id}
        type="button"
        ref={triggerRef}
        className="select-control-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        title={selectedOption?.label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <span className="select-control-arrow" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="select-control-options" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <button
              type="button"
              ref={(element) => { optionRefs.current[index] = element; }}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={activeIndex === index ? "active" : undefined}
              key={option.value}
              title={option.label}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <span className="select-control-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
