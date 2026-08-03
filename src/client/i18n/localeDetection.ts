export type SupportedLocale = "en" | "zh-CN";

export const DEFAULT_LOCALE: SupportedLocale = "en";

type NavigatorLike = Pick<Navigator, "language" | "languages">;

const normalizeLocale = (language: string): SupportedLocale | undefined => {
  const normalized = language.trim().toLocaleLowerCase().replaceAll("_", "-");
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return undefined;
};

export const resolvePreferredLocale = (navigatorValue?: NavigatorLike): SupportedLocale => {
  if (navigatorValue === undefined) return DEFAULT_LOCALE;
  const languages =
    navigatorValue.languages.length > 0
      ? navigatorValue.languages
      : navigatorValue.language === ""
        ? []
        : [navigatorValue.language];
  for (const language of languages) {
    const locale = normalizeLocale(language);
    if (locale !== undefined) return locale;
  }
  return DEFAULT_LOCALE;
};
