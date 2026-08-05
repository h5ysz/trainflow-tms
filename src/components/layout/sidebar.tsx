"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GCCLAB TMS — Premium Enterprise Sidebar
// ─────────────────────────────────────────────────────────────────────────────
// Modern, compact sidebar inspired by Microsoft 365 Admin Center, Azure Portal,
// Notion, and Linear. Features:
//   - NO search box (global search lives in the topbar only)
//   - Grouped sections with clear visual separation
//   - Active item: primary-color indicator bar + subtle bg + bolder font
//   - Compact spacing (reduced vertical gaps)
//   - Professional footer: user info + settings + logout
//   - RTL-aware (logical CSS properties)
//   - Smooth hover/active transitions
//
// NO changes to: permissions, routing, business logic, APIs, database, branding.

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { getNavForRole, canAccessModule, type NavItem } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import Image from "next/image";
import {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck, BookUser, ClipboardCheck, TrendingUp, RefreshCw,
  LogOut, Sparkles,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck, BookUser, ClipboardCheck, TrendingUp, RefreshCw,
  Sparkles,
};

const GROUP_ORDER: NavItem["group"][] = ["dashboard", "training", "assessment", "reports", "system"];

const GROUP_LABELS: Record<NavItem["group"], string> = {
  dashboard: "nav.group.dashboard",
  training: "nav.group.training",
  assessment: "nav.group.assessment",
  reports: "nav.group.reports",
  system: "nav.group.system",
};

export function Sidebar() {
  const { t, locale } = useI18n();
  const { currentRoute, navigate, user, signOut } = useAppStore();

  if (!user) return null;
  const items = getNavForRole(user.permissions);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: t(GROUP_LABELS[group] as never),
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  const userInitials = user.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* ─── Brand Header ────────────────────────────────────────────── */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border shrink-0">
        <Image
          src="/gcclab-icon.png"
          alt="GCC Lab"
          width={32}
          height={32}
          className="shrink-0 object-contain rounded-lg"
        />
        <div className="min-w-0">
          <div className="text-[13px] font-bold leading-tight tracking-tight">
            {locale === "en" ? "GCC Lab" : "المختبر الخليجي"}
          </div>
          <div className="text-[10px] text-muted-foreground leading-tight">
            {locale === "en" ? "Training Management" : "إدارة التدريب"}
          </div>
        </div>
      </div>

      {/* ─── Navigation (no search box — global search is in the topbar) ── */}
      <nav className="flex-1 overflow-y-auto tf-scroll px-2 py-2">
        {grouped.map(({ group, label, items: groupItems }) => (
          <div key={group} className="mb-3">
            {label && (
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50">
                {label}
              </div>
            )}
            <ul className="space-y-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = currentRoute === item.key;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => navigate(item.key)}
                      className={cn(
                        "group relative flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-[13px] transition-all duration-150",
                        active
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground font-medium"
                      )}
                    >
                      {/* Active indicator bar */}
                      {active && (
                        <span className="absolute inset-inline-start-0 top-2 bottom-2 w-[3px] rounded-full bg-primary" />
                      )}
                      <Icon
                        className={cn("h-[18px] w-[18px] shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground")}
                        strokeWidth={active ? 2.2 : 1.8}
                      />
                      <span className="truncate">{t(item.labelKey as never)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ─── Footer: User + Actions ─────────────────────────────────── */}
      <div className="border-t border-sidebar-border shrink-0">
        {/* User info */}
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-[11px] font-bold ring-1 ring-primary/20">
            {userInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold leading-tight truncate">{user.fullName}</div>
            <div className="text-[10px] text-muted-foreground leading-tight truncate">
              {t(`role.${user.role}` as const)}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 px-2 pb-2">
          {canAccessModule(user.permissions, "settings") && (
            <button
              onClick={() => navigate("settings")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors",
                currentRoute === "settings"
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
              title={locale === "en" ? "Settings" : "الإعدادات"}
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{locale === "en" ? "Settings" : "الإعدارات"}</span>
            </button>
          )}
          <button
            onClick={() => signOut()}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
            title={locale === "en" ? "Logout" : "خروج"}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{locale === "en" ? "Logout" : "خروج"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
