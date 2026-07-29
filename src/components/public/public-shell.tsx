"use client";

// Shared chrome for the pages that render outside the authenticated app shell:
// login, register, /check-in and /verify.
//
// `dir` and `lang` used to be set only inside AppShell, so a visitor whose stored
// locale was Arabic got Arabic text in a left-to-right layout — and none of the
// `[dir="rtl"]` font rules in globals.css matched. AppShell also never cleaned the
// attribute up on sign-out, so the login page's direction depended on how you got there.

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { I18nProvider } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

export function PublicShell({
  children,
  showLocaleToggle = false,
}: {
  children: React.ReactNode;
  /** Render a language switcher in the corner. Forms that have their own can opt out. */
  showLocaleToggle?: boolean;
}) {
  const { locale, setLocale, theme } = useAppStore();
  const dir = locale === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("dir", dir);
    root.setAttribute("lang", locale);
  }, [theme, dir, locale]);

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      {showLocaleToggle && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-4 end-4 z-10 gap-1.5"
          onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
        >
          <Languages className="h-4 w-4" />
          {locale === "ar" ? "English" : "العربية"}
        </Button>
      )}
      {children}
    </I18nProvider>
  );
}
