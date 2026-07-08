"use client";

import React, { createContext, useContext, useMemo } from "react";
import { dict, type DictKey, type Locale } from "./translations";

interface I18nContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  setLocale,
  children,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const t = (key: DictKey, vars?: Record<string, string | number>) => {
      const table = dict[locale] ?? dict.en;
      let str: string = (table as Record<string, string>)[key as string] ?? (dict.en as Record<string, string>)[key as string] ?? (key as string);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    };
    return {
      locale,
      dir: locale === "ar" ? "rtl" : "ltr",
      t,
      setLocale,
      toggleLocale: () => setLocale(locale === "ar" ? "en" : "ar"),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

export type { Locale, DictKey };
