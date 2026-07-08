"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/lib/i18n/translations";
import type { UserRole } from "@/lib/auth/permissions";
import type { RouteKey } from "@/lib/auth/permissions";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  language: Locale;
  companyId?: string | null;
  companyName?: string | null;
  trainerId?: string | null;
  avatarUrl?: string | null;
}

interface AppState {
  // Auth
  user: SessionUser | null;
  isAuthenticated: boolean;
  signIn: (user: SessionUser) => void;
  signOut: () => void;
  switchRole: (role: UserRole) => void;

  // Locale
  locale: Locale;
  setLocale: (locale: Locale) => void;

  // Theme
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;

  // Routing (single-page app routing)
  currentRoute: RouteKey;
  navigate: (route: RouteKey) => void;

  // Sidebar (mobile)
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Command palette
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

// Demo users for each role — for design exploration only (no fake business data)
const demoUsers: Record<UserRole, SessionUser> = {
  SUPER_ADMIN: {
    id: "demo-super-admin",
    email: "admin@trainflow.io",
    fullName: "System Administrator",
    role: "SUPER_ADMIN",
    language: "en",
  },
  COORDINATOR: {
    id: "demo-coordinator",
    email: "coordinator@trainflow.io",
    fullName: "Sarah Coordinator",
    role: "COORDINATOR",
    language: "en",
  },
  TRAINER: {
    id: "demo-trainer",
    email: "trainer@trainflow.io",
    fullName: "Ahmed Trainer",
    role: "TRAINER",
    language: "en",
  },
  CONTRACTOR: {
    id: "demo-contractor",
    email: "contractor@trainflow.io",
    fullName: "Khalid Contractor",
    role: "CONTRACTOR",
    language: "en",
    companyName: "Demo Contracting Co.",
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      isAuthenticated: false,
      signIn: (user) =>
        set({
          user,
          isAuthenticated: true,
          locale: user.language,
          currentRoute: "dashboard",
        }),
      signOut: () =>
        set({
          user: null,
          isAuthenticated: false,
          currentRoute: "dashboard",
          sidebarOpen: false,
        }),
      switchRole: (role) => {
        const current = get().user;
        if (!current) return;
        const demo = demoUsers[role];
        set({ user: { ...demo, language: current.language }, currentRoute: "dashboard" });
      },

      // Locale
      locale: "en",
      setLocale: (locale) =>
        set((state) => ({
          locale,
          user: state.user ? { ...state.user, language: locale } : null,
        })),

      // Theme
      theme: "light",
      setTheme: (theme) => set({ theme }),

      // Routing
      currentRoute: "dashboard",
      navigate: (route) => set({ currentRoute: route, sidebarOpen: false }),

      // Sidebar
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      // Command palette
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
    }),
    {
      name: "trainflow-tms-store",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        locale: state.locale,
        theme: state.theme,
        currentRoute: state.currentRoute,
      }),
    }
  )
);

export { demoUsers };
