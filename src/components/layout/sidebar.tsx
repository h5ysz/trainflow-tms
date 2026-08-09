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
//   - Desktop collapsible rail: `collapsed` hides labels (icons + tooltips),
//     `showToggle` renders the collapse/expand control. The mobile Sheet always
//     renders expanded.
//
// NO changes to: permissions, routing, business logic, APIs, database, branding.

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { getNavForRole, canAccessModule, type NavItem } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen, Wrench,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck, BookUser, ClipboardCheck, TrendingUp, RefreshCw,
  LogOut, Sparkles, ChevronsLeft, ChevronsRight,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen, Wrench,
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

export function Sidebar({
  collapsed = false,
  showToggle = false,
}: {
  /** Desktop collapsed rail — icons only with tooltips. */
  collapsed?: boolean;
  /** Render the collapse/expand control (desktop only). */
  showToggle?: boolean;
}) {
  const { t, locale, dir } = useI18n();
  const { currentRoute, navigate, user, signOut, setSidebarCollapsed } = useAppStore();

  if (!user) return null;
  const items = getNavForRole(user.permissions);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: t(GROUP_LABELS[group] as never),
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  const userInitials = user.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  // Collapse points toward the screen edge: left in LTR, right in RTL.
  const CollapseIcon = dir === "rtl" ? ChevronsRight : ChevronsLeft;
  const ExpandIcon = dir === "rtl" ? ChevronsLeft : ChevronsRight;

  return (
    <aside className="relative flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* ─── Brand Header ────────────────────────────────────────────── */}
      <div className={cn("flex h-16 items-center gap-2.5 px-3 border-b border-sidebar-border shrink-0", collapsed && "justify-center px-2")}>
        <Image
          src="/gcclab-icon.png"
          alt="GCC Lab"
          width={collapsed ? 36 : 40}
          height={collapsed ? 36 : 40}
          className="shrink-0 object-contain rounded-lg"
        />
        {!collapsed && (
          <div className="min-w-0 flex flex-col justify-center gap-0.5">
            <div className="text-[18px] font-bold leading-none tracking-tight text-foreground whitespace-nowrap">
              {locale === "en" ? "GCC Lab" : "المختبر الخليجي"}
            </div>
            <div className="text-[12px] text-muted-foreground/80 leading-none font-medium whitespace-nowrap">
              {locale === "en" ? "Training Management" : "إدارة التدريب"}
            </div>
          </div>
        )}

        {showToggle && !collapsed && (
          <button
            onClick={() => setSidebarCollapsed(true)}
            title={locale === "en" ? "Collapse sidebar" : "طي الشريط الجانبي"}
            className="ms-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <CollapseIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Floating expand button when collapsed — sits on the screen edge */}
      {showToggle && collapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          title={locale === "en" ? "Expand sidebar" : "توسيع الشريط الجانبي"}
          className="absolute top-4 -start-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-sidebar-border bg-background text-muted-foreground shadow-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <ExpandIcon className="h-4 w-4" />
        </button>
      )}

      {/* ─── Navigation (no search box — global search is in the topbar) ── */}
      <nav className="flex-1 overflow-y-auto tf-scroll px-1.5 py-2">
        {grouped.map(({ group, label, items: groupItems }) => (
          <div key={group} className="mb-2">
            {!collapsed && label && (
              <div className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50">
                {label}
              </div>
            )}
            {collapsed && groupItems.length > 0 && (
              <div className="mx-auto mb-1 h-px w-5 bg-sidebar-border" aria-hidden="true" />
            )}
            <ul className="space-y-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = currentRoute === item.key;
                return (
                  <li key={item.key}>
                    <motion.button
                      onClick={() => navigate(item.key)}
                      title={collapsed ? (t(item.labelKey as never) as string) : undefined}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className={cn(
                        "group relative flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[15px] transition-colors duration-150",
                        collapsed && "justify-center px-0 py-2.5",
                        active
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground font-medium"
                      )}
                    >
                      {/* Active indicator bar — animated slide via layoutId */}
                      {active && (
                        <motion.span
                          layoutId="sidebar-active-indicator"
                          className="absolute inset-inline-start-0 top-2 bottom-2 w-[3px] rounded-full bg-primary"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                      <Icon
                        className={cn("h-[22px] w-[22px] shrink-0 transition-all duration-150", active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground group-hover:scale-105")}
                        strokeWidth={active ? 2.2 : 1.8}
                      />
                      {!collapsed && <span className="truncate transition-colors duration-150">{t(item.labelKey as never)}</span>}
                    </motion.button>
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
        <div className={cn("px-2.5 py-2.5 flex items-center gap-2.5", collapsed && "justify-center px-0")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-[11px] font-bold ring-1 ring-primary/20">
            {userInitials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold leading-tight truncate">{user.fullName}</div>
              <div className="text-[10px] text-muted-foreground leading-tight truncate">
                {t(`role.${user.role}` as const)}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className={cn("flex items-center gap-0.5 px-2 pb-2", collapsed && "flex-col gap-1")}>
          {canAccessModule(user.permissions, "settings") && (
            <button
              onClick={() => navigate("settings")}
              title={collapsed ? (locale === "en" ? "Settings" : "الإعدادات") : undefined}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors",
                collapsed && "w-full",
                currentRoute === "settings"
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              {!collapsed && <span className="hidden sm:inline">{locale === "en" ? "Settings" : "الإعدارات"}</span>}
            </button>
          )}
          <button
            onClick={() => signOut()}
            title={collapsed ? (locale === "en" ? "Logout" : "خروج") : undefined}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors",
              collapsed && "w-full"
            )}
          >
            <LogOut className="h-3.5 w-3.5" />
            {!collapsed && <span className="hidden sm:inline">{locale === "en" ? "Logout" : "خروج"}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
