"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RoleBadge } from "@/components/common/status-badge";
import { ProfileDialog } from "./profile-dialog";
import {
  Search, Bell, Sun, Moon, Languages, Menu, ChevronDown,
  UserCircle, Settings, LogOut, ShieldCheck, UserCog, GraduationCap, Building2,
  Loader2, Eye,
} from "lucide-react";
import { canAccessModule, type UserRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";

const ROLE_ICONS: Record<UserRole, typeof ShieldCheck> = {
  SUPER_ADMIN: ShieldCheck,
  COORDINATOR: UserCog,
  TRAINER: GraduationCap,
  VIEWER: Eye,
  CONTRACTOR: Building2,
};

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export function Topbar() {
  const { t, locale, setLocale, dir } = useI18n();
  const {
    user, signOut, theme, setTheme,
    setSidebarOpen, setCommandOpen, navigate,
  } = useAppStore();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const initials = user ? user.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() : "";
  const RoleIcon = user ? ROLE_ICONS[user.role] : ShieldCheck;

  const loadNotifications = async () => {
    setNotifLoading(true);
    try {
      const res = await api.getList<Notification>("/notifications", { pageSize: 5 });
      setNotifications(res.rows ?? []);
      setUnreadCount((res.pagination as any)?.unreadCount ?? 0);
    } catch {
      // ignore — silent
    } finally {
      setNotifLoading(false);
    }
  };

  useEffect(() => {
    // Async data load: the state writes happen in the promise callbacks, after the
    // effect body has returned.
    loadNotifications();
  }, []);

  if (!user) return null;

  const markAllRead = async () => {
    try {
      await api.patch("/notifications", {});
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      toast({ title: t("misc.success"), description: t("notifications.markAllRead") });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>

      <button
        onClick={() => setCommandOpen(true)}
        className="group flex items-center gap-2 h-9 ps-3 pe-2 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground hover:bg-muted transition-colors w-full max-w-md"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-start truncate">{t("app.shortcut")}</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="gap-1.5 hidden sm:flex" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
          <Languages className="h-4 w-4" />
          <span className="text-xs font-medium">{locale === "en" ? "EN" : "ع"}</span>
        </Button>

        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>

        <Popover onOpenChange={(open) => { if (open) loadNotifications(); }}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 end-1.5 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-semibold h-3.5 min-w-3.5 px-1">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align={dir === "rtl" ? "start" : "end"}>
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">{t("notifications.title")}</div>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>{t("notifications.markAllRead")}</Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto tf-scroll">
              {notifLoading ? (
                <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <div className="font-medium text-foreground">{t("notifications.empty.title")}</div>
                  <div className="text-xs mt-1">{t("notifications.empty.subtitle")}</div>
                </div>
              ) : (
                <div className="divide-y">
                  {notifications.map((n) => (
                    <div key={n.id} className={`flex items-start gap-2 p-3 ${!n.isRead ? "bg-primary/5" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium flex items-center gap-1.5">
                          {n.title}
                          {!n.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 h-9 px-1.5 sm:px-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-xs font-medium">{user.fullName}</span>
                <span className="text-[10px] text-muted-foreground">{t(`role.${user.role}` as const)}</span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={dir === "rtl" ? "start" : "end"} className="w-64">
            <DropdownMenuLabel className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{user.fullName}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </div>
              </div>
              <div className="pt-1">
                <RoleBadge role={user.role} icon={RoleIcon} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={() => setProfileOpen(true)}>
              <UserCircle className="h-4 w-4" /> {t("action.details")}
            </DropdownMenuItem>
            {/* Gated the same way profile-dialog.tsx already does it — offering this
                to everyone sent non-admins to the lock screen, and the route then stuck
                in the persisted store so a refresh reloaded it. */}
            {canAccessModule(user?.permissions ?? [], "settings") && (
              <DropdownMenuItem className="gap-2" onSelect={() => navigate("settings")}>
                <Settings className="h-4 w-4" /> {t("nav.settings")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" /> {t("auth.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  );
}
