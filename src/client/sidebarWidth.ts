export const DEFAULT_SIDEBAR_WIDTH = 390;
export const SIDEBAR_STORAGE_KEY = "ai-session-search.sidebar-width.v1";

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 720;
const MIN_CONVERSATION_WIDTH = 420;

export const clampSidebarWidth = (width: number, viewportWidth: number): number => {
  const viewportMaximum = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_CONVERSATION_WIDTH);
  return Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, viewportMaximum));
};

export const parseStoredSidebarWidth = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const width = Number(value);
  return Number.isFinite(width) ? width : null;
};
