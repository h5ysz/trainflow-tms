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
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { dir, t } = useI18n();
  const { sidebarOpen, setSidebarOpen, theme, currentRoute, sidebarCollapsed } = useAppStore();

  // Apply theme + direction to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("dir", dir);
    root.setAttribute("lang", dir === "rtl" ? "ar" : "en");
  }, [theme, dir]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar — collapsible rail, animated width */}
      <div
        className={cn(
          "hidden lg:block shrink-0 transition-[width] duration-200 ease-in-out",
          sidebarCollapsed ? "w-[68px]" : "w-52"
        )}
      >
        <Sidebar collapsed={sidebarCollapsed} showToggle />
      </div>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side={dir === "rtl" ? "right" : "left"} className="p-0 w-52">
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
          <AnimatePresence mode="wait">
            <motion.div
              key={currentRoute}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="p-4 lg:p-5"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette />
      <CopilotPanel />
    </div>
  );
}
