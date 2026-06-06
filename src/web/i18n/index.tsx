import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppLanguage, ResolvedLocale } from "../../shared/appSettingsTypes";
import { enUS } from "./locales/en-US";
import { zhCN } from "./locales/zh-CN";

export type LocaleKey = keyof typeof zhCN;

type I18nContextValue = {
  locale: ResolvedLocale;
  t: (key: LocaleKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: (key) => zhCN[key]
});

const dictionaries: Record<ResolvedLocale, Record<LocaleKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS
};

export function I18nProvider({
  language,
  children
}: {
  language: AppLanguage;
  children: ReactNode;
}) {
  const locale = resolveLocale(language);
  const dictionary = dictionaries[locale];
  const value = useMemo<I18nContextValue>(() => {
    const t = (key: LocaleKey, params: Record<string, string | number> = {}) =>
      interpolate(dictionary[key] ?? zhCN[key] ?? key, params);
    return { locale, t };
  }, [dictionary, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function resolveLocale(language: AppLanguage): ResolvedLocale {
  if (language === "zh-CN" || language === "en-US") {
    return language;
  }

  const browserLanguage =
    typeof navigator === "undefined" ? "zh-CN" : navigator.language;
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  );
}
