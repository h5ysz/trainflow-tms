"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { LucideIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptySubtitle?: string;
  emptyAction?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  pageSize?: number;
  page?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
  emptyAction,
  searchable,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  pageSize = 10,
  page = 1,
  total = 0,
  onPageChange,
  rowKey,
  onRowClick,
  className,
}: DataTableProps<T>) {
  const { t, dir } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isRtl = dir === "rtl";

  const Prev = isRtl ? ChevronRight : ChevronLeft;
  const Next = isRtl ? ChevronLeft : ChevronRight;
  const First = isRtl ? ChevronsRight : ChevronsLeft;
  const Last = isRtl ? ChevronsLeft : ChevronsRight;

  if (loading) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="p-8 text-center text-sm text-muted-foreground">{t("table.loading")}</div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {searchable && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder ?? t("action.search")}
              className="ps-9"
            />
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto tf-scroll">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={cn("text-[11px] font-bold uppercase tracking-wide text-muted-foreground", col.headerClassName)}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="p-0">
                    <EmptyState
                      icon={emptyIcon}
                      title={emptyTitle}
                      subtitle={emptySubtitle}
                      action={emptyAction}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    onClick={() => onRowClick?.(row)}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {total > 0 && onPageChange && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
          <div>
            {t("misc.showing")} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {t("table.of")} {total} {t("misc.results")}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(1)}>
              <First className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <Prev className="h-4 w-4" />
            </Button>
            <div className="px-3 text-xs font-medium text-foreground">
              {t("table.page")} {page} {t("table.of")} {totalPages}
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              <Next className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>
              <Last className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
