import { useLingui } from "@lingui/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  CollectionSummary,
  NormalizedMessage,
  ProviderDescriptor,
  ProviderId,
  ProviderSourceSetting,
  ProviderStatus,
  ResumeCommandTemplates,
  RuntimePlatform,
  SearchResult,
  SessionSummary,
  SyncProgress,
  TerminalId,
  TerminalSettings,
} from "../shared/types.ts";
import { PROVIDER_DESCRIPTORS, providerDescriptor } from "../shared/providers.ts";
import {
  DEFAULT_RESUME_COMMAND_TEMPLATES,
  renderResumeCommand,
} from "../shared/resumeCommand.ts";
import type { Translator } from "./i18n/index.ts";
import {
  commandDialectForTerminal,
  defaultTerminalSettings,
  terminalIdsForPlatform,
} from "../shared/terminal.ts";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  parseStoredSidebarWidth,
  SIDEBAR_STORAGE_KEY,
} from "./sidebarWidth.ts";

type Project = { provider: ProviderId; projectPath: string; count: number };
type SessionDetail = { session: SessionSummary; messages: NormalizedMessage[] };
type AppStatus = {
  providers: ProviderStatus[];
  counts: Record<ProviderId, number>;
  sync: SyncProgress;
  runtimePlatform: RuntimePlatform;
};
type ProviderSourceDraft = { enabled: boolean; home: string };

const GITHUB_URL = "https://github.com/lililib/ai-session-search";

const DEFAULT_TERMINAL_SETTINGS = defaultTerminalSettings("darwin");

const initialSidebarWidth = (): number => {
  try {
    const stored = parseStoredSidebarWidth(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
    return clampSidebarWidth(stored ?? DEFAULT_SIDEBAR_WIDTH, window.innerWidth);
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
};

const jsonRequest = async <T,>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const detail = typeof body?.error === "string" ? `: ${body.error}` : "";
    throw new Error(`Request failed: ${response.status}${detail}`);
  }
  return response.json() as Promise<T>;
};

const queryString = (values: Record<string, string | boolean | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
};

const providerLabel = (provider: ProviderId): string => providerDescriptor(provider).label;
const providerColor = (provider: ProviderId): string => providerDescriptor(provider).color;

const isSearchResult = (item: SessionSummary | SearchResult): item is SearchResult =>
  "messageIndex" in item;

const formatDate = (value: string, locale: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(locale);
};

const copyText = async (value: string, unavailableMessage: string): Promise<void> => {
  if (navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to document.execCommand for browsers that block the Clipboard API.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error(unavailableMessage);
};

export const App = () => {
  const { i18n } = useLingui();
  const t: Translator = (id, values) => i18n._(id, values);
  const locale = i18n.locale || "en";
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [provider, setProvider] = useState<ProviderId | "all">("all");
  const [providerDescriptors, setProviderDescriptors] = useState<ProviderDescriptor[]>(PROVIDER_DESCRIPTORS);
  const [projectPath, setProjectPath] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [renamedOnly, setRenamedOnly] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [collectionEditor, setCollectionEditor] = useState<"create" | "rename" | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [selected, setSelected] = useState<SessionDetail | null>(null);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [resumeCommandTemplates, setResumeCommandTemplates] =
    useState<ResumeCommandTemplates>(DEFAULT_RESUME_COMMAND_TEMPLATES);
  const [editingResumeCommand, setEditingResumeCommand] = useState(false);
  const [resumeCommandDraft, setResumeCommandDraft] = useState("");
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
  const [terminalDraft, setTerminalDraft] = useState<TerminalId>("terminal");
  const [customTerminalPathDraft, setCustomTerminalPathDraft] = useState("");
  const [shellPathDraft, setShellPathDraft] = useState("/bin/zsh");
  const [providerSourceSettings, setProviderSourceSettings] = useState<ProviderSourceSetting[]>([]);
  const [providerSourceDrafts, setProviderSourceDrafts] = useState<Partial<Record<ProviderId, ProviderSourceDraft>>>({});
  const [showProviderSources, setShowProviderSources] = useState(false);
  const [savingProviderSource, setSavingProviderSource] = useState<ProviderId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  const resizingSidebarRef = useRef(false);
  const messageRefs = useRef(new Map<number, HTMLElement>());
  const runtimePlatform = status?.runtimePlatform ?? "other";
  const availableTerminalIds = terminalIdsForPlatform(runtimePlatform);
  const terminalSupported = availableTerminalIds.length > 0;
  const commandDialect = commandDialectForTerminal(
    terminalSettings.terminal,
    runtimePlatform,
    terminalSettings.shellPath,
  );

  const applyProviderSourceSettings = (settings: ProviderSourceSetting[]): void => {
    setProviderSourceSettings(settings);
    setProviderSourceDrafts(Object.fromEntries(
      settings.map((setting) => [setting.provider, {
        enabled: setting.enabled,
        home: setting.home,
      }]),
    ));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.name");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t("app.description"));
  }, [locale]);

  useEffect(() => {
    jsonRequest<{ providers: ProviderDescriptor[] }>("/api/providers")
      .then((data) => setProviderDescriptors(data.providers))
      .catch((caught: unknown) => setError(String(caught)));
    jsonRequest<{ templates: ResumeCommandTemplates }>("/api/settings/resume-commands")
      .then((data) => setResumeCommandTemplates(data.templates))
      .catch((caught: unknown) => setError(String(caught)));
    jsonRequest<{ settings: TerminalSettings }>("/api/settings/terminal")
      .then((data) => setTerminalSettings(data.settings))
      .catch((caught: unknown) => setError(String(caught)));
    jsonRequest<{ settings: ProviderSourceSetting[] }>("/api/settings/providers")
      .then((data) => applyProviderSourceSettings(data.settings))
      .catch((caught: unknown) => setError(String(caught)));
  }, []);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (provider === "all" || status === null) return;
    if ((status.counts[provider] ?? 0) === 0) {
      setProvider("all");
      setProjectPath("");
    }
  }, [provider, status]);

  const filters = useMemo(
    () => ({
      provider: provider === "all" ? undefined : provider,
      projectPath: projectPath || undefined,
      favorites: favoritesOnly,
      renamed: renamedOnly,
      collection: collectionFilter === "all" ? undefined : collectionFilter,
    }),
    [provider, projectPath, favoritesOnly, renamedOnly, collectionFilter],
  );

  const refreshSidebar = useCallback(async (): Promise<void> => {
    const suffix = queryString(filters);
    const [sessionData, projectData, statusData, collectionData] = await Promise.all([
      jsonRequest<{ sessions: SessionSummary[] }>(`/api/sessions?${suffix}`),
      jsonRequest<{ projects: Project[] }>("/api/projects"),
      jsonRequest<AppStatus>("/api/status"),
      jsonRequest<{ collections: CollectionSummary[] }>("/api/collections"),
    ]);
    setSessions(sessionData.sessions);
    setProjects(projectData.projects);
    setStatus(statusData);
    setCollections(collectionData.collections);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    refreshSidebar()
      .catch((caught: unknown) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, [refreshSidebar]);

  useEffect(() => {
    if (status?.sync.running !== true) return;
    const timer = window.setInterval(() => {
      void refreshSidebar().catch((caught: unknown) => setError(String(caught)));
    }, 750);
    return () => window.clearInterval(timer);
  }, [status?.sync.running, refreshSidebar]);

  useEffect(() => {
    if (debouncedQuery === "") {
      setResults([]);
      return;
    }
    setLoading(true);
    const suffix = queryString({ q: debouncedQuery, ...filters });
    jsonRequest<{ results: SearchResult[] }>(`/api/search?${suffix}`)
      .then((data) => setResults(data.results))
      .catch((caught: unknown) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, [debouncedQuery, filters]);

  useEffect(() => {
    if (selectedMessageIndex === null) return;
    window.setTimeout(() => {
      messageRefs.current.get(selectedMessageIndex)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 30);
  }, [selected, selectedMessageIndex]);

  const openSession = async (sessionKey: string, messageIndex?: number): Promise<void> => {
    setLoading(true);
    try {
      const detail = await jsonRequest<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionKey)}`);
      setSelected(detail);
      setSelectedMessageIndex(messageIndex ?? null);
      setEditingTitle(false);
      setEditingResumeCommand(false);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  };

  const updateMetadata = async (
    session: SessionSummary,
    patch: { customTitle?: string | null; favorite?: boolean; collectionId?: number | null },
  ): Promise<void> => {
    const response = await jsonRequest<{ session: SessionSummary }>(
      `/api/sessions/${encodeURIComponent(session.sessionKey)}/metadata`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    setSelected((current) =>
      current?.session.sessionKey === response.session.sessionKey
        ? { ...current, session: response.session }
        : current,
    );
    await refreshSidebar();
    if (debouncedQuery !== "") {
      const suffix = queryString({ q: debouncedQuery, ...filters });
      const data = await jsonRequest<{ results: SearchResult[] }>(`/api/search?${suffix}`);
      setResults(data.results);
    }
  };

  const saveTitle = async (): Promise<void> => {
    if (selected === null) return;
    await updateMetadata(selected.session, { customTitle: titleDraft.trim() || null });
    setEditingTitle(false);
  };

  const copySessionId = async (): Promise<void> => {
    if (selected === null) return;
    try {
      await copyText(selected.session.sourceSessionId, t("error.clipboardUnavailable"));
      setNotice(t("notice.sessionIdCopied"));
    } catch (caught) {
      setError(String(caught));
    }
  };

  const copyResumeCommand = async (): Promise<void> => {
    if (selected === null) return;
    const template = resumeCommandTemplates[selected.session.provider];
    if (template === undefined) return;
    const command = renderResumeCommand(template, {
      sessionId: selected.session.sourceSessionId,
      cwd: selected.session.projectPath,
    }, commandDialect);
    try {
      await copyText(command, t("error.clipboardUnavailable"));
      setNotice(t("notice.resumeCopied", { command }));
    } catch (caught) {
      setError(String(caught));
    }
  };

  const openResumeInTerminal = async (): Promise<void> => {
    if (selected === null) return;
    try {
      await jsonRequest(`/api/sessions/${encodeURIComponent(selected.session.sessionKey)}/open-terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setNotice(t("notice.terminalLaunched"));
    } catch (caught) {
      setError(String(caught));
    }
  };

  const updateTerminalDraft = (nextTerminal: TerminalId): void => {
    setTerminalDraft(nextTerminal);
    if (runtimePlatform !== "win32") return;
    if (nextTerminal === "cmd") {
      setShellPathDraft("cmd.exe");
    } else if (nextTerminal === "powershell") {
      setShellPathDraft((current) => /(^|[\\/])pwsh(?:\.exe)?$/i.test(current) ? current : "powershell.exe");
    } else if (nextTerminal === "windows-terminal" && /(^|[\\/])cmd(?:\.exe)?$/i.test(shellPathDraft)) {
      setShellPathDraft("powershell.exe");
    }
  };

  const terminalLabel = (terminal: TerminalId): string => {
    if (terminal === "windows-terminal") return "Windows Terminal";
    if (terminal === "powershell") return "PowerShell";
    if (terminal === "cmd") return t("terminal.commandPrompt");
    if (terminal === "terminal") return "Terminal";
    if (terminal === "iterm2") return "iTerm2";
    if (terminal === "warp") return "Warp";
    return t("terminal.custom");
  };

  const saveCommandSettings = async (): Promise<void> => {
    if (selected === null || resumeCommandDraft.trim() === "") return;
    const customPath = customTerminalPathDraft.trim() || null;
    const shellPath = shellPathDraft.trim();
    if ((terminalDraft === "custom" && customPath === null) || shellPath === "") return;
    try {
      const [commandResponse, terminalResponse] = await Promise.all([
        jsonRequest<{ templates: ResumeCommandTemplates }>(
          `/api/settings/resume-commands/${selected.session.provider}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template: resumeCommandDraft }),
          },
        ),
        jsonRequest<{ settings: TerminalSettings }>("/api/settings/terminal", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            terminal: terminalDraft,
            customPath: terminalDraft === "custom" ? customPath : null,
            shellPath,
          }),
        }),
      ]);
      setResumeCommandTemplates(commandResponse.templates);
      setTerminalSettings(terminalResponse.settings);
      setEditingResumeCommand(false);
      setNotice(
        t("notice.commandSettingsSaved", { provider: providerLabel(selected.session.provider) }),
      );
    } catch (caught) {
      setError(String(caught));
    }
  };

  const saveProviderSource = async (setting: ProviderSourceSetting): Promise<void> => {
    const draft = providerSourceDrafts[setting.provider];
    if (draft === undefined || draft.home.trim() === "") return;
    setSavingProviderSource(setting.provider);
    setLoading(true);
    try {
      const normalizedHome = draft.home.trim();
      const response = await jsonRequest<{ settings: ProviderSourceSetting[] }>(
        `/api/settings/providers/${setting.provider}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: draft.enabled,
            home: normalizedHome === setting.defaultHome ? null : normalizedHome,
          }),
        },
      );
      applyProviderSourceSettings(response.settings);
      if (!draft.enabled && selected?.session.provider === setting.provider) setSelected(null);
      await refreshSidebar();
      if (debouncedQuery !== "") {
        const suffix = queryString({ q: debouncedQuery, ...filters });
        const data = await jsonRequest<{ results: SearchResult[] }>(`/api/search?${suffix}`);
        setResults(data.results);
      }
      setNotice(t("notice.providerSourceSaved", { provider: providerLabel(setting.provider) }));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSavingProviderSource(null);
      setLoading(false);
    }
  };

  const saveCollection = async (): Promise<void> => {
    const name = collectionNameDraft.trim();
    if (name === "") return;
    try {
      if (collectionEditor === "create") {
        const response = await jsonRequest<{ collection: CollectionSummary }>("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        setCollectionFilter(String(response.collection.id));
      } else if (collectionEditor === "rename") {
        const id = Number.parseInt(collectionFilter, 10);
        if (!Number.isInteger(id)) return;
        await jsonRequest(`/api/collections/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
      }
      setCollectionEditor(null);
      setCollectionNameDraft("");
      await refreshSidebar();
    } catch (caught) {
      setError(String(caught));
    }
  };

  const deleteSelectedCollection = async (): Promise<void> => {
    const id = Number.parseInt(collectionFilter, 10);
    if (!Number.isInteger(id)) return;
    const collection = collections.find((item) => item.id === id);
    if (
      collection === undefined ||
      !window.confirm(t("collection.deleteConfirm", { name: collection.name }))
    ) {
      return;
    }
    try {
      await jsonRequest(`/api/collections/${id}`, { method: "DELETE" });
      setCollectionFilter("all");
      setSelected((current) =>
        current?.session.collectionId === id
          ? { ...current, session: { ...current.session, collectionId: null } }
          : current,
      );
      setCollectionEditor(null);
      await refreshSidebar();
    } catch (caught) {
      setError(String(caught));
    }
  };

  const visibleItems: Array<SessionSummary | SearchResult> =
    debouncedQuery === "" ? sessions : results;
  const visibleProjects = projects.filter((project) => provider === "all" || project.provider === provider);
  const visibleProviders = providerDescriptors.filter(
    (item) => (status?.counts[item.id] ?? 0) > 0,
  );
  const collectionNames = new Map(collections.map((collection) => [collection.id, collection.name]));
  const syncProgress = status?.sync ?? null;
  const providerFileProgress =
    syncProgress !== null && syncProgress.totalFiles > 0
      ? syncProgress.processedFiles / syncProgress.totalFiles
      : 0;
  const overallSyncProgress =
    syncProgress === null
      ? 0
      : syncProgress.completedProviders + providerFileProgress;

  const applySidebarWidth = (requestedWidth: number): number => {
    const width = clampSidebarWidth(requestedWidth, window.innerWidth);
    sidebarWidthRef.current = width;
    appShellRef.current?.style.setProperty("--sidebar-width", `${width}px`);
    return width;
  };

  const saveSidebarWidth = (width: number): void => {
    setSidebarWidth(width);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width));
    } catch {
      // Resizing remains available when storage is blocked.
    }
  };

  return (
    <div
      className="app-shell"
      ref={appShellRef}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-mark">⌕</div>
          <div>
            <h1>AI Session Search</h1>
            <p>{t("app.tagline")}</p>
          </div>
          <a
            className="github-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            title={t("github.open")}
            aria-label={t("github.open")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.27.74-1.56-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.16 1.18a10.94 10.94 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
            </svg>
          </a>
        </header>

        {syncProgress?.running === true && (
          <div className="indexing-status" role="status" aria-live="polite">
            <div className="indexing-status-copy">
              <strong>{t("indexing.title")}</strong>
              <span>
                {syncProgress.currentProvider === null
                  ? t("indexing.preparing")
                  : t("indexing.provider", {
                      provider: providerLabel(syncProgress.currentProvider),
                    })}
              </span>
            </div>
            <progress value={overallSyncProgress} max={Math.max(syncProgress.totalProviders, 1)} />
            <small>
              {t("indexing.progress", {
                completed: syncProgress.completedProviders,
                total: syncProgress.totalProviders,
              })}
              {syncProgress.totalFiles > 0
                ? ` · ${t("indexing.files", {
                    processed: syncProgress.processedFiles,
                    total: syncProgress.totalFiles,
                  })}`
                : ""}
            </small>
          </div>
        )}

        <div className="search-box">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            autoFocus
          />
          {query !== "" && <button onClick={() => setQuery("")}>×</button>}
        </div>

        <div className="filters">
          <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId | "all") }>
            <option value="all">{t("filter.allProviders")}</option>
            {visibleProviders.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <select
            className="project-filter"
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
          >
            <option value="">{t("filter.allProjects")}</option>
            {visibleProjects.map((project) => (
              <option key={`${project.provider}:${project.projectPath}`} value={project.projectPath}>
                {project.projectPath} ({project.count})
              </option>
            ))}
          </select>
          <button
            className={favoritesOnly ? "filter-button active" : "filter-button"}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            ★ {t("filter.favoritesOnly")}
          </button>
          <button
            className={renamedOnly ? "filter-button active" : "filter-button"}
            onClick={() => setRenamedOnly((value) => !value)}
          >
            ✎ {t("filter.renamedOnly")}
          </button>
          <select
            className="collection-filter"
            value={collectionFilter}
            onChange={(event) => {
              setCollectionFilter(event.target.value);
              setCollectionEditor(null);
            }}
          >
            <option value="all">{t("filter.allCollections")}</option>
            <option value="unassigned">{t("collection.unassigned")}</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name} ({collection.sessionCount})
              </option>
            ))}
          </select>
          <div className="collection-actions">
            <button
              onClick={() => {
                setCollectionNameDraft("");
                setCollectionEditor("create");
              }}
            >
              {t("collection.new")}
            </button>
            {Number.isInteger(Number.parseInt(collectionFilter, 10)) && (
              <>
                <button
                  onClick={() => {
                    const selectedCollection = collections.find(
                      (collection) => collection.id === Number.parseInt(collectionFilter, 10),
                    );
                    setCollectionNameDraft(selectedCollection?.name ?? "");
                    setCollectionEditor("rename");
                  }}
                >
                  {t("common.rename")}
                </button>
                <button className="danger" onClick={() => void deleteSelectedCollection()}>
                  {t("common.delete")}
                </button>
              </>
            )}
          </div>
          {collectionEditor !== null && (
            <div className="collection-editor">
              <input
                value={collectionNameDraft}
                onChange={(event) => setCollectionNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveCollection();
                  if (event.key === "Escape") setCollectionEditor(null);
                }}
                placeholder={
                  collectionEditor === "create"
                    ? t("collection.newPlaceholder")
                    : t("collection.namePlaceholder")
                }
                maxLength={100}
                autoFocus
              />
              <button onClick={() => void saveCollection()}>{t("common.save")}</button>
              <button onClick={() => setCollectionEditor(null)}>{t("common.cancel")}</button>
            </div>
          )}
        </div>

        <div className="result-caption">
          <span>
            {debouncedQuery === ""
              ? t("sessions.recent")
              : t("sessions.searchResults", { query: debouncedQuery })}
          </span>
          <span>{visibleItems.length}</span>
        </div>

        <div className="result-list">
          {visibleItems.map((item) => {
            const result = isSearchResult(item) ? item : null;
            return (
              <button
                className={`session-row ${selected?.session.sessionKey === item.sessionKey ? "selected" : ""}`}
                key={result === null ? item.sessionKey : `${item.sessionKey}:${result.messageIndex}`}
                onClick={() => void openSession(item.sessionKey, result?.messageIndex)}
              >
                <div className="session-row-title">
                  <span className="provider-dot" style={{ background: providerColor(item.provider) }} />
                  <strong>{item.displayTitle}</strong>
                  {item.favorite && <span className="favorite-star">★</span>}
                </div>
                {item.collectionId !== null && (
                  <span className="collection-badge">
                    ▰ {collectionNames.get(item.collectionId) ?? t("collection.fallback")}
                  </span>
                )}
                {item.customTitle !== null && (
                  <p className="original-title">
                    {t("session.original", { title: item.originalTitle })}
                  </p>
                )}
                {result !== null && <p className="snippet">{result.snippet}</p>}
                <div className="session-meta">
                  <span>{providerLabel(item.provider)}</span>
                  <time>{formatDate(item.updatedAt, locale)}</time>
                </div>
              </button>
            );
          })}
          {!loading && visibleItems.length === 0 && (
            <div className="empty-state">{t("sessions.empty")}</div>
          )}
        </div>

        <footer className="sidebar-footer">
          {status?.providers
            .filter((item) => status.counts[item.provider] > 0)
            .map((item) => (
              <span key={item.provider}>{providerLabel(item.provider)} {status.counts[item.provider]}</span>
            ))}
          <button
            onClick={() => setShowProviderSources(true)}
          >
            {t("sources.open")}
          </button>
          <button
            disabled={syncProgress?.running === true}
            onClick={() => {
              setLoading(true);
              void jsonRequest("/api/sync", { method: "POST" })
                .then(refreshSidebar)
                .finally(() => setLoading(false));
            }}
          >
            {t("sessions.rescan")}
          </button>
        </footer>
      </aside>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label={t("sidebar.resize")}
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={720}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onDoubleClick={() => saveSidebarWidth(applySidebarWidth(DEFAULT_SIDEBAR_WIDTH))}
        onPointerDown={(event) => {
          resizingSidebarRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          document.body.classList.add("resizing-sidebar");
        }}
        onPointerMove={(event) => {
          if (!resizingSidebarRef.current) return;
          applySidebarWidth(event.clientX);
        }}
        onPointerUp={(event) => {
          if (!resizingSidebarRef.current) return;
          resizingSidebarRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
          document.body.classList.remove("resizing-sidebar");
          saveSidebarWidth(sidebarWidthRef.current);
        }}
        onPointerCancel={() => {
          resizingSidebarRef.current = false;
          document.body.classList.remove("resizing-sidebar");
          saveSidebarWidth(sidebarWidthRef.current);
        }}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0;
          const requestedWidth =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? Number.MAX_SAFE_INTEGER
                : sidebarWidthRef.current + delta;
          if (delta === 0 && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          saveSidebarWidth(applySidebarWidth(requestedWidth));
        }}
      />

      <main className="conversation-pane">
        {selected === null ? (
          <div className="welcome">
            <div className="welcome-icon">⌕</div>
            <h2>{t("welcome.title")}</h2>
            <p>{t("welcome.description")}</p>
            <div className="provider-status">
              {status?.providers.filter((item) => status.counts[item.provider] > 0).map((item) => (
                <div key={item.provider}>
                  <span className={`status-light ${item.detected ? "detected" : ""}`} />
                  <strong>{providerLabel(item.provider)}</strong>
                  <code>{item.home}</code>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <header className="conversation-header">
              <div className="header-title">
                <span className="provider-pill" style={{ background: providerColor(selected.session.provider) }}>
                  {providerLabel(selected.session.provider)}
                </span>
                {editingTitle ? (
                  <div className="rename-form">
                    <input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveTitle();
                        if (event.key === "Escape") setEditingTitle(false);
                      }}
                      maxLength={200}
                      autoFocus
                    />
                    <button onClick={() => void saveTitle()}>{t("common.save")}</button>
                    <button onClick={() => setEditingTitle(false)}>{t("common.cancel")}</button>
                  </div>
                ) : (
                  <h2>{selected.session.displayTitle}</h2>
                )}
                {selected.session.customTitle !== null && !editingTitle && (
                  <p>{t("session.originalTitle", { title: selected.session.originalTitle })}</p>
                )}
              </div>
              <div className="header-actions">
                <button title={t("session.copyId")} onClick={() => void copySessionId()}>
                  {t("session.copyId")}
                </button>
                {resumeCommandTemplates[selected.session.provider] !== undefined && (
                  <>
                    <button title={t("session.copyResume")} onClick={() => void copyResumeCommand()}>
                      {t("session.copyResume")}
                    </button>
                    {terminalSupported && (
                      <button title={t("session.openTerminal")} onClick={() => void openResumeInTerminal()}>
                        {t("session.openTerminal")}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setResumeCommandDraft(resumeCommandTemplates[selected.session.provider] ?? "");
                        setTerminalDraft(terminalSettings.terminal);
                        setCustomTerminalPathDraft(terminalSettings.customPath ?? "");
                        setShellPathDraft(terminalSettings.shellPath);
                        setEditingResumeCommand((value) => !value);
                      }}
                    >
                      {t("resume.settings")}
                    </button>
                  </>
                )}
                <button
                  title={
                    selected.session.favorite ? t("favorite.remove") : t("favorite.add")
                  }
                  className={selected.session.favorite ? "star-button active" : "star-button"}
                  onClick={() => void updateMetadata(selected.session, { favorite: !selected.session.favorite })}
                >
                  ★
                </button>
                <button
                  onClick={() => {
                    setTitleDraft(selected.session.customTitle ?? selected.session.originalTitle);
                    setEditingTitle(true);
                  }}
                >
                  {t("common.rename")}
                </button>
              </div>
              <div className="conversation-info">
                <code>{selected.session.projectPath ?? t("session.unknownProject")}</code>
                <span>{t("session.messageCount", { count: selected.session.messageCount })}</span>
                <time>{formatDate(selected.session.updatedAt, locale)}</time>
                <label className="collection-assignment">
                  {t("collection.label")}
                  <select
                    value={selected.session.collectionId ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      void updateMetadata(selected.session, {
                        collectionId: value === "" ? null : Number.parseInt(value, 10),
                      });
                    }}
                  >
                    <option value="">{t("collection.unassigned")}</option>
                    {collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {editingResumeCommand && (
                <div className="resume-command-editor">
                  <label htmlFor="resume-command-template">
                    {t("resume.template", {
                      provider: providerLabel(selected.session.provider),
                    })}
                  </label>
                  <div className="resume-command-form">
                    <input
                      id="resume-command-template"
                      value={resumeCommandDraft}
                      onChange={(event) => setResumeCommandDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveCommandSettings();
                        if (event.key === "Escape") setEditingResumeCommand(false);
                      }}
                      maxLength={500}
                      autoFocus
                    />
                    <button onClick={() => void saveCommandSettings()}>{t("common.save")}</button>
                    <button
                      onClick={() =>
                        setResumeCommandDraft(DEFAULT_RESUME_COMMAND_TEMPLATES[selected.session.provider] ?? "")
                      }
                    >
                      {t("resume.restoreDefault")}
                    </button>
                    <button onClick={() => setEditingResumeCommand(false)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                  <p>
                    {t("resume.templateHelp", {
                      cwd: "{cwd}",
                      sessionId: "{sessionId}",
                    })}
                  </p>
                  {resumeCommandDraft.trim() !== "" && (
                    <code className="command-preview">
                      {renderResumeCommand(resumeCommandDraft, {
                        sessionId: selected.session.sourceSessionId,
                        cwd: selected.session.projectPath,
                      }, commandDialect)}
                    </code>
                  )}
                  {terminalSupported && (
                    <>
                      <div className="terminal-settings">
                        <label htmlFor="terminal-kind">{t("terminal.type")}</label>
                        <select
                          id="terminal-kind"
                          value={terminalDraft}
                          onChange={(event) => updateTerminalDraft(event.target.value as TerminalId)}
                        >
                          {availableTerminalIds.map((terminal) => (
                            <option key={terminal} value={terminal}>{terminalLabel(terminal)}</option>
                          ))}
                        </select>
                        {terminalDraft === "custom" && (
                          <input
                            value={customTerminalPathDraft}
                            onChange={(event) => setCustomTerminalPathDraft(event.target.value)}
                            placeholder={runtimePlatform === "win32" ? "C:\\Program Files\\WezTerm\\wezterm-gui.exe" : "/Applications/Ghostty.app"}
                            maxLength={1000}
                          />
                        )}
                      </div>
                      <div className="terminal-settings shell-settings">
                        <label htmlFor="terminal-shell-path">
                          {runtimePlatform === "win32" ? t("terminal.shellExecutable") : t("terminal.shellPath")}
                        </label>
                        <input
                          id="terminal-shell-path"
                          value={shellPathDraft}
                          onChange={(event) => setShellPathDraft(event.target.value)}
                          placeholder={runtimePlatform === "win32" ? "powershell.exe" : "/bin/zsh"}
                          maxLength={1000}
                        />
                      </div>
                      <p>{runtimePlatform === "win32" ? t("terminal.windowsPathHelp") : t("terminal.pathHelp")}</p>
                      <p>{runtimePlatform === "win32" ? t("terminal.windowsShellHelp") : t("terminal.shellPathHelp")}</p>
                    </>
                  )}
                </div>
              )}
            </header>

            <div className="messages">
              {selected.messages.map((message) => (
                <article
                  key={message.index}
                  ref={(element) => {
                    if (element === null) messageRefs.current.delete(message.index);
                    else messageRefs.current.set(message.index, element);
                  }}
                  className={`message ${message.role} ${selectedMessageIndex === message.index ? "matched" : ""}`}
                >
                  <div className="message-label">
                    <strong>
                      {message.role === "user"
                        ? t("message.you")
                        : providerLabel(selected.session.provider)}
                    </strong>
                    {message.phase !== undefined && (
                      <span>
                        {message.phase === "commentary"
                          ? t("message.phase.commentary")
                          : t("message.phase.finalAnswer")}
                      </span>
                    )}
                    <time>{formatDate(message.timestamp, locale)}</time>
                  </div>
                  <pre>{message.content}</pre>
                </article>
              ))}
            </div>
          </>
        )}
      </main>

      {showProviderSources && (
        <div className="modal-backdrop" onMouseDown={() => setShowProviderSources(false)}>
          <section
            className="source-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="source-settings-title">{t("sources.title")}</h2>
                <p>{t("sources.description")}</p>
              </div>
              <button
                className="dialog-close"
                onClick={() => setShowProviderSources(false)}
                aria-label={t("common.close")}
              >
                ×
              </button>
            </header>
            <div className="source-settings-list">
              {providerSourceSettings.map((setting) => {
                const draft = providerSourceDrafts[setting.provider] ?? {
                  enabled: setting.enabled,
                  home: setting.home,
                };
                const saving = savingProviderSource === setting.provider;
                const changed = draft.enabled !== setting.enabled || draft.home.trim() !== setting.home;
                return (
                  <article className="source-setting" key={setting.provider}>
                    <div className="source-setting-heading">
                      <span className="provider-dot" style={{ background: providerColor(setting.provider) }} />
                      <strong>{providerLabel(setting.provider)}</strong>
                      <code>{setting.provider}</code>
                      <label className="source-enabled">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(event) => setProviderSourceDrafts((current) => ({
                            ...current,
                            [setting.provider]: { ...draft, enabled: event.target.checked },
                          }))}
                        />
                        {t("sources.enabled")}
                      </label>
                    </div>
                    <div className="source-path-row">
                      <input
                        value={draft.home}
                        onChange={(event) => setProviderSourceDrafts((current) => ({
                          ...current,
                          [setting.provider]: { ...draft, home: event.target.value },
                        }))}
                        placeholder={setting.defaultHome}
                        spellCheck={false}
                      />
                      <button
                        onClick={() => setProviderSourceDrafts((current) => ({
                          ...current,
                          [setting.provider]: { ...draft, home: setting.defaultHome },
                        }))}
                        disabled={draft.home === setting.defaultHome}
                      >
                        {t("sources.restoreDefault")}
                      </button>
                      <button
                        className="primary"
                        onClick={() => void saveProviderSource(setting)}
                        disabled={!changed || draft.home.trim() === "" || saving}
                      >
                        {saving ? t("sources.saving") : t("common.save")}
                      </button>
                    </div>
                    <div className="source-setting-meta">
                      <span className={setting.detected ? "detected" : "missing"}>
                        {setting.detected ? t("sources.detected") : t("sources.notDetected")}
                      </span>
                      <span>{t("sources.sessionCount", { count: setting.sessionCount })}</span>
                      {setting.customized && <span>{t("sources.customized")}</span>}
                      <code title={setting.defaultHome}>
                        {t("sources.defaultPath", { path: setting.defaultHome })}
                      </code>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {loading && <div className="loading-bar" />}
      {error !== null && (
        <button className="error-toast" onClick={() => setError(null)}>
          {error}
        </button>
      )}
      {notice !== null && (
        <button className="notice-toast" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}
    </div>
  );
};
