import type { SyncProgress } from "../../shared/types.ts";
import { providerDescriptor } from "../../shared/providers.ts";
import type { Translator } from "../i18n/index.ts";

export const IndexingStatus = ({ progress, t }: { progress: SyncProgress; t: Translator }) => {
  const fileProgress = progress.totalFiles > 0 ? progress.processedFiles / progress.totalFiles : 0;
  const overallProgress = progress.completedProviders + fileProgress;
  return (
    <div className="indexing-status" role="status" aria-live="polite">
      <div className="indexing-status-copy">
        <strong>{t("indexing.title")}</strong>
        <span>
          {progress.currentProvider === null
            ? t("indexing.preparing")
            : t("indexing.provider", { provider: providerDescriptor(progress.currentProvider).label })}
        </span>
      </div>
      <progress value={overallProgress} max={Math.max(progress.totalProviders, 1)} />
      <small>
        {t("indexing.progress", {
          completed: progress.completedProviders,
          total: progress.totalProviders,
        })}
        {progress.totalFiles > 0
          ? ` · ${t("indexing.files", {
              processed: progress.processedFiles,
              total: progress.totalFiles,
            })}`
          : ""}
      </small>
    </div>
  );
};
