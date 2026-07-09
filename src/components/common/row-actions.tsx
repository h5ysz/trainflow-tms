"use client";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Pencil, Trash2, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export interface RowActionsProps {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Rendered above the destructive section. */
  extraItems?: React.ReactNode;
  disabled?: boolean;
}

export function RowActions({
  onView, onEdit, onDelete, canEdit, canDelete, extraItems, disabled,
}: RowActionsProps) {
  const { t } = useI18n();

  const showEdit = Boolean(onEdit && canEdit);
  const showDelete = Boolean(onDelete && canDelete);
  if (!onView && !showEdit && !showDelete && !extraItems) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={disabled}>
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{t("action.actions")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {onView && (
          <DropdownMenuItem onSelect={onView}>
            <Eye className="h-3.5 w-3.5 me-2" />
            {t("action.view")}
          </DropdownMenuItem>
        )}
        {showEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="h-3.5 w-3.5 me-2" />
            {t("action.edit")}
          </DropdownMenuItem>
        )}
        {extraItems}
        {showDelete && (
          <>
            {(onView || showEdit || extraItems) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5 me-2" />
              {t("action.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
