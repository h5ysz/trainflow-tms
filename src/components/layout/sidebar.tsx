"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GCCLAB TMS — Premium Sidebar Navigation (UI/UX Redesign)
// ─────────────────────────────────────────────────────────────────────────────
// Modern, compact sidebar inspired by Microsoft 365 Admin Center, Azure Portal,
// Notion, and Linear. Features:
//   - Search box at the top to filter navigation items
//   - Grouped sections with clear visual separation
//   - Active item: primary-color indicator bar + subtle bg + bolder font
//   - Compact spacing (reduced vertical gaps)
//   - Professional footer: user info + profile/settings + logout
//   - RTL-aware (logical CSS properties)
//   - Smooth hover/active transitions
//
// NO changes to: permissions, routing, business logic, APIs, database, branding.
// The logo, nav items, RBAC, and navigation behavior are all preserved.

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { getNavForRole, type NavItem } from "@/lib/auth/permissions";
import { canAccessModule } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import Image from "next/image";
import {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck, BookUser, ClipboardCheck, TrendingUp, RefreshCw,
  Search, LogOut, UserCircle, Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: focus search on "/" — must be before any early return
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const items = user ? getNavForRole(user.permissions) : [];

  // Filter items by search query (matches label text)
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item) => {
      const label = t(item.labelKey as never).toLowerCase();
      return label.includes(q);
    });
  }, [items, searchQuery, t]);

  if (!user) return null;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: t(GROUP_LABELS[group] as never),
    items: filteredItems.filter((i) => i.group === group),
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

      {/* ─── Search Box ──────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={locale === "en" ? "Search..." : "بحث..."}
            className="w-full h-8 rounded-lg bg-sidebar-accent/40 border border-sidebar-border/50 ps-8 pe-2 text-[12px] text-sidebar-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:bg-sidebar-accent/60 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ─── Navigation ─────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto tf-scroll px-2 py-1">
        {grouped.length === 0 && searchQuery && (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground/60">
            {locale === "en" ? "No results found" : "لا توجد نتائج"}
          </div>
        )}
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
                        "group relative flex items-center gap-2.5 w-full rounded-lg px-2.5 py-[7px] text-[12.5px] transition-all duration-150",
                        active
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground font-medium"
                      )}
                    >
                      {/* Active indicator bar */}
                      {active && (
                        <span className="absolute inset-inline-start-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />
                      )}
                      <Icon
                        className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground")}
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
              <span className="hidden sm:inline">{locale === "en" ? "Settings" : "الإعدادات"}</span>
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
