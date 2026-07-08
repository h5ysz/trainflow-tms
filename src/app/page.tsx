"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { I18nProvider } from "@/lib/i18n/context";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { AppShell } from "@/components/layout/app-shell";
import { RouteRouter } from "@/routes/router";

export default function Home() {
  const { isAuthenticated, locale, theme, setTheme, setLocale, refreshUser } = useAppStore();
  const [route, setRoute] = useState<"login" | "register">("login");

  // Check URL for /register
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname === "/register") {
      Promise.resolve().then(() => setRoute("register"));
    }
  }, []);

  // Sync theme on first paint
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme, setTheme]);

  // Restore session on mount
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      {!isAuthenticated ? (
        route === "register" ? (
          <RegisterForm />
        ) : (
          <LoginForm />
        )
      ) : (
        <AppShell>
          <RouteRouter />
        </AppShell>
      )}
    </I18nProvider>
  );
}
