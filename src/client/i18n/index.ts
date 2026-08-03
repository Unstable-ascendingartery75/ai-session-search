import { i18n } from "@lingui/core";
import { messages as englishMessages, type MessageId } from "./locales/en.ts";
import { messages as chineseMessages } from "./locales/zh-CN.ts";
import type { SupportedLocale } from "./localeDetection.ts";

const catalogs = {
  en: englishMessages,
  "zh-CN": chineseMessages,
};

export const activateLocale = (locale: SupportedLocale): void => {
  i18n.loadAndActivate({ locale, messages: catalogs[locale] });
};

export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translator = (id: MessageId, values?: TranslationValues) => string;

export const translate = (
  id: MessageId,
  values?: TranslationValues,
): string => i18n._(id, values);

export { i18n };
