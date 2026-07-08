"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Search, Bell, Sun, Moon, Languages, Menu, ChevronDown,
  UserCircle, Settings, LogOut, ShieldCheck, UserCog, GraduationCap, Building2,
  Check, Circle,
} from "lucide-react";
import { type UserRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

const ROLE_ICONS: Record<UserRole, typeof ShieldCheck> = {
  SUPER_ADMIN: ShieldCheck,
  COORDINATOR: UserCog,
  TRAINER: GraduationCap,
  CONTRACTOR: Building2,
};

export function Topbar() {
  const { t, locale, setLocale, dir } = useI18n();
  const {
    user, signOut, switchRole, theme, setTheme,
    setSidebarOpen, setCommandOpen,
  } = useAppStore();

  if (!user) return null;

  const initials = user.fullName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const RoleIcon = ROLE_ICONS[user.role];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 sm:px-4">
      {/* Mobile menu */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setSidebarOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Search / Command */}
      <button
        onClick={() => setCommandOpen(true)}
        className="group flex items-center gap-2 h-9 ps-3 pe-2 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground hover:bg-muted transition-colors w-full max-w-md"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-start truncate">{t("app.shortcut")}</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-1">
        {/* Language */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 hidden sm:flex"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
        >
          <Languages className="h-4 w-4" />
          <span className="text-xs font-medium">{locale === "en" ? "EN" : "ع"}</span>
        </Button>

        {/* Theme */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>

        {/* Notifications */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 end-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align={dir === "rtl" ? "start" : "end"}>
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">{t("notifications.title")}</div>
              <Button variant="ghost" size="sm" className="h-7 text-xs">{t("notifications.markAllRead")}</Button>
            </div>
            <div className="max-h-80 overflow-y-auto tf-scroll">
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <div className="font-medium text-foreground">{t("notifications.empty.title")}</div>
                <div className="text-xs mt-1">{t("notifications.empty.subtitle")}</div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 h-9 px-1.5 sm:px-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {initials}
                </AvatarFallback>
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

            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {t("auth.demoTitle")}
            </DropdownMenuLabel>
            {(["SUPER_ADMIN", "COORDINATOR", "TRAINER", "CONTRACTOR"] as UserRole[]).map((role) => {
              const Icon = ROLE_ICONS[role];
              const active = user.role === role;
              return (
                <DropdownMenuItem key={role} onClick={() => switchRole(role)} className="gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{t(`role.${role}` as const)}</span>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2">
              <UserCircle className="h-4 w-4" /> {t("action.details")}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <Settings className="h-4 w-4" /> {t("nav.settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={signOut}>
              <LogOut className="h-4 w-4" /> {t("auth.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
