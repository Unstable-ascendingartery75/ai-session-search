import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Translator } from "../i18n/index.ts";
import {
  filterProjectOptions,
  type ProjectFilterOption,
} from "../projectFilter.ts";

type ProjectFilterProps = {
  projects: readonly ProjectFilterOption[];
  value: string;
  t: Translator;
  onChange: (projectPath: string) => void;
};

export const ProjectFilter = ({ projects, value, t, onChange }: ProjectFilterProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const filteredProjects = useMemo(
    () => filterProjectOptions(projects, query),
    [projects, query],
  );
  const showAllProjectsOption = query.trim() === "";
  const optionCount = filteredProjects.length + (showAllProjectsOption ? 1 : 0);

  useEffect(() => {
    const closeWhenClickingOutside = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", closeWhenClickingOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickingOutside);
  }, []);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, optionCount - 1)));
  }, [optionCount]);

  const openList = (): void => {
    if (open) return;
    setOpen(true);
    setQuery("");
    setActiveIndex(value === "" ? 0 : Math.max(0, projects.findIndex((item) => item.projectPath === value) + 1));
  };

  const selectProject = (projectPath: string): void => {
    onChange(projectPath);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const projectAtIndex = (index: number): ProjectFilterOption | null | undefined => {
    if (showAllProjectsOption) {
      if (index === 0) return null;
      return filteredProjects[index - 1];
    }
    return filteredProjects[index];
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      if (optionCount === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter" && open && optionCount > 0) {
      event.preventDefault();
      const project = projectAtIndex(activeIndex);
      if (project !== undefined) selectProject(project?.projectPath ?? "");
    }
  };

  return (
    <div className="project-filter project-combobox" ref={rootRef}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && optionCount > 0 ? `${listboxId}-${activeIndex}` : undefined}
        value={open ? query : value}
        placeholder={t("filter.allProjects")}
        title={value || t("filter.allProjects")}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          if (!open) setOpen(true);
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="project-combobox-toggle"
        aria-label={t("filter.searchProjects")}
        tabIndex={-1}
        onClick={() => {
          if (open) {
            setOpen(false);
            setQuery("");
            inputRef.current?.blur();
          } else {
            inputRef.current?.focus();
          }
        }}
      >
        ▾
      </button>
      {open && (
        <div className="project-options" id={listboxId} role="listbox">
          {showAllProjectsOption && (
            <button
              type="button"
              id={`${listboxId}-0`}
              role="option"
              aria-selected={value === ""}
              className={activeIndex === 0 ? "active" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(0)}
              onClick={() => selectProject("")}
            >
              {t("filter.allProjects")}
            </button>
          )}
          {filteredProjects.map((project, index) => {
            const optionIndex = index + (showAllProjectsOption ? 1 : 0);
            return (
              <button
                type="button"
                id={`${listboxId}-${optionIndex}`}
                role="option"
                aria-selected={project.projectPath === value}
                className={activeIndex === optionIndex ? "active" : undefined}
                key={`${project.provider}:${project.projectPath}`}
                title={project.projectPath}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(optionIndex)}
                onClick={() => selectProject(project.projectPath)}
              >
                <span>{project.projectPath}</span>
                <small>{project.count}</small>
              </button>
            );
          })}
          {filteredProjects.length === 0 && !showAllProjectsOption && (
            <p className="project-options-empty">{t("filter.noProjects")}</p>
          )}
        </div>
      )}
    </div>
  );
};
