"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { CalendarRange, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "day" | "list";

export function SchedulingRoute() {
  const { t, dir } = useI18n();
  const [view, setView] = useState<View>("month");
  const [current, setCurrent] = useState(new Date());

  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;

  const views: { key: View; label: string }[] = [
    { key: "month", label: t("scheduling.month") },
    { key: "week", label: t("scheduling.week") },
    { key: "day", label: t("scheduling.day") },
    { key: "list", label: t("scheduling.list") },
  ];

  // Build month grid
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = current.toLocaleDateString(dir === "ar" ? "ar" : "en-US", { month: "long", year: "numeric" });
  const weekDays = dir === "ar"
    ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("scheduling.title")}
        subtitle={t("scheduling.subtitle")}
        icon={CalendarRange}
        actions={<Button><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
      />

      <Card className="p-4">
        {/* Toolbar */}
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
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? "default" : "ghost"}
                className="h-7 text-xs"
                onClick={() => setView(v.key)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </div>

        {view === "list" ? (
          <EmptyState
            icon={CalendarRange}
            title={t("scheduling.empty")}
            className="py-12"
          />
        ) : (
          <>
            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {weekDays.map((d) => (
                <div key={d} className="text-center text-[11px] font-semibold uppercase text-muted-foreground py-1.5">
                  {d}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                if (!date) return <div key={i} className="aspect-square sm:aspect-[4/3] rounded-md bg-muted/20" />;
                const isToday = date.toDateString() === today.toDateString();
                return (
                  <div
                    key={i}
                    className={cn(
                      "aspect-square sm:aspect-[4/3] rounded-md border p-1.5 text-start transition-colors hover:border-primary/40",
                      isToday ? "border-primary bg-primary/5" : "border-border"
                    )}
                  >
                    <div className={cn(
                      "text-xs font-medium",
                      isToday ? "text-primary" : "text-muted-foreground"
                    )}>
                      {date.getDate()}
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
