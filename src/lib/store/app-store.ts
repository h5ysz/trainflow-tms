"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/lib/i18n/translations";
import type { RouteKey } from "@/lib/auth/permissions";
import { authApi, type AuthUser } from "@/lib/api/client";

interface AppState {
  // Auth
  user: AuthUser | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  clearAuth: () => void;

  // Locale
  locale: Locale;
  setLocale: (locale: Locale) => void;

  // Theme
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;

  // Routing
  currentRoute: RouteKey;
  navigate: (route: RouteKey) => void;

  // Sidebar (mobile)
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Command palette
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      isAuthenticated: false,
      authLoading: false,
      authError: null,

      signIn: async (email, password) => {
        set({ authLoading: true, authError: null });
        try {
          const { user } = await authApi.login(email, password);
          set({
            user,
            isAuthenticated: true,
            locale: (user.language as Locale) ?? "en",
            currentRoute: "dashboard",
            authLoading: false,
          });
        } catch (e) {
          set({ authLoading: false, authError: (e as Error).message });
          throw e;
        }
      },

      refreshUser: async () => {
        try {
          const user = await authApi.me();
          set({ user, isAuthenticated: true, locale: (user.language as Locale) ?? get().locale });
        } catch {
          // Not authenticated
          set({ user: null, isAuthenticated: false });
        }
      },

      signOut: async () => {
        try {
          await authApi.logout();
        } catch {
          // ignore — cookie cleared on server anyway
        }
        set({ user: null, isAuthenticated: false, currentRoute: "dashboard", sidebarOpen: false });
      },

      clearAuth: () => set({ user: null, isAuthenticated: false, currentRoute: "dashboard" }),

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
      name: "gcclab-tms-store",
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
