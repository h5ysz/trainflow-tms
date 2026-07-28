"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction, type Action, type RouteKey } from "@/lib/auth/permissions";
import { Lock } from "lucide-react";

export function RoleGuard({
  module,
  action = "view",
  children,
  fallback,
}: {
  module: RouteKey;
  action?: Action;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { t } = useI18n();
  const user = useAppStore((s) => s.user);

  if (!user) return null;
  if (canPerformAction(user.permissions, module, action)) {
    return <>{children}</>;
  }

  return (
    <>
      {fallback ?? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
            <Lock className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm">{t("misc.noAccess")}</p>
        </div>
      )}
    </>
  );
}
