export type AppLanguage = "system" | "zh-CN" | "en-US";

export type ResolvedLocale = "zh-CN" | "en-US";

export type ColorScheme = "default" | "blue-white" | "gray-white";

export type StartupBehavior = "empty" | "restore-last-documents";

export type AppSettings = {
  language: AppLanguage;
  colorScheme: ColorScheme;
  startupBehavior: StartupBehavior;
  codexSourceDiscoveryEnabled: boolean;
  externalRefreshEnabled: boolean;
};

export type RecentDocument = {
  path: string;
  name: string;
  lastOpenedAt: string;
  exists: boolean;
};
