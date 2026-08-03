import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CollectionSummary,
  NormalizedMessage,
  ProviderId,
  ProviderStatus,
  ResumeCommandTemplates,
  SearchResult,
  SessionSummary,
} from "../shared/types.ts";
import {
  DEFAULT_RESUME_COMMAND_TEMPLATES,
  renderResumeCommand,
} from "../shared/resumeCommand.ts";

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

const providerLabel = (provider: ProviderId): string =>
  provider === "claude" ? "Claude Code" : "Codex";

const isSearchResult = (item: SessionSummary | SearchResult): item is SearchResult =>
  "messageIndex" in item;

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
};

export const App = () => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [provider, setProvider] = useState<ProviderId | "all">("all");
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
    jsonRequest<{ templates: ResumeCommandTemplates }>("/api/settings/resume-commands")
      .then((data) => setResumeCommandTemplates(data.templates))
      .catch((caught: unknown) => setError(String(caught)));
  }, []);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
      await copyText(selected.session.sourceSessionId);
      setNotice("Session ID 已复制");
    } catch (caught) {
      setError(String(caught));
    }
  };

  const copyResumeCommand = async (): Promise<void> => {
    if (selected === null) return;
    const command = renderResumeCommand(resumeCommandTemplates[selected.session.provider], {
      sessionId: selected.session.sourceSessionId,
      cwd: selected.session.projectPath,
    });
    try {
      await copyText(command);
      setNotice(`恢复命令已复制：${command}`);
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
      setNotice(`${providerLabel(selected.session.provider)} 恢复命令设置已保存`);
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
    if (collection === undefined || !window.confirm(`删除收藏夹“${collection.name}”？会话将变为未分类。`)) {
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
  const collectionNames = new Map(collections.map((collection) => [collection.id, collection.name]));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-mark">⌕</div>
          <div>
            <h1>AI Session Search</h1>
            <p>本地、只读、全文检索</p>
          </div>
        </header>

        <div className="search-box">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话内容或自定义名称…"
            autoFocus
          />
          {query !== "" && <button onClick={() => setQuery("")}>×</button>}
        </div>

        <div className="filters">
          <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId | "all") }>
            <option value="all">全部来源</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <select
            className="project-filter"
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
          >
            <option value="">全部项目</option>
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
            ★ 仅收藏
          </button>
          <button
            className={renamedOnly ? "filter-button active" : "filter-button"}
            onClick={() => setRenamedOnly((value) => !value)}
          >
            ✎ 已重命名
          </button>
          <select
            className="collection-filter"
            value={collectionFilter}
            onChange={(event) => {
              setCollectionFilter(event.target.value);
              setCollectionEditor(null);
            }}
          >
            <option value="all">全部收藏夹</option>
            <option value="unassigned">未分类</option>
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
              ＋新建收藏夹
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
                  重命名
                </button>
                <button className="danger" onClick={() => void deleteSelectedCollection()}>
                  删除
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
                placeholder={collectionEditor === "create" ? "新收藏夹名称" : "收藏夹名称"}
                maxLength={100}
                autoFocus
              />
              <button onClick={() => void saveCollection()}>保存</button>
              <button onClick={() => setCollectionEditor(null)}>取消</button>
            </div>
          )}
        </div>

        <div className="result-caption">
          <span>{debouncedQuery === "" ? "最近会话" : `“${debouncedQuery}” 的结果`}</span>
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
                  <span className={`provider-dot ${item.provider}`} />
                  <strong>{item.displayTitle}</strong>
                  {item.favorite && <span className="favorite-star">★</span>}
                </div>
                {item.collectionId !== null && (
                  <span className="collection-badge">▰ {collectionNames.get(item.collectionId) ?? "收藏夹"}</span>
                )}
                {item.customTitle !== null && <p className="original-title">原始：{item.originalTitle}</p>}
                {result !== null && <p className="snippet">{result.snippet}</p>}
                <div className="session-meta">
                  <span>{providerLabel(item.provider)}</span>
                  <time>{formatDate(item.updatedAt)}</time>
                </div>
              </button>
            );
          })}
          {!loading && visibleItems.length === 0 && (
            <div className="empty-state">没有找到匹配的会话</div>
          )}
        </div>

        <footer className="sidebar-footer">
          <span>Claude {status?.counts.claude ?? 0}</span>
          <span>Codex {status?.counts.codex ?? 0}</span>
          <button
            onClick={() => {
              setLoading(true);
              void jsonRequest("/api/sync", { method: "POST" })
                .then(refreshSidebar)
                .finally(() => setLoading(false));
            }}
          >
            重新扫描
          </button>
        </footer>
      </aside>

      <main className="conversation-pane">
        {selected === null ? (
          <div className="welcome">
            <div className="welcome-icon">⌕</div>
            <h2>搜索你的本地 AI 编程会话</h2>
            <p>自动发现 Claude Code 与 Codex 会话。所有索引和收藏信息仅保存在本机。</p>
            <div className="provider-status">
              {status?.providers.map((item) => (
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
                <span className={`provider-pill ${selected.session.provider}`}>
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
                    <button onClick={() => void saveTitle()}>保存</button>
                    <button onClick={() => setEditingTitle(false)}>取消</button>
                  </div>
                ) : (
                  <h2>{selected.session.displayTitle}</h2>
                )}
                {selected.session.customTitle !== null && !editingTitle && (
                  <p>原始标题：{selected.session.originalTitle}</p>
                )}
              </div>
              <div className="header-actions">
                <button title="Copy Session ID" onClick={() => void copySessionId()}>
                  复制 Session ID
                </button>
                <button title="Copy Resume Command" onClick={() => void copyResumeCommand()}>
                  复制恢复命令
                </button>
                <button
                  onClick={() => {
                    setResumeCommandDraft(
                      resumeCommandTemplates[selected.session.provider],
                    );
                    setEditingResumeCommand((value) => !value);
                  }}
                >
                  命令设置
                </button>
                <button
                  title={selected.session.favorite ? "取消收藏" : "收藏"}
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
                  重命名
                </button>
              </div>
              <div className="conversation-info">
                <code>{selected.session.projectPath ?? "未知项目"}</code>
                <span>{selected.session.messageCount} 条消息</span>
                <time>{formatDate(selected.session.updatedAt)}</time>
                <label className="collection-assignment">
                  收藏夹
                  <select
                    value={selected.session.collectionId ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      void updateMetadata(selected.session, {
                        collectionId: value === "" ? null : Number.parseInt(value, 10),
                      });
                    }}
                  >
                    <option value="">未分类</option>
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
                    {providerLabel(selected.session.provider)} 恢复命令模板
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
                    <button onClick={() => void saveResumeCommand()}>保存</button>
                    <button
                      onClick={() =>
                        setResumeCommandDraft(
                          DEFAULT_RESUME_COMMAND_TEMPLATES[selected.session.provider],
                        )
                      }
                    >
                      恢复默认
                    </button>
                    <button onClick={() => setEditingResumeCommand(false)}>取消</button>
                  </div>
                  <p>
                    支持 <code>{"{cwd}"}</code> 和 <code>{"{sessionId}"}</code>；只输入
                    <code> yolo</code> 也可以，会自动追加 Session ID。
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
                    <strong>{message.role === "user" ? "你" : selected.session.provider === "codex" ? "Codex" : "Claude"}</strong>
                    {message.phase !== undefined && <span>{message.phase}</span>}
                    <time>{formatDate(message.timestamp)}</time>
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
