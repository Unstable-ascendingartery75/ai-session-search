import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CollectionSummary,
  NormalizedMessage,
  ProviderDescriptor,
  ProviderId,
  ProviderStatus,
  ResumeCommandTemplates,
  SearchResult,
  SessionSummary,
} from "../shared/types.ts";
import { PROVIDER_DESCRIPTORS, providerDescriptor } from "../shared/providers.ts";
import {
  DEFAULT_RESUME_COMMAND_TEMPLATES,
  renderResumeCommand,
} from "../shared/resumeCommand.ts";
import type { Translator } from "./i18n/index.ts";

type Project = { provider: ProviderId; projectPath: string; count: number };
type SessionDetail = { session: SessionSummary; messages: NormalizedMessage[] };

const jsonRequest = async <T,>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
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
  const [status, setStatus] = useState<{ providers: ProviderStatus[]; counts: Record<ProviderId, number> } | null>(null);
  const [selected, setSelected] = useState<SessionDetail | null>(null);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [resumeCommandTemplates, setResumeCommandTemplates] =
    useState<ResumeCommandTemplates>(DEFAULT_RESUME_COMMAND_TEMPLATES);
  const [editingResumeCommand, setEditingResumeCommand] = useState(false);
  const [resumeCommandDraft, setResumeCommandDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messageRefs = useRef(new Map<number, HTMLElement>());

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

  const refreshSidebar = async (): Promise<void> => {
    const suffix = queryString(filters);
    const [sessionData, projectData, statusData, collectionData] = await Promise.all([
      jsonRequest<{ sessions: SessionSummary[] }>(`/api/sessions?${suffix}`),
      jsonRequest<{ projects: Project[] }>("/api/projects"),
      jsonRequest<{ providers: ProviderStatus[]; counts: Record<ProviderId, number> }>("/api/status"),
      jsonRequest<{ collections: CollectionSummary[] }>("/api/collections"),
    ]);
    setSessions(sessionData.sessions);
    setProjects(projectData.projects);
    setStatus(statusData);
    setCollections(collectionData.collections);
  };

  useEffect(() => {
    setLoading(true);
    refreshSidebar()
      .catch((caught: unknown) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, [filters]);

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
    });
    try {
      await copyText(command, t("error.clipboardUnavailable"));
      setNotice(t("notice.resumeCopied", { command }));
    } catch (caught) {
      setError(String(caught));
    }
  };

  const saveResumeCommand = async (): Promise<void> => {
    if (selected === null || resumeCommandDraft.trim() === "") return;
    try {
      const response = await jsonRequest<{ templates: ResumeCommandTemplates }>(
        `/api/settings/resume-commands/${selected.session.provider}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: resumeCommandDraft }),
        },
      );
      setResumeCommandTemplates(response.templates);
      setEditingResumeCommand(false);
      setNotice(
        t("notice.resumeSaved", { provider: providerLabel(selected.session.provider) }),
      );
    } catch (caught) {
      setError(String(caught));
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-mark">⌕</div>
          <div>
            <h1>AI Session Search</h1>
            <p>{t("app.tagline")}</p>
          </div>
        </header>

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
                    <button
                      onClick={() => {
                        setResumeCommandDraft(resumeCommandTemplates[selected.session.provider] ?? "");
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
                        if (event.key === "Enter") void saveResumeCommand();
                        if (event.key === "Escape") setEditingResumeCommand(false);
                      }}
                      maxLength={500}
                      autoFocus
                    />
                    <button onClick={() => void saveResumeCommand()}>{t("common.save")}</button>
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
                      })}
                    </code>
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
