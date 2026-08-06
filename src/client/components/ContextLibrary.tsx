import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CollectionSummary,
  ContextSnippetDetail,
  ContextSnippetSort,
  ContextSnippetSummary,
} from "../../shared/types.ts";
import { jsonRequest, queryString } from "../api.ts";
import { copyText } from "../clipboard.ts";
import type { Translator } from "../i18n/index.ts";
import { isEditableShortcutTarget } from "../keyboardShortcuts.ts";
import { useAppKeyboardShortcuts } from "../useAppKeyboardShortcuts.ts";
import { AppViewTabs } from "./AppViewTabs.tsx";
import { HighlightedText } from "./HighlightedText.tsx";
import { SearchBox } from "./SearchBox.tsx";
import { SelectControl } from "./SelectControl.tsx";
import { UpdateNotification } from "./UpdateNotification.tsx";

type EditorMode = "create" | "edit" | null;
type CollectionEditorMode = "create" | "rename" | null;

const formatTimestamp = (value: number | null, locale: string): string =>
  value === null ? "" : new Date(value).toLocaleString(locale);

export const ContextLibrary = ({
  t,
  locale,
  searchShortcutLabel,
  sidebarResizer,
  onShowSessions,
}: {
  t: Translator;
  locale: string;
  searchShortcutLabel: string;
  sidebarResizer: ReactNode;
  onShowSessions: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<ContextSnippetSort>("smart");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [snippets, setSnippets] = useState<ContextSnippetSummary[]>([]);
  const [selected, setSelected] = useState<ContextSnippetDetail | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [collectionDraft, setCollectionDraft] = useState<number | null>(null);
  const [favoriteDraft, setFavoriteDraft] = useState(false);
  const [collectionEditor, setCollectionEditor] = useState<CollectionEditorMode>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filters = useMemo(() => ({
    q: debouncedQuery || undefined,
    favorites: favoritesOnly,
    collection: collectionFilter === "all" ? undefined : collectionFilter,
    sort,
  }), [collectionFilter, debouncedQuery, favoritesOnly, sort]);

  const refresh = useCallback(async (): Promise<void> => {
    const [snippetData, collectionData] = await Promise.all([
      jsonRequest<{ snippets: ContextSnippetSummary[] }>(`/api/context-snippets?${queryString(filters)}`),
      jsonRequest<{ collections: CollectionSummary[] }>("/api/collections"),
    ]);
    setSnippets(snippetData.snippets);
    setCollections(collectionData.collections);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((caught: unknown) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, [refresh]);

  const cancelEditor = useCallback((): void => {
    setEditorMode(null);
    setTitleDraft("");
    setContentDraft("");
  }, []);

  const dismissActiveSurface = useCallback((): boolean => {
    if (editorMode !== null) cancelEditor();
    else if (collectionEditor !== null) setCollectionEditor(null);
    else if (error !== null) setError(null);
    else if (notice !== null) setNotice(null);
    else if (query !== "") setQuery("");
    else if (document.activeElement === searchInputRef.current) searchInputRef.current?.blur();
    else return false;
    return true;
  }, [cancelEditor, collectionEditor, editorMode, error, notice, query]);

  useAppKeyboardShortcuts({
    searchInputRef,
    surfaceOpen: editorMode !== null || collectionEditor !== null,
    dismissActiveSurface,
  });

  const startCreate = useCallback((): void => {
    setTitleDraft("");
    setContentDraft("");
    setCollectionDraft(
      Number.isInteger(Number.parseInt(collectionFilter, 10))
        ? Number.parseInt(collectionFilter, 10)
        : null,
    );
    setFavoriteDraft(false);
    setEditorMode("create");
  }, [collectionFilter]);

  const startEdit = useCallback((): void => {
    if (selected === null) return;
    setTitleDraft(selected.title);
    setContentDraft(selected.content);
    setCollectionDraft(selected.collectionId);
    setFavoriteDraft(selected.favorite);
    setEditorMode("edit");
  }, [selected]);

  const saveSnippet = useCallback(async (): Promise<void> => {
    if (titleDraft.trim() === "" || contentDraft.trim() === "") return;
    setLoading(true);
    try {
      const response = await jsonRequest<{ snippet: ContextSnippetDetail }>(
        editorMode === "create"
          ? "/api/context-snippets"
          : `/api/context-snippets/${selected?.id ?? 0}`,
        {
          method: editorMode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleDraft,
            content: contentDraft,
            favorite: favoriteDraft,
            collectionId: collectionDraft,
          }),
        },
      );
      setSelected(response.snippet);
      cancelEditor();
      await refresh();
      setNotice(t("context.saved"));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [cancelEditor, collectionDraft, contentDraft, editorMode, favoriteDraft, refresh, selected?.id, t, titleDraft]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!document.hasFocus()) return;
      const primary = event.metaKey || event.ctrlKey;
      if (!primary || event.altKey || event.shiftKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "n" && editorMode === null && !isEditableShortcutTarget(event.target)) {
        event.preventDefault();
        startCreate();
      } else if (key === "s" && editorMode !== null) {
        event.preventDefault();
        void saveSnippet();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [editorMode, saveSnippet, startCreate]);

  const openSnippet = async (id: number): Promise<void> => {
    setLoading(true);
    try {
      const response = await jsonRequest<{ snippet: ContextSnippetDetail }>(`/api/context-snippets/${id}`);
      setSelected(response.snippet);
      cancelEditor();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  };

  const updateSnippet = async (
    id: number,
    patch: { favorite?: boolean; collectionId?: number | null },
  ): Promise<void> => {
    try {
      const response = await jsonRequest<{ snippet: ContextSnippetDetail }>(
        `/api/context-snippets/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      setSelected((current) => current?.id === id ? response.snippet : current);
      await refresh();
    } catch (caught) {
      setError(String(caught));
    }
  };

  const copySnippet = async (snippet: ContextSnippetDetail): Promise<void> => {
    try {
      await copyText(snippet.content, t("error.clipboardUnavailable"));
      setNotice(t("context.copied"));
      const response = await jsonRequest<{ snippet: ContextSnippetDetail }>(
        `/api/context-snippets/${snippet.id}/copied`,
        { method: "POST" },
      );
      setSelected((current) => current?.id === snippet.id ? response.snippet : current);
      await refresh();
    } catch (caught) {
      setError(String(caught));
    }
  };

  const copySummary = async (summary: ContextSnippetSummary): Promise<void> => {
    try {
      const response = await jsonRequest<{ snippet: ContextSnippetDetail }>(
        `/api/context-snippets/${summary.id}`,
      );
      await copySnippet(response.snippet);
    } catch (caught) {
      setError(String(caught));
    }
  };

  useEffect(() => {
    const handleCopyShortcut = (event: KeyboardEvent): void => {
      if (
        !document.hasFocus() ||
        selected === null ||
        editorMode !== null ||
        isEditableShortcutTarget(event.target)
      ) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        void copySnippet(selected);
      }
    };
    window.addEventListener("keydown", handleCopyShortcut);
    return () => window.removeEventListener("keydown", handleCopyShortcut);
  }, [editorMode, selected]);

  const deleteSnippet = async (): Promise<void> => {
    if (selected === null || !window.confirm(t("context.deleteConfirm", { title: selected.title }))) return;
    try {
      await jsonRequest(`/api/context-snippets/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      cancelEditor();
      await refresh();
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
      await refresh();
    } catch (caught) {
      setError(String(caught));
    }
  };

  const deleteCollection = async (): Promise<void> => {
    const id = Number.parseInt(collectionFilter, 10);
    const collection = collections.find((item) => item.id === id);
    if (collection === undefined || !window.confirm(t("collection.deleteConfirm", { name: collection.name }))) return;
    try {
      await jsonRequest(`/api/collections/${id}`, { method: "DELETE" });
      setCollectionFilter("all");
      setSelected((current) => current?.collectionId === id ? { ...current, collectionId: null } : current);
      setCollectionEditor(null);
      await refresh();
    } catch (caught) {
      setError(String(caught));
    }
  };

  const collectionNames = new Map(collections.map((collection) => [collection.id, collection.name]));
  const selectedCollection = collections.find(
    (collection) => collection.id === Number.parseInt(collectionFilter, 10),
  );

  return (
    <>
      <aside className="sidebar context-sidebar">
        <header className="brand">
          <div className="brand-mark">⌕</div>
          <div>
            <h1>AI Session Search</h1>
            <p>{t("context.tagline")}</p>
          </div>
          <UpdateNotification t={t} />
        </header>

        <AppViewTabs active="contexts" t={t} onChange={(view) => view === "sessions" && onShowSessions()} />

        <SearchBox
          inputRef={searchInputRef}
          query={query}
          shortcutLabel={searchShortcutLabel}
          t={t}
          placeholder={t("context.searchPlaceholder")}
          onQueryChange={setQuery}
        />

        <div className="filters context-filters">
          <button
            className={favoritesOnly ? "filter-button active" : "filter-button"}
            aria-pressed={favoritesOnly}
            title={t("filter.favoritesOnly")}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            ★ {t("filter.favoritesOnly")}
          </button>
          <SelectControl
            value={sort}
            ariaLabel={t("context.sort.label")}
            options={[
              { value: "smart", label: t("context.sort.smart") },
              { value: "created-desc", label: t("context.sort.created") },
              { value: "updated-desc", label: t("context.sort.updated") },
              { value: "last-copied-desc", label: t("context.sort.lastCopied") },
              { value: "copies-desc", label: t("context.sort.copies") },
            ]}
            onChange={setSort}
          />
          <SelectControl
            className="collection-filter"
            value={collectionFilter}
            ariaLabel={t("filter.allCollections")}
            options={[
              { value: "all", label: t("filter.allCollections") },
              { value: "unassigned", label: t("collection.unassigned") },
              ...collections.map((collection) => ({
                value: String(collection.id),
                label: `${collection.name} (${collection.contextCount})`,
              })),
            ]}
            onChange={(value) => {
              setCollectionFilter(value);
              setCollectionEditor(null);
            }}
          />
          <div className="collection-actions">
            <button onClick={startCreate}>{t("context.new")}</button>
            <button onClick={() => {
              setCollectionNameDraft("");
              setCollectionEditor("create");
            }}>{t("collection.new")}</button>
          </div>
          {selectedCollection !== undefined && (
            <div className="collection-actions">
              <button onClick={() => {
                setCollectionNameDraft(selectedCollection.name);
                setCollectionEditor("rename");
              }}>{t("common.rename")}</button>
              <button className="danger" onClick={() => void deleteCollection()}>{t("common.delete")}</button>
            </div>
          )}
          {collectionEditor !== null && (
            <div className="collection-editor">
              <input
                value={collectionNameDraft}
                onChange={(event) => setCollectionNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveCollection();
                  if (event.key === "Escape") setCollectionEditor(null);
                }}
                placeholder={t("collection.namePlaceholder")}
                maxLength={100}
                autoFocus
              />
              <button onClick={() => void saveCollection()}>{t("common.save")}</button>
              <button onClick={() => setCollectionEditor(null)}>{t("common.cancel")}</button>
            </div>
          )}
        </div>

        <div className="result-caption">
          <span>{debouncedQuery === "" ? t("context.library") : t("sessions.searchResults", { query: debouncedQuery })}</span>
          <span>{snippets.length}</span>
        </div>

        <div className="result-list context-list">
          {snippets.map((snippet) => (
            <div className={`context-row ${selected?.id === snippet.id ? "selected" : ""}`} key={snippet.id}>
              <button className="context-row-main" onClick={() => void openSnippet(snippet.id)}>
                <div className="session-row-title">
                  <span className="context-dot" />
                  <strong><HighlightedText text={snippet.title} query={debouncedQuery} /></strong>
                  {snippet.favorite && <span className="favorite-star">★</span>}
                </div>
                {snippet.collectionId !== null && (
                  <span className="collection-badge">▰ {collectionNames.get(snippet.collectionId) ?? t("collection.fallback")}</span>
                )}
                <p className="snippet"><HighlightedText text={snippet.preview} query={debouncedQuery} /></p>
                <div className="session-meta">
                  <span>{t("context.copyCount", { count: snippet.copyCount })}</span>
                  <time>{formatTimestamp(snippet.updatedAt, locale)}</time>
                </div>
              </button>
              <button
                className="context-row-copy"
                title={t("context.copy")}
                aria-label={t("context.copy")}
                onClick={() => void copySummary(snippet)}
              >
                ⧉
              </button>
            </div>
          ))}
          {!loading && snippets.length === 0 && <div className="empty-state">{t("context.empty")}</div>}
        </div>

        <footer className="sidebar-footer context-footer">
          <span>{t("context.total", { count: snippets.length })}</span>
          <button onClick={startCreate}>{t("context.newShortcut")}</button>
        </footer>
      </aside>

      {sidebarResizer}

      <main className="conversation-pane context-pane">
        {editorMode !== null ? (
          <>
            <header className="conversation-header context-header">
              <div className="header-title">
                <span className="provider-pill context-pill">{t("view.contexts")}</span>
                <h2>{editorMode === "create" ? t("context.newTitle") : t("context.editTitle")}</h2>
              </div>
              <div className="header-actions">
                <button onClick={() => void saveSnippet()}>{t("common.save")}</button>
                <button onClick={cancelEditor}>{t("common.cancel")}</button>
              </div>
              <div className="context-editor-meta">
                <label>
                  {t("context.title")}
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    maxLength={200}
                    autoFocus
                  />
                </label>
                <div className="context-editor-field">
                  <span>{t("collection.label")}</span>
                  <SelectControl
                    value={collectionDraft === null ? "" : String(collectionDraft)}
                    ariaLabel={t("collection.label")}
                    options={[
                      { value: "", label: t("collection.unassigned") },
                      ...collections.map((collection) => ({
                        value: String(collection.id),
                        label: collection.name,
                      })),
                    ]}
                    onChange={(value) => setCollectionDraft(value === "" ? null : Number.parseInt(value, 10))}
                  />
                </div>
                <label className="context-favorite-field">
                  <input
                    type="checkbox"
                    checked={favoriteDraft}
                    onChange={(event) => setFavoriteDraft(event.target.checked)}
                  />
                  {t("favorite.add")}
                </label>
              </div>
            </header>
            <div className="context-editor-body">
              <textarea
                value={contentDraft}
                onChange={(event) => setContentDraft(event.target.value)}
                placeholder={t("context.contentPlaceholder")}
                spellCheck={false}
              />
              <div className="context-editor-hint">{t("context.saveShortcut")}</div>
            </div>
          </>
        ) : selected === null ? (
          <div className="welcome context-welcome">
            <div className="welcome-icon">▤</div>
            <h2>{t("context.welcomeTitle")}</h2>
            <p>{t("context.welcomeDescription")}</p>
            <button className="primary-action" onClick={startCreate}>{t("context.new")}</button>
          </div>
        ) : (
          <>
            <header className="conversation-header context-header">
              <div className="header-title">
                <span className="provider-pill context-pill">{t("view.contexts")}</span>
                <h2><HighlightedText text={selected.title} query={debouncedQuery} /></h2>
              </div>
              <div className="header-actions">
                <button className="primary-copy" onClick={() => void copySnippet(selected)}>{t("context.copy")}</button>
                <button
                  className={selected.favorite ? "star-button active" : "star-button"}
                  title={selected.favorite ? t("favorite.remove") : t("favorite.add")}
                  aria-label={selected.favorite ? t("favorite.remove") : t("favorite.add")}
                  onClick={() => void updateSnippet(selected.id, { favorite: !selected.favorite })}
                >★</button>
                <button onClick={startEdit}>{t("context.edit")}</button>
                <button className="danger-button" onClick={() => void deleteSnippet()}>{t("common.delete")}</button>
              </div>
              <div className="conversation-info">
                <span>{t("context.copyCount", { count: selected.copyCount })}</span>
                <span>{t("context.createdAt", { date: formatTimestamp(selected.createdAt, locale) })}</span>
                <span>{t("context.updatedAt", { date: formatTimestamp(selected.updatedAt, locale) })}</span>
                <div className="collection-assignment">
                  <span>{t("collection.label")}</span>
                  <SelectControl
                    value={selected.collectionId === null ? "" : String(selected.collectionId)}
                    ariaLabel={t("collection.label")}
                    options={[
                      { value: "", label: t("collection.unassigned") },
                      ...collections.map((collection) => ({
                        value: String(collection.id),
                        label: collection.name,
                      })),
                    ]}
                    onChange={(value) => void updateSnippet(selected.id, {
                      collectionId: value === "" ? null : Number.parseInt(value, 10),
                    })}
                  />
                </div>
              </div>
            </header>
            <div className="context-content">
              <pre><HighlightedText text={selected.content} query={debouncedQuery} /></pre>
            </div>
          </>
        )}
      </main>

      {loading && <div className="loading-bar" />}
      {error !== null && <button className="error-toast" onClick={() => setError(null)}>{error}</button>}
      {notice !== null && <button className="notice-toast" onClick={() => setNotice(null)}>{notice}</button>}
    </>
  );
};
