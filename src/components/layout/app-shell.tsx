"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { CopilotPanel } from "@/components/common/copilot-panel";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { useEffect } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { dir, t } = useI18n();
  const { sidebarOpen, setSidebarOpen, theme } = useAppStore();

  // Apply theme + direction to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("dir", dir);
    root.setAttribute("lang", dir === "rtl" ? "ar" : "en");
  }, [theme, dir]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <div className="hidden lg:block w-64 shrink-0 border-e border-sidebar-border">
        <Sidebar />
      </div>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side={dir === "rtl" ? "right" : "left"} className="p-0 w-72">
          {/* Radix requires a title on every dialog; the sidebar shows its own brand
              block, so this one is for assistive technology only. */}
          <VisuallyHidden>
            <SheetTitle>{t("nav.dashboard")}</SheetTitle>
          </VisuallyHidden>
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto tf-scroll">
          <div className="w-full p-4 sm:p-6 lg:px-4 lg:py-6">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette />
      <CopilotPanel />
    </div>
  );
}
