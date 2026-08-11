"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getNavForRole } from "@/lib/auth/permissions";
import {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, Search, UserPlus, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// Must cover every icon named in navItems, or those entries fall back to the dashboard
// icon here while showing the correct one in the sidebar.
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck,
};

export function CommandPalette() {
  const { t } = useI18n();
  const { commandOpen, setCommandOpen, navigate, user } = useAppStore();
  const [query, setQuery] = useState("");

  // Global hotkey ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // e.code is the physical key, so the shortcut still works on an Arabic layout
      // where e.key for this key is "ن".
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (e.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setCommandOpen]);

  const items = useMemo(() => {
    if (!user) return [];
    const nav = getNavForRole(user.permissions);
    // Same data-driven visibility as the sidebar: trainers only see Workshops
    // when assigned and Evaluation when they have sessions.
    if (user.role !== "TRAINER" || !user.trainerNav) return nav;
    return nav.filter((item) => {
      if (item.key === "workshops") return user.trainerNav!.workshops;
      if (item.key === "evaluation") return user.trainerNav!.evaluation;
      return true;
    });
  }, [user]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) => {
      const label = t(item.labelKey as never).toLowerCase();
      return label.includes(q);
    });
  }, [items, query, t]);

  return (
    <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
      <DialogContent className="p-0 gap-0 max-w-xl overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("action.search")}</DialogTitle>
          <DialogDescription>{t("app.shortcut")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("app.shortcut")}
            className="border-0 shadow-none focus-visible:ring-0 h-11"
          />
        </div>
        <div className="max-h-80 overflow-y-auto tf-scroll p-2">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{t("table.noResults")}</div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => {
                        navigate(item.key);
                        setCommandOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm text-start",
                        "hover:bg-accent hover:text-accent-foreground transition-colors"
                      )}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{t(item.labelKey as never)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
