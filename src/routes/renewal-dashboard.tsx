"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Clock, Calendar, CheckCircle, RefreshCw, Loader2,
  History, FileText, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RenewalCert {
  id: string;
  refNumber: string;
  traineeName: string;
  traineeIdNational: string | null;
  courseCode: string;
  courseTitle: string;
  companyName: string | null;
  issuedAt: string;
  validUntil: string;
  daysRemaining: number;
  version: number;
  status: string;
}

interface RenewalData {
  summary: {
    expiringTodayCount: number;
    expiringThisWeekCount: number;
    expiringThisMonthCount: number;
    alreadyExpiredCount: number;
    totalActive: number;
    totalExpired: number;
    totalRenewed: number;
  };
  expiringToday: RenewalCert[];
  expiringThisWeek: RenewalCert[];
  expiringThisMonth: RenewalCert[];
  alreadyExpired: RenewalCert[];
}

type TabKey = "today" | "week" | "month" | "expired";

export function RenewalDashboardRoute() {
  const { locale } = useI18n();
  const { navigate } = useAppStore();
  const [data, setData] = useState<RenewalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("today");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/renewal/dashboard", { credentials: "same-origin" });
      const json = await resp.json();
      if (json.success) setData(json.data);
      else setError(json.error || "Failed to load");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tabs: Array<{ key: TabKey; labelEn: string; labelAr: string; count: number; color: string }> = [
    { key: "today", labelEn: "Expiring Today", labelAr: "تنتهي اليوم", count: data?.summary.expiringTodayCount ?? 0, color: "text-red-600" },
    { key: "week", labelEn: "This Week", labelAr: "هذا الأسبوع", count: data?.summary.expiringThisWeekCount ?? 0, color: "text-orange-600" },
    { key: "month", labelEn: "This Month", labelAr: "هذا الشهر", count: data?.summary.expiringThisMonthCount ?? 0, color: "text-amber-600" },
    { key: "expired", labelEn: "Already Expired", labelAr: "منتهية بالفعل", count: data?.summary.alreadyExpiredCount ?? 0, color: "text-red-700" },
  ];

  const currentList = data ? (
    activeTab === "today" ? data.expiringToday :
    activeTab === "week" ? data.expiringThisWeek :
    activeTab === "month" ? data.expiringThisMonth :
    data.alreadyExpired
  ) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={locale === "en" ? "Renewal Center" : "مركز التجديد"}
        subtitle={locale === "en" ? "Monitor certificate expiries and manage renewals" : "مراقبة انتهاء الشهادات وإدارة التجديدات"}
        actions={
          <Button size="sm" variant="outline" onClick={fetchData} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {locale === "en" ? "Refresh" : "تحديث"}
          </Button>
        }
      />

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-red-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-red-600">{data.summary.expiringTodayCount}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "Today" : "اليوم"}</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-5 w-5 text-orange-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-orange-600">{data.summary.expiringThisWeekCount}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "This Week" : "الأسبوع"}</p>
          </Card>
          <Card className="p-3 text-center">
            <Calendar className="h-5 w-5 text-amber-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-amber-600">{data.summary.expiringThisMonthCount}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "This Month" : "الشهر"}</p>
          </Card>
          <Card className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-red-700 mx-auto mb-1" />
            <p className="text-xl font-bold text-red-700">{data.summary.alreadyExpiredCount}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "Expired" : "منتهية"}</p>
          </Card>
          <Card className="p-3 text-center">
            <CheckCircle className="h-5 w-5 text-green-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-green-600">{data.summary.totalActive}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "Active" : "سارية"}</p>
          </Card>
          <Card className="p-3 text-center">
            <History className="h-5 w-5 text-blue-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-blue-600">{data.summary.totalRenewed}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "Renewed" : "مجددة"}</p>
          </Card>
          <Card className="p-3 text-center">
            <FileText className="h-5 w-5 text-gray-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-gray-600">{data.summary.totalExpired}</p>
            <p className="text-[10px] text-muted-foreground">{locale === "en" ? "Total Expired" : "إجمالي المنتهية"}</p>
          </Card>
        </div>
      )}

      {/* Tab buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={activeTab === tab.key ? "default" : "outline"}
            onClick={() => setActiveTab(tab.key)}
            className="gap-1.5"
          >
            <span>{locale === "en" ? tab.labelEn : tab.labelAr}</span>
            <Badge variant="outline" className={cn("text-xs", activeTab === tab.key ? "bg-white/20" : tab.color)}>
              {tab.count}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Certificate list */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-10 w-10 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <Card className="p-6 text-center text-destructive">{error}</Card>
      ) : currentList.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {locale === "en" ? "No certificates in this category" : "لا توجد شهادات في هذه الفئة"}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {currentList.map((cert) => {
            const isExpired = cert.daysRemaining < 0 || cert.status === "EXPIRED";
            const isUrgent = !isExpired && cert.daysRemaining <= 7;
            return (
              <Card key={cert.id} className={cn("p-3 hover:shadow-md transition-shadow", isExpired && "border-red-200", isUrgent && "border-orange-200")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{cert.traineeName}</span>
                      {cert.version > 1 && (
                        <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-600">v{cert.version}</Badge>
                      )}
                      <Badge variant="outline" className={cn(
                        "text-xs",
                        isExpired ? "bg-red-50 text-red-700" :
                        isUrgent ? "bg-orange-50 text-orange-700" :
                        "bg-amber-50 text-amber-700"
                      )}>
                        {isExpired
                          ? (locale === "en" ? "EXPIRED" : "منتهية")
                          : `${cert.daysRemaining}d ${locale === "en" ? "left" : "متبقي"}`}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{cert.refNumber}</span>
                      <span>{cert.courseTitle}</span>
                      {cert.companyName && <span>{cert.companyName}</span>}
                      <span>{locale === "en" ? "Expiry:" : "انتهاء:"} {new Date(cert.validUntil).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 text-xs"
                      onClick={() => navigate("certificates" as never)}
                    >
                      {locale === "en" ? "Renew" : "تجديد"}
                      <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Notification schedule info */}
      <Card className="p-4 bg-muted/30">
        <h3 className="text-sm font-semibold mb-2">{locale === "en" ? "Automatic Notification Schedule" : "جدول الإشعارات التلقائية"}</h3>
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          {[
            { days: 90, label: locale === "en" ? "90 days" : "٩٠ يوم" },
            { days: 60, label: locale === "en" ? "60 days" : "٦٠ يوم" },
            { days: 30, label: locale === "en" ? "30 days" : "٣٠ يوم" },
            { days: 7, label: locale === "en" ? "7 days" : "٧ أيام" },
            { days: 1, label: locale === "en" ? "1 day" : "يوم واحد" },
            { days: 0, label: locale === "en" ? "Expired" : "منتهية" },
          ].map((s, i) => (
            <span key={s.days} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <Badge variant="outline" className={s.days === 0 ? "bg-red-50 text-red-600" : s.days <= 7 ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}>
                {s.label}
              </Badge>
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {locale === "en"
            ? "Notifications sent to: Trainee, Company, GCCLAB Coordinator, Administrator"
            : "تُرسل الإشعارات إلى: المتدرب، الشركة، منسق GCCLAB، المدير"}
        </p>
      </Card>
    </div>
  );
}
