"use client";

import { useState, useEffect, useCallback } from "react";
import { api, type ListResponse } from "./client";

interface UseListOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  extraParams?: Record<string, string | number | boolean | undefined | null>;
  // Debounce search input by N ms
  searchDebounce?: number;
  // Don't auto-fetch on mount (manual refetch)
  manual?: boolean;
}

interface UseListResult<T> {
  data: T[];
  pagination: ListResponse<T>["pagination"] | null;
  loading: boolean;
  error: string | null;
  page: number;
  search: string;
  status: string;
  refetch: () => void;
  setPage: (n: number) => void;
  setSearch: (s: string) => void;
  setStatus: (s: string) => void;
}

export function useList<T>(path: string, options: UseListOptions = {}): UseListResult<T> {
  const {
    page: initialPage = 1,
    pageSize = 10,
    search: initialSearch = "",
    status: initialStatus = "",
    extraParams = {},
    searchDebounce = 300,
    manual = false,
  } = options;

  const [page, setPage] = useState(initialPage);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);

  const [data, setData] = useState<T[]>([]);
  const [pagination, setPagination] = useState<ListResponse<T>["pagination"] | null>(null);
  const [loading, setLoading] = useState(!manual);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on new search
    }, searchDebounce);
    return () => clearTimeout(t);
  }, [search, searchDebounce]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (manual) return;
    let cancelled = false;
    // Defer loading flag set to avoid synchronous setState in effect body
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    api
      .getList<T>(path, {
        page,
        pageSize,
        search: debouncedSearch || undefined,
        status: status || undefined,
        ...extraParams,
      })
      .then((res) => {
        if (cancelled) return;
        setData(res.rows ?? []);
        setPagination(res.pagination ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setData([]);
        setPagination(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, page, pageSize, debouncedSearch, status, reloadKey, JSON.stringify(extraParams)]);

  return {
    data,
    pagination,
    loading,
    error,
    page,
    search,
    status,
    refetch,
    setPage,
    setSearch,
    setStatus,
  };
}

// Mutation helpers
export function useCreate<T>() {
  const create = async (path: string, body: unknown) => {
    return api.post<T>(path, body);
  };
  return { create };
}

export function useUpdate<T>() {
  const update = async (path: string, body: unknown) => {
    return api.put<T>(path, body);
  };
  return { update };
}

export function useDelete() {
  const remove = async (path: string) => {
    return api.delete<{ success: boolean }>(path);
  };
  return { remove };
}
