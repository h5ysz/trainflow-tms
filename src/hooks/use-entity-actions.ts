"use client";

import { useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction, type RouteKey } from "@/lib/auth/permissions";

interface Options<T> {
  /** API resource path, e.g. "/companies". */
  resource: string;
  /** Permission module this resource belongs to. */
  module: RouteKey;
  /** Called after a successful create/update/delete. */
  refetch: () => void;
  /** Maps a record onto the create-dialog's form shape when editing. */
  toForm?: (row: T) => Record<string, unknown>;
  /**
   * Fetch the full record via GET /resource/:id before opening the edit dialog.
   * List rows usually carry only a subset of columns, so without this the
   * dialog would render blanks for fields the list doesn't select.
   */
  fetchOnEdit?: boolean;
  /** Rewrite a server error before it reaches the toast. */
  mapError?: (message: string) => string;
}

/**
 * Shared create/edit/delete plumbing for the entity list pages. The create
 * dialog doubles as the edit dialog: `openEdit` seeds `formData` from the row
 * and records `editingId`, which flips `submit` from POST to PUT.
 */
export function useEntityActions<T extends { id: string }>({
  resource, module, refetch, toForm, fetchOnEdit, mapError,
}: Options<T>) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  const role = user?.role;
  const canCreate = role ? canPerformAction(role, module, "create") : false;
  const canEdit = role ? canPerformAction(role, module, "edit") : false;
  const canDelete = role ? canPerformAction(role, module, "delete") : false;

  const setField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const openCreate = useCallback((defaults: Record<string, unknown> = {}) => {
    setEditingId(null);
    setFormData(defaults);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback(async (row: T) => {
    setEditingId(row.id);
    setFormData(toForm ? toForm(row) : ({ ...row } as Record<string, unknown>));
    setDialogOpen(true);
    if (!fetchOnEdit) return;
    try {
      const full = await api.get<T>(`${resource}/${row.id}`);
      setFormData(toForm ? toForm(full) : ({ ...full } as Record<string, unknown>));
    } catch (e) {
      // Keep the row-seeded values; the dialog stays usable.
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  }, [toForm, fetchOnEdit, resource, t, toast]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingId(null);
    setFormData({});
  }, []);

  /** Returns true on success. `validate` may return an error message to abort. */
  const submit = useCallback(async (validate?: () => string | null) => {
    const invalid = validate?.();
    if (invalid) {
      toast({ title: t("misc.error"), description: invalid, variant: "destructive" });
      return false;
    }
    setSubmitting(true);
    try {
      if (editingId) await api.put(`${resource}/${editingId}`, formData);
      else await api.post(resource, formData);
      toast({
        title: t("misc.success"),
        description: editingId ? t("misc.updateSuccess") : t("misc.createSuccess"),
      });
      closeDialog();
      refetch();
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      toast({ title: t("misc.error"), description: mapError?.(msg) ?? msg, variant: "destructive" });
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [editingId, formData, resource, refetch, closeDialog, mapError, t, toast]);

  /**
   * Builds a `validate` callback for `submit` that reports the first empty
   * required field, e.g. `requireFields({ [t("companies.name")]: "name" })`.
   */
  const requireFields = useCallback((fields: Record<string, string>) => () => {
    for (const [label, key] of Object.entries(fields)) {
      const v = formData[key];
      if (v === undefined || v === null || String(v).trim() === "") {
        return `${label} — ${t("misc.required")}`;
      }
    }
    return null;
  }, [formData, t]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`${resource}/${deleteTarget.id}`);
      toast({ title: t("misc.success"), description: t("misc.deleteSuccess") });
      setDeleteTarget(null);
      refetch();
    } catch (e) {
      const msg = (e as Error).message;
      toast({ title: t("misc.error"), description: mapError?.(msg) ?? msg, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, resource, refetch, mapError, t, toast]);

  return {
    canCreate, canEdit, canDelete,
    dialogOpen, setDialogOpen, editingId, isEditing: editingId !== null,
    formData, setFormData, setField,
    submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  };
}
