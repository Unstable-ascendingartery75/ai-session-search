import type { RefObject } from "react";
import { providerDescriptor } from "../../shared/providers.ts";
import type { ProviderId, ProviderSourceSetting } from "../../shared/types.ts";
import type { Translator } from "../i18n/index.ts";

export type ProviderSourceDraft = { enabled: boolean; home: string };

export const ProviderSourcesDialog = ({
  settings,
  drafts,
  savingProvider,
  closeButtonRef,
  t,
  onClose,
  onDraftChange,
  onSave,
}: {
  settings: ProviderSourceSetting[];
  drafts: Partial<Record<ProviderId, ProviderSourceDraft>>;
  savingProvider: ProviderId | null;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  t: Translator;
  onClose: () => void;
  onDraftChange: (provider: ProviderId, draft: ProviderSourceDraft) => void;
  onSave: (setting: ProviderSourceSetting) => void;
}) => (
  <div className="modal-backdrop" onMouseDown={onClose}>
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
          ref={closeButtonRef}
          className="dialog-close"
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("common.closeShortcutHint")}
        >
          ×
        </button>
      </header>
      <div className="source-settings-list">
        {settings.map((setting) => {
          const draft = drafts[setting.provider] ?? {
            enabled: setting.enabled,
            home: setting.home,
          };
          const descriptor = providerDescriptor(setting.provider);
          const saving = savingProvider === setting.provider;
          const changed = draft.enabled !== setting.enabled || draft.home.trim() !== setting.home;
          return (
            <article className="source-setting" key={setting.provider}>
              <div className="source-setting-heading">
                <span className="provider-dot" style={{ background: descriptor.color }} />
                <strong>{descriptor.label}</strong>
                <code>{setting.provider}</code>
                <label className="source-enabled">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => onDraftChange(setting.provider, {
                      ...draft,
                      enabled: event.target.checked,
                    })}
                  />
                  {t("sources.enabled")}
                </label>
              </div>
              <div className="source-path-row">
                <input
                  value={draft.home}
                  onChange={(event) => onDraftChange(setting.provider, {
                    ...draft,
                    home: event.target.value,
                  })}
                  placeholder={setting.defaultHome}
                  spellCheck={false}
                />
                <button
                  onClick={() => onDraftChange(setting.provider, { ...draft, home: setting.defaultHome })}
                  disabled={draft.home === setting.defaultHome}
                >
                  {t("sources.restoreDefault")}
                </button>
                <button
                  className="primary"
                  onClick={() => onSave(setting)}
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
);
