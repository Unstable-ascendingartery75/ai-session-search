import { I18nProvider } from "@lingui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { activateLocale, i18n } from "./i18n/index.ts";
import { resolvePreferredLocale } from "./i18n/localeDetection.ts";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Root element not found");
activateLocale(resolvePreferredLocale(navigator));

createRoot(root).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  </StrictMode>,
);
