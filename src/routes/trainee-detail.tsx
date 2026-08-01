"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Trainee Detail Route
// ─────────────────────────────────────────────────────────────────────────────
// Displays a single trainee's profile + training history. Reached from the
// trainees list (RowActions → View). Two tabs:
//
//   1. Profile — trainee info, company, ID attachment
//   2. Training History — every session enrollment with attendance, exam
//      scores, certificate, re-exam indicator, contractor at the time
//
// The history tab supports the Re-Exam workflow: coordinators can see which
// sessions a trainee has attended, which they failed, and which are re-exams.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/api/client";
import { canPerformAction } from "@/lib/auth/permissions";
import {
  ArrowLeft, ArrowRight, UserCircle, Building2, IdCard, FileText,
  Award, RotateCcw, Calendar, GraduationCap, AlertCircle, Loader2,
  Download, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TraineeInfo {
  id: string;
  refNumber: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
  idAttachmentUrl?: string | null;
  status: string;
  companyId: string;
  company?: { id: string; name: string; refNumber: string } | null;
}

interface HistoryEntry {
  enrollmentId: string;
  enrollmentDate: string;
  enrollmentStatus: string;
  isReExam: boolean;
  isDeleted: boolean;
  session: {
    id: string;
    refNumber: string;
    title: string;
    startDate: string;
    endDate: string;
    shift: string | null;
    status: string;
    lifecycleStatus: string;
    venue: string | null;
    city: string | null;
  };
  course: { id: string; title: string; code: string; refNumber: string } | null;
  trainer: { id: string; fullName: string; refNumber: string } | null;
  company: { id: string; name: string; refNumber: string } | null;
  attendanceStatus: string;
  preTestStatus: string;
  finalTestStatus: string;
  evaluationStatus: string;
  certificateStatus: string;
  certificate: {
    id: string;
    refNumber: string;
    finalScore: number;
    issuedAt: string;
    validUntil: string;
    status: string;
    version: number;
    pdfUrl: string | null;
  } | null;
  notes: string | null;
}

interface HistoryResponse {
  trainee: TraineeInfo;
  history: HistoryEntry[];
  certificates: Array<{
    id: string;
    refNumber: string;
    finalScore: number;
    issuedAt: string;
    validUntil: string;
    status: string;
    version: number;
    pdfUrl: string | null;
    course: { id: string; title: string; code: string } | null;
  }>;
  summary: {
    totalSessions: number;
    reExamCount: number;
    passedCount: number;
    failedCount: number;
    certificatesIssued: number;
    attendedCount: number;
  };
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case "PASSED":
    case "COMPLETED":
    case "PRESENT":
    case "VALID":
    case "ISSUED":
    case "GENERATED":
      return "bg-success/15 text-success";
    case "FAILED":
    case "ABSENT":
    case "NO_SHOW":
    case "EXPIRED":
    case "REVOKED":
    case "CANCELLED":
      return "bg-destructive/15 text-destructive";
    case "PENDING":
    case "NOT_STARTED":
    case "NOT_ELIGIBLE":
    case "NOT_REQUIRED":
      return "bg-muted text-muted-foreground";
    case "IN_PROGRESS":
    case "TRAINING":
    case "CHECKED_IN":
    case "ELIGIBLE":
      return "bg-info/15 text-info";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function TraineeDetailRoute() {
  const { t, dir } = useI18n();
  const { user, routeParam, navigate } = useAppStore();
  const traineeId = routeParam;

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const canEdit = user ? canPerformAction(user.permissions, "trainees", "edit") : false;
  const Back = dir === "rtl" ? ArrowLeft : ArrowRight;

  const load = useCallback(async () => {
    if (!traineeId) return;
    try {
      const res = await api.get<HistoryResponse>(`/trainees/${traineeId}/history`);
      setData(res);
      setError(null);
      setLoadedFor(traineeId);
    } catch (e) {
      setError((e as Error).message);
      setLoadedFor(traineeId);
    } finally {
      setLoading(false);
    }
  }, [traineeId]);

  useEffect(() => {
    if (!traineeId || loadedFor === traineeId) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [load, loadedFor, traineeId]);

  if (!traineeId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <UserCircle className="h-12 w-12 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No trainee selected.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("trainees")}>
          <Back className="h-4 w-4 me-1.5" /> {t("nav.trainees")}
        </Button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-3" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("trainees")}>
          <Back className="h-4 w-4 me-1.5" /> {t("nav.trainees")}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { trainee, history, summary } = data;
  const activeHistory = history.filter((h) => !h.isDeleted);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("trainees")}>
          <Back className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserCircle className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{trainee.fullName}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{trainee.refNumber}</span>
              <span>·</span>
              <span>{trainee.nationalId}</span>
              {trainee.company && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> {trainee.company.name}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{summary.totalSessions}</div>
          <div className="text-xs text-muted-foreground">Sessions</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-success">{summary.passedCount}</div>
          <div className="text-xs text-muted-foreground">Passed</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-destructive">{summary.failedCount}</div>
          <div className="text-xs text-muted-foreground">Failed</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold tabular-nums text-info">{summary.reExamCount}</div>
          <div className="text-xs text-muted-foreground">Re-Exams</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{summary.attendedCount}</div>
          <div className="text-xs text-muted-foreground">Attended</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold tabular-nums">{summary.certificatesIssued}</div>
          <div className="text-xs text-muted-foreground">Certificates</div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t("trainee.profile")}</TabsTrigger>
          <TabsTrigger value="history">{t("trainee.trainingHistory")}</TabsTrigger>
        </TabsList>

        {/* Profile tab */}
        <TabsContent value="profile" className="mt-4">
          <Card className="p-6 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label={t("trainee.fullName")} value={trainee.fullName} icon={UserCircle} />
              <DetailField label={t("trainee.nationalId")} value={trainee.nationalId} icon={IdCard} />
              <DetailField label={t("trainee.nationality")} value={trainee.nationality} />
              <DetailField label={t("trainee.jobTitle")} value={trainee.jobTitle} />
              <DetailField label={t("trainee.mobile")} value={trainee.mobile} />
              <DetailField label={t("trainee.email")} value={trainee.email} />
              <DetailField label={t("trainee.company")} value={trainee.company?.name} icon={Building2} />
              <DetailField label={t("trainee.status")} value={trainee.status} />
            </div>

            {/* ID Attachment */}
            {trainee.idAttachmentUrl && (
              <div className="mt-4 border-t pt-4">
                <div className="text-xs font-medium mb-2 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" /> {t("trainee.idAttachment")}
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={trainee.idAttachmentUrl} target="_blank" rel="noreferrer">
                      <Eye className="h-3.5 w-3.5 me-1.5" /> {t("requests.review.preview")}
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <a href={trainee.idAttachmentUrl} target="_blank" rel="noreferrer" download>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Training History tab */}
        <TabsContent value="history" className="mt-4">
          {activeHistory.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              {t("trainee.noHistory")}
            </Card>
          ) : (
            <div className="space-y-3">
              {activeHistory.map((entry) => (
                <Card key={entry.enrollmentId} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* Left: session info */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                        entry.isReExam ? "bg-info/10 text-info" : "bg-primary/10 text-primary"
                      )}>
                        {entry.isReExam ? <RotateCcw className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {entry.course?.title ?? entry.session.title}
                          </span>
                          {entry.isReExam && (
                            <Badge variant="outline" className="text-info border-info/30">
                              <RotateCcw className="h-3 w-3 me-1" /> {t("session.reExam")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className="font-mono">{entry.session.refNumber}</span>
                          <span>·</span>
                          <Calendar className="h-3 w-3" />
                          <span>{fmtDate(entry.session.startDate)} → {fmtDate(entry.session.endDate)}</span>
                          {entry.session.shift && <span>· {entry.session.shift}</span>}
                        </div>
                        {entry.trainer && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <GraduationCap className="h-3 w-3" /> {entry.trainer.fullName}
                          </div>
                        )}
                        {entry.company && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3" /> {entry.company.name}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: status badges */}
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <StatusBadge status={entry.session.status} />
                      <Badge className={cn("text-xs", statusBadgeColor(entry.attendanceStatus))}>
                        {entry.attendanceStatus}
                      </Badge>
                      <Badge className={cn("text-xs", statusBadgeColor(entry.finalTestStatus))}>
                        {entry.finalTestStatus}
                      </Badge>
                      {entry.certificate && (
                        <Badge className={cn("text-xs", statusBadgeColor(entry.certificate.status))}>
                          <Award className="h-3 w-3 me-1" />
                          {entry.certificate.refNumber}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Scores row */}
                  {entry.certificate && (
                    <div className="mt-3 pt-3 border-t flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{t("trainee.finalScore")}: <span className="font-semibold text-foreground">{entry.certificate.finalScore}</span></span>
                      <span>{t("trainee.issuedAt")}: {fmtDate(entry.certificate.issuedAt)}</span>
                      <span>{t("trainee.validUntil")}: {fmtDate(entry.certificate.validUntil)}</span>
                      {entry.certificate.version > 1 && <span>{t("trainee.version")}: {entry.certificate.version}</span>}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetailField({ label, value, icon: Icon }: {
  label: string;
  value?: string | null;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="text-sm font-medium break-words">
        {value === null || value === undefined || value === "" ? "—" : value}
      </div>
    </div>
  );
}
