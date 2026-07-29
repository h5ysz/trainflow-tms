"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { PublicShell } from "@/components/public/public-shell";
import { I18nProvider } from "@/lib/i18n/context";
import { LoginForm } from "@/components/auth/login-form";
import { AppShell } from "@/components/layout/app-shell";
import { RouteRouter } from "@/routes/router";

export default function Home() {
  const { isAuthenticated, locale, setLocale, refreshUser } = useAppStore();

  // Restore session on mount.
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // The "/register" branch that used to live here was unreachable: the App Router
  // serves src/app/register/page.tsx for that path, so this component never rendered
  // there.
  if (!isAuthenticated) {
    // PublicShell applies dir/lang/theme. Without it the login page rendered Arabic
    // text in a left-to-right layout and without the Arabic font.
    return (
      <PublicShell>
        <LoginForm />
      </PublicShell>
    );
  }

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      <AppShell>
        <RouteRouter />
      </AppShell>
    </I18nProvider>
  );
}
