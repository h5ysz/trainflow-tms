"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { CalendarRange, ChevronLeft, ChevronRight, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api/client";

interface SessionItem {
  id: string;
  sessionCode: string;
  title: string;
  courseTitle?: string | null;
  trainerName?: string | null;
  startDate: string;
  endDate: string;
  status: string;
  location?: string | null;
}

type View = "month" | "week" | "day" | "list";

export function SchedulingRoute() {
  const { t, dir, locale } = useI18n();
  const [view, setView] = useState<View>("month");
  const [current, setCurrent] = useState(new Date());
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Compute month range
    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59);
    api.getList<SessionItem>("/sessions", {
      pageSize: 200,
      from: start.toISOString(),
      to: end.toISOString(),
    }).then((r) => {
      if (cancelled) return;
      setSessions(r.rows ?? []);
    }).catch(() => {
      if (cancelled) return;
      setSessions([]);
    }).finally(() => {
      if (cancelled) return;
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [current]);

  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;

  const views: { key: View; label: string }[] = [
    { key: "month", label: t("scheduling.month") },
    { key: "week", label: t("scheduling.week") },
    { key: "day", label: t("scheduling.day") },
    { key: "list", label: t("scheduling.list") },
  ];

  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = current.toLocaleDateString(locale === "ar" ? "ar" : "en-US", { month: "long", year: "numeric" });
  const weekDays = locale === "ar"
    ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  const sessionsOn = (date: Date) => sessions.filter((s) => {
    const sd = new Date(s.startDate);
    return sd.toDateString() === date.toDateString();
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("scheduling.title")}
        subtitle={t("scheduling.subtitle")}
        icon={CalendarRange}
        actions={<Button><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
      />

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrent(new Date())}>
              <CalendarRange className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrent(new Date(year, month - 1, 1))}>
              <Prev className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrent(new Date(year, month + 1, 1))}>
              <Next className="h-4 w-4" />
            </Button>
            <div className="text-base font-semibold ms-2">{monthName}</div>
          </div>
          <div className="flex items-center gap-1 rounded-md border p-0.5 bg-muted/30">
            {views.map((v) => (
              <Button key={v.key} size="sm" variant={view === v.key ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setView(v.key)}>
                {v.label}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : view === "list" ? (
          sessions.length === 0 ? (
            <EmptyState icon={CalendarRange} title={t("scheduling.empty")} className="py-12" />
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted/30">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-info/10 text-info shrink-0">
                    <CalendarRange className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{s.sessionCode}</span>
                      {s.courseTitle && <span> · {s.courseTitle}</span>}
                      {s.trainerName && <span> · {s.trainerName}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground text-end shrink-0">{new Date(s.startDate).toLocaleDateString()}</div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {weekDays.map((d) => (
                <div key={d} className="text-center text-[11px] font-semibold uppercase text-muted-foreground py-1.5">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                if (!date) return <div key={i} className="aspect-square sm:aspect-[4/3] rounded-md bg-muted/20" />;
                const isToday = date.toDateString() === today.toDateString();
                const daySessions = sessionsOn(date);
                return (
                  <div
                    key={i}
                    className={cn(
                      "aspect-square sm:aspect-[4/3] rounded-md border p-1.5 text-start transition-colors hover:border-primary/40 overflow-hidden flex flex-col",
                      isToday ? "border-primary bg-primary/5" : "border-border"
                    )}
                  >
                    <div className={cn("text-xs font-medium", isToday ? "text-primary" : "text-muted-foreground")}>
                      {date.getDate()}
                    </div>
                    <div className="mt-1 space-y-0.5 overflow-hidden">
                      {daySessions.slice(0, 2).map((s) => (
                        <div key={s.id} className="text-[9px] truncate rounded bg-primary/10 text-primary px-1 py-0.5">
                          {s.title}
                        </div>
                      ))}
                      {daySessions.length > 2 && (
                        <div className="text-[9px] text-muted-foreground">+{daySessions.length - 2} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
