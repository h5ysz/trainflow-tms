"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Session History Tab
// ─────────────────────────────────────────────────────────────────────────────
// Renders the audit trail for a single session. Calls
// GET /api/sessions/[id]/audit and displays each entry with the user, the
// timestamp, the action description, and the before/after/metadata payloads.
//
// Per the approved design, this is a DEDICATED tab — not inside Manage.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api/client";
import { History, AlertCircle, Loader2, UserCircle, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  entityRef: string | null;
  description: string;
  descriptionAr: string | null;
  ipAddress: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

interface AuditResponse {
  session: { id: string; refNumber: string };
  audit: AuditEntry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

// Map audit `action` + `metadata.action` to a short label + color.
function getActionBadge(entry: AuditEntry): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const meta = entry.metadata as { action?: string } | null;
  const sub = meta?.action;
  if (sub === "SPLIT_SESSION") return { label: "Split", variant: "secondary" };
  if (sub === "MERGE_SESSIONS") return { label: "Merge", variant: "secondary" };
  if (sub === "MOVE_TRAINEES") return { label: "Move", variant: "secondary" };
  if (sub === "ASSEMBLE_SESSION") return { label: "Assemble", variant: "default" };
  if (sub === "GENERATE_SESSIONS") return { label: "Generate", variant: "default" };
  if (sub === "ASSIGN_TRAINER") return { label: "Assign", variant: "default" };
  if (sub === "REPLACE_TRAINER") return { label: "Replace", variant: "default" };
  if (sub === "REMOVE_TRAINER") return { label: "Remove", variant: "destructive" };
  if (entry.action === "CREATE") return { label: "Create", variant: "default" };
  if (entry.action === "UPDATE") return { label: "Update", variant: "outline" };
  if (entry.action === "DELETE") return { label: "Delete", variant: "destructive" };
  if (entry.action === "APPROVE") return { label: "Approve", variant: "default" };
  if (entry.action === "REJECT") return { label: "Reject", variant: "destructive" };
  if (entry.action === "STATUS_CHANGE") return { label: "Status", variant: "secondary" };
  return { label: entry.action, variant: "outline" };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function SessionHistoryTab({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async (pageNum: number) => {
    if (!sessionId) return;
    // Set loading=true at the start so pagination buttons disable during
    // page fetches (prevents rapid-click race conditions).
    setLoading(true);
    try {
      const res = await api.get<AuditResponse>(`/sessions/${sessionId}/audit`, {
        page: pageNum,
        pageSize: 50,
      });
      setEntries(res.audit);
      setPage(res.pagination.page);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
      setError(null);
      setLoadedFor(sessionId);
    } catch (e) {
      setError((e as Error).message);
      setLoadedFor(sessionId);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Derive loading from loadedFor — when sessionId changes and loadedFor
  // doesn't match, we're still loading (or about to). This avoids calling
  // setState synchronously in the effect (React 19 set-state-in-effect).
  const needsLoad = sessionId !== loadedFor;
  const effectiveLoading = loading || needsLoad;

  // Kick off the fetch when sessionId changes. We don't call setState
  // synchronously in the effect body — `effectiveLoading` covers the
  // loading state for the first render, and `load()` only calls setState
  // inside its async resolution callbacks (which run after the effect
  // has already yielded).
  useEffect(() => {
    if (!sessionId || loadedFor === sessionId) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (!cancelled) void load(1);
    }, 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [load, loadedFor, sessionId]);

  if (effectiveLoading && entries.length === 0) {
    return (
      <Card className="p-8 flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 me-2 animate-spin" />
        {t("session.historyLoading")}
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="p-8 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
        <History className="h-8 w-8 opacity-40" />
        {t("session.historyEmpty")}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              {t("session.historyTitle")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">{t("session.historyHint")}</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {t("session.historyPage", { page, total: totalPages })} · {total} {t("session.historyAction")}
          </div>
        </div>
      </Card>

      {/* Timeline of audit entries */}
      <div className="space-y-3">
        {entries.map((entry) => {
          const badge = getActionBadge(entry);
          return (
            <Card key={entry.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-sm font-medium">{entry.description}</span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <UserCircle className="h-3 w-3" />
                    {entry.userName ?? "—"}
                    {entry.userRole && <span className="opacity-70">({entry.userRole})</span>}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Arabic description (if present and locale is AR) */}
              {entry.descriptionAr && (
                <div className="text-xs text-muted-foreground mt-1" dir="rtl">{entry.descriptionAr}</div>
              )}

              {/* Before / After / Metadata — only show the populated ones */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(entry.oldValue !== null && entry.oldValue !== undefined) && (
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                      {t("session.historyBefore")}
                    </div>
                    <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto max-h-40">
                      {formatValue(entry.oldValue)}
                    </pre>
                  </div>
                )}
                {(entry.newValue !== null && entry.newValue !== undefined) && (
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                      {t("session.historyAfter")}
                    </div>
                    <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto max-h-40">
                      {formatValue(entry.newValue)}
                    </pre>
                  </div>
                )}
                {entry.metadata !== null && entry.metadata !== undefined && (
                  <div className="sm:col-span-2">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                      {t("session.historyMetadata")}
                    </div>
                    <pre className="text-[10px] bg-muted/30 rounded p-2 overflow-x-auto max-h-40">
                      {formatValue(entry.metadata)}
                    </pre>
                  </div>
                )}
              </div>

              {entry.reason && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">Reason: </span>{entry.reason}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || effectiveLoading}
            onClick={() => void load(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("session.historyPage", { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || effectiveLoading}
            onClick={() => void load(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
