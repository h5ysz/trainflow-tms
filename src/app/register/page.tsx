"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { I18nProvider } from "@/lib/i18n/context";
import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  const { isAuthenticated, locale, theme, setTheme, setLocale } = useAppStore();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme, setTheme]);

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      <RegisterForm />
    </I18nProvider>
  );
}
