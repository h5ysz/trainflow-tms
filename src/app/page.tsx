"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { I18nProvider } from "@/lib/i18n/context";
import { LoginForm } from "@/components/auth/login-form";
import { AppShell } from "@/components/layout/app-shell";
import { RouteRouter } from "@/routes/router";

export default function Home() {
  const { isAuthenticated, locale, theme, setTheme, setLocale } = useAppStore();

  // Sync theme on first paint
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme, setTheme]);

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      {!isAuthenticated ? (
        <LoginForm />
      ) : (
        <AppShell>
          <RouteRouter />
        </AppShell>
      )}
    </I18nProvider>
  );
}
