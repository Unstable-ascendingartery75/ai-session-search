import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "../../shared/types.ts";
import type { Translator } from "../i18n/index.ts";

const GITHUB_URL = "https://github.com/lililib/ai-session-search";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const requestUpdateState = async (input: string, init?: RequestInit): Promise<UpdateState> => {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<UpdateState>;
};

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.27.74-1.56-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.16 1.18a10.94 10.94 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
  </svg>
);

export const UpdateNotification = ({ t }: { t: Translator }) => {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const state = await requestUpdateState("/api/update?refresh=1");
        if (cancelled) return;
        setUpdate(state);
      } catch {
        // An offline check is silent and will be retried on the next interval.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (update?.status !== "downloading") return;
    const timer = window.setInterval(() => {
      requestUpdateState("/api/update").then(setUpdate).catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [update?.status]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  const updateVisible = update?.enabled === true
    && update.latestVersion !== null
    && !update.ignored
    && ["available", "downloading", "downloaded", "error"].includes(update.status);

  if (!updateVisible || update === null || update.latestVersion === null) {
    return (
      <a className="github-link" href={GITHUB_URL} target="_blank" rel="noreferrer"
        title={t("github.open")} aria-label={t("github.open")}>
        <GitHubIcon />
      </a>
    );
  }

  const progress = update.totalBytes !== null && update.totalBytes > 0
    ? Math.min(100, Math.round((update.downloadedBytes / update.totalBytes) * 100))
    : null;

  const ignoreVersion = async (): Promise<void> => {
    try {
      const state = await requestUpdateState("/api/update/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setUpdate(state);
      setOpen(false);
    } catch {
      setUpdate((state) => state === null ? null : { ...state, status: "error" });
    }
  };

  const startDownload = async (): Promise<void> => {
    try {
      setUpdate(await requestUpdateState("/api/update/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }));
    } catch {
      setUpdate((state) => state === null ? null : { ...state, status: "error" });
    }
  };

  return (
    <div className="update-notification" ref={wrapperRef}>
      <button className="github-link" type="button"
        title={t("update.available", { version: update.latestVersion })}
        aria-label={t("update.available", { version: update.latestVersion })}
        aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <GitHubIcon />
        <span className="update-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="update-popover" role="dialog" aria-label={t("update.title")}>
          <strong>{t("update.title")}</strong>
          <p>{t("update.description", { current: update.currentVersion, latest: update.latestVersion })}</p>
          {update.status === "downloading" && (
            <div className="update-progress">
              <progress max={100} value={progress ?? undefined} />
              <span>{progress === null ? t("update.downloading") : t("update.downloadingProgress", { progress })}</span>
            </div>
          )}
          {update.status === "downloaded" && <p className="update-success">{t("update.downloaded")}</p>}
          {update.status === "error" && <p className="update-error">{t("update.failed")}</p>}
          <div className="update-actions">
            {update.downloadAvailable && update.status !== "downloaded" && (
              <button type="button" disabled={update.status === "downloading"} onClick={() => void startDownload()}>
                {update.status === "downloading" ? t("update.downloading") : t("update.download")}
              </button>
            )}
            <a href={update.releaseUrl ?? `${GITHUB_URL}/releases`} target="_blank" rel="noreferrer">
              {t("update.viewRelease")}
            </a>
            <button type="button" disabled={update.status === "downloading"} onClick={() => void ignoreVersion()}>
              {t("update.ignore")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
