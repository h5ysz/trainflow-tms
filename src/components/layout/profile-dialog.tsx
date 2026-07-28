"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoleBadge } from "@/components/common/status-badge";
import { canAccessModule, type UserRole } from "@/lib/auth/permissions";
import { Settings, ShieldCheck, UserCog, GraduationCap, Building2, Eye } from "lucide-react";

const ROLE_ICONS: Record<UserRole, typeof ShieldCheck> = {
  SUPER_ADMIN: ShieldCheck,
  COORDINATOR: UserCog,
  TRAINER: GraduationCap,
  VIEWER: Eye,
  CONTRACTOR: Building2,
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-end break-words">{value}</span>
    </div>
  );
}

export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { user, navigate } = useAppStore();

  if (!user) return null;

  const initials = user.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  const RoleIcon = ROLE_ICONS[user.role];
  const canOpenSettings = canAccessModule(user.permissions, "settings");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("profile.title")}</DialogTitle>
          <DialogDescription>{t("profile.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{user.fullName}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            <div className="pt-1.5">
              <RoleBadge role={user.role} icon={RoleIcon} />
            </div>
          </div>
        </div>

        <div className="rounded-md border px-3">
          {user.companyName && <Row label={t("profile.company")} value={user.companyName} />}
          <Row
            label={t("profile.language")}
            value={(user.language ?? locale) === "ar" ? "العربية" : "English"}
          />
          <Row
            label={t("profile.status")}
            value={
              <span className={user.isActive === false ? "text-destructive" : "text-success"}>
                {user.isActive === false ? t("profile.inactive") : t("profile.active")}
              </span>
            }
          />
          <Row
            label={t("profile.lastLogin")}
            value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : t("profile.never")}
          />
          <Row label={t("profile.modules")} value={user.permissions.length} />
        </div>

        <DialogFooter className="gap-2">
          {canOpenSettings && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                onOpenChange(false);
                navigate("settings");
              }}
            >
              <Settings className="h-4 w-4" /> {t("profile.openSettings")}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>{t("action.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
