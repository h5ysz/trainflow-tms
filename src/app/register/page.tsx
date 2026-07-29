"use client";

import { useAppStore } from "@/lib/store/app-store";
import { PublicShell } from "@/components/public/public-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { useEffect } from "react";

export default function RegisterPage() {
  const { isAuthenticated } = useAppStore();

  // An already-signed-in visitor has no business on the registration form.
  useEffect(() => {
    if (isAuthenticated) window.location.replace("/");
  }, [isAuthenticated]);

  return (
    <PublicShell>
      <RegisterForm />
    </PublicShell>
  );
}
