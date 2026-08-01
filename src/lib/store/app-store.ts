"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/lib/i18n/translations";
import type { RouteKey } from "@/lib/auth/permissions";
import { authApi, api, ApiError, setUnauthorizedHandler, type AuthUser } from "@/lib/api/client";

export interface AppState {
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
  /** Id carried by detail routes (e.g. session-detail). Null on list routes. */
  routeParam: string | null;
  navigate: (route: RouteKey, param?: string) => void;

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
            routeParam: null,
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
          // Don't override locale from server if the user already has a local preference
          // (they may have toggled language without the server update landing yet).
          // Only use server language on first login (when locale is still the default "en").
          const currentLocale = get().locale;
          const serverLocale = (user.language as Locale) ?? "en";
          set({
            user,
            isAuthenticated: true,
            locale: currentLocale !== "en" ? currentLocale : serverLocale,
          });
        } catch (e) {
          // Only an actual 401 means "not authenticated". Catching everything meant a
          // transient network blip on page load silently signed a valid user out.
          if (e instanceof ApiError && e.status === 401) {
            set({ user: null, isAuthenticated: false });
          }
        }
      },

      signOut: async () => {
        try {
          await authApi.logout();
        } catch {
          // ignore — cookie cleared on server anyway
        }
        set({ user: null, isAuthenticated: false, currentRoute: "dashboard", routeParam: null, sidebarOpen: false });
      },

      clearAuth: () => set({ user: null, isAuthenticated: false, currentRoute: "dashboard", routeParam: null }),

      // Locale
      locale: "en",
      setLocale: (locale) => {
        set((state) => ({
          locale,
          user: state.user ? { ...state.user, language: locale } : null,
        }));
        // Persist language preference to the backend so it survives page refresh.
        // Uses the /api/auth/language endpoint (any authenticated user can call it).
        // Fire-and-forget — if it fails, the local state is still correct for this session.
        api.put("/auth/language", { language: locale }).catch(() => {
          // Silently ignore — the local state is already updated.
        });
      },

      // Theme
      theme: "light",
      setTheme: (theme) => set({ theme }),

      // Routing
      currentRoute: "dashboard",
      routeParam: null,
      navigate: (route, param) =>
        set({ currentRoute: route, routeParam: param ?? null, sidebarOpen: false }),

      // Sidebar
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      // Command palette
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
    }),
    {
      name: "gcclab-tms-store",
      version: 1,
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        locale: state.locale,
        theme: state.theme,
        currentRoute: state.currentRoute,
        // Persisted so a refresh on a detail route keeps its subject.
        routeParam: state.routeParam,
      }),
      // Silently accept any persisted state from older store versions.
      // Without this, Zustand logs: "State loaded from storage couldn't be
      // migrated since no migrate function was provided" — harmless but noisy.
      migrate: () => ({}) as Partial<AppState>,
      // Drop any persisted state that doesn't match the current store shape
      // (prevents stale fields like old theme/route from leaking in after
      // schema changes between releases).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          // Always re-validate auth on hydration — never trust persisted
          // user/session across reloads (token may have expired server-side).
          user: null,
          isAuthenticated: false,
          authLoading: false,
          authError: null,
        };
      },
    }
  )
);

// Any 401 from the API tears the session down here, so the app falls back to the
// login screen instead of staying mounted with every request failing.
setUnauthorizedHandler(() => {
  const { isAuthenticated, clearAuth } = useAppStore.getState();
  if (isAuthenticated) clearAuth();
});
