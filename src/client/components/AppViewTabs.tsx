import type { Translator } from "../i18n/index.ts";

export type AppView = "sessions" | "contexts";

export const AppViewTabs = ({
  active,
  t,
  onChange,
}: {
  active: AppView;
  t: Translator;
  onChange: (view: AppView) => void;
}) => (
  <div className="app-view-tabs" role="tablist" aria-label={t("view.switcher")}>
    <button
      type="button"
      role="tab"
      aria-selected={active === "sessions"}
      className={active === "sessions" ? "active" : ""}
      onClick={() => onChange("sessions")}
    >
      {t("view.sessions")}
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={active === "contexts"}
      className={active === "contexts" ? "active" : ""}
      onClick={() => onChange("contexts")}
    >
      {t("view.contexts")}
    </button>
  </div>
);
