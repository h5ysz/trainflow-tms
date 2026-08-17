"use client";

// GCCLAB TMS — Course Detail page
// =====================================================================
// Shows a course's information plus its Course Materials (Phase 1):
// PDF / PowerPoint / Word files uploaded by trainers. Reached from the
// courses list (RowActions → View).
//
//   - The materials section (list, open, AI generator) requires
//     course-materials.view — curriculum + AI test generation are trainer-only
//     (Super Admin / Trainer).
//   - Upload, replace and delete require course-materials.create/edit/delete.
import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction, type Action } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, ArrowLeft, Upload, Loader2, AlertCircle, FileText, Presentation,
  FileType, Trash2, RefreshCw, ExternalLink, FilePlus2, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { QuestionGeneratorDialog } from "@/components/ai/question-generator-dialog";

interface CourseMaterial {
  id: string;
  type: string;
  title: string;
  url: string;
  fileName?: string | null;
  fileSize?: number | null;
  fileMime?: string | null;
  createdAt: string;
}

interface CourseDetail {
  id: string;
  refNumber: string;
  code: string;
  title: string;
  titleAr?: string | null;
  description?: string | null;
  category?: string | null;
  durationHours?: number | null;
  language?: string | null;
  validityMonths?: number | null;
  passScore?: number | null;
  maxTrainees?: number | null;
  status?: string;
  hasPreTest?: boolean;
  hasFinalTest?: boolean;
  hasEvaluation?: boolean;
  _count?: { requests?: number; sessions?: number; certificates?: number; questions?: number };
}

const ACCEPT = ".pdf,.ppt,.pptx,.doc,.docx";
const MATERIAL_TYPES = ["PDF", "POWERPOINT", "WORD"];

function formatSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtValidity(validityMonths?: number | null, t?: (key: any) => string): string {
  if (validityMonths == null) return "—";
  if (validityMonths === 0) return t ? t("courses.neverExpires") : "Never Expires";
  if (validityMonths < 12) return `${validityMonths}m`;
  const years = validityMonths / 12;
  return Number.isInteger(years) ? `${years}y` : `${years.toFixed(1)}y`;
}

function MaterialIcon({ type }: { type: string }) {
  if (type === "PDF") return <FileText className="h-4 w-4 text-destructive" />;
  if (type === "POWERPOINT") return <Presentation className="h-4 w-4 text-warning" />;
  if (type === "WORD") return <FileType className="h-4 w-4 text-info" />;
  return <FileType className="h-4 w-4 text-muted-foreground" />;
}

export function CourseDetailRoute() {
  const { t } = useI18n();
  const { routeParam: courseId, navigate, user } = useAppStore();
  const { toast } = useToast();

  // Materials management is gated on the dedicated course-materials module (not
  // courses.edit): trainers can manage the files of their own courses.
  const canManage = user
    ? (["create", "edit", "delete"] as Action[]).some((a) => canPerformAction(user.permissions, "course-materials", a))
    : false;

  // Curriculum + AI test generation are trainer-only — hide the whole section
  // (and never fetch the list) for anyone without course-materials.view.
  const canViewMaterials = user ? canPerformAction(user.permissions, "course-materials", "view") : false;

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseMaterial | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setError(null);
    try {
      const c = await api.get<CourseDetail>(`/courses/${courseId}`);
      setCourse(c);
      if (canViewMaterials) {
        const m = await api.get<CourseMaterial[]>(`/courses/${courseId}/materials`);
        setMaterials(m);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [courseId, canViewMaterials]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.postFile<CourseMaterial>(`/courses/${courseId}/materials`, file);
      toast({ title: t("courses.uploadSuccess") });
      await load();
    } catch (e) {
      toast({ title: t("courses.uploadError"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const handleReplace = async (file: File, materialId: string) => {
    setReplacingId(materialId);
    try {
      await api.putFile<CourseMaterial>(`/courses/${courseId}/materials/${materialId}`, file);
      toast({ title: t("courses.replaceSuccess") });
      await load();
    } catch (e) {
      toast({ title: t("courses.uploadError"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setReplacingId(null);
      const el = replaceInputsRef.current[materialId];
      if (el) el.value = "";
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/courses/${courseId}/materials/${deleteTarget.id}`);
      toast({ title: t("courses.deleteSuccess") });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast({ title: t("courses.uploadError"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !course) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("table.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("courses.detailTitle")} icon={BookOpen} />
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      </div>
    );
  }

  const Back = ArrowLeft;

  return (
    <div className="space-y-5">
      <PageHeader
        title={course ? `${course.code} — ${course.title}` : t("courses.detailTitle")}
        subtitle={course ? `${course.refNumber} · ${course.category || "—"}` : undefined}
        icon={BookOpen}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("courses")}>
            <Back className="h-4 w-4 me-1.5 rtl:rotate-180" />
            {t("courses.backToCourses")}
          </Button>
        }
      />

      {/* ─── Course information ───────────────────────────────────────── */}
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <InfoItem label={t("courses.refNumber")} value={course?.refNumber} />
          <InfoItem label={t("courses.code")} value={course?.code} />
          <InfoItem label={t("courses.title2")} value={course?.title} />
          <InfoItem label={t("courses.titleAr")} value={course?.titleAr} />
          <InfoItem label={t("courses.category")} value={course?.category} />
          <InfoItem
            label={t("courses.durationHours")}
            value={course?.durationHours != null ? `${course.durationHours}h` : "—"}
          />
          <InfoItem label={t("courses.language")} value={course?.language ?? "—"} />
          <InfoItem
            label={t("courses.certificateValidity")}
            value={fmtValidity(course?.validityMonths, t)}
          />
          <InfoItem
            label={t("courses.passScore")}
            value={course?.passScore != null ? `${course.passScore}%` : "—"}
          />
          <InfoItem
            label={t("courses.maxTrainees")}
            value={course?.maxTrainees != null ? String(course.maxTrainees) : "—"}
          />
        </div>

        {course?.description && (
          <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">{course.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {course?.status && <StatusBadge status={course.status} />}
          {course?.hasPreTest && <Badge variant="secondary">{t("courses.hasPreTest")}</Badge>}
          {course?.hasFinalTest && <Badge variant="secondary">{t("courses.hasFinalTest")}</Badge>}
          {course?.hasEvaluation && <Badge variant="secondary">{t("courses.hasEvaluation")}</Badge>}
          {course?._count?.sessions != null && (
            <Badge variant="outline">{course._count.sessions} {t("sessions.title")}</Badge>
          )}
          {course?._count?.questions != null && (
            <Badge variant="outline">{course._count.questions} {t("exam.questions")}</Badge>
          )}
        </div>
      </Card>

      {/* ─── Course materials (trainer-only) ─────────────────────────── */}
      {canViewMaterials && (
        <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t("courses.materialsTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("courses.materialsSubtitle")}</p>
          </div>
          {canManage && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
              />
              <Button size="sm" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Upload className="h-4 w-4 me-1.5" />}
                {uploading ? t("courses.uploading") : t("courses.uploadMaterial")}
              </Button>
              <Button size="sm" variant="outline" disabled={materials.length === 0} onClick={() => setShowGenerator(true)}>
                <Sparkles className="h-4 w-4 me-1.5" />
                {t("courses.aiGenerate")}
              </Button>
            </>
          )}
        </div>

        {canManage && (
          <p className="mt-2 text-xs text-muted-foreground">{t("courses.uploadAllowedHint")}</p>
        )}

        <div className="mt-4 space-y-2">
          {materials.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <FilePlus2 className="h-4 w-4" /> {t("courses.noMaterials")}
            </div>
          ) : (
            materials.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <MaterialIcon type={m.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.fileName ?? m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`courses.materialType.${m.type}` as never)}
                    {" · "}
                    {formatSize(m.fileSize)}
                    {" · "}
                    {t("courses.uploadedAt")}: {fmtDate(m.createdAt)}
                  </p>
                </div>

                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {t("courses.openMaterial")}
                </a>

                {canManage && (
                  <>
                    <input
                      ref={(el) => { replaceInputsRef.current[m.id] = el; }}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleReplace(f, m.id);
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={replacingId === m.id}
                      onClick={() => replaceInputsRef.current[m.id]?.click()}
                    >
                      {replacingId === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5 me-1" />
                      )}
                      {replacingId === m.id ? t("courses.replacing") : t("courses.replaceMaterial")}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(m)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </Card>

      <QuestionGeneratorDialog
        open={showGenerator}
        onOpenChange={setShowGenerator}
        courseId={courseId ?? ""}
        materials={materials}
        onApproved={() => void load()}
      />
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("courses.deleteMaterial")}
        description={deleteTarget ? t("courses.deleteMaterialConfirm") : undefined}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium" title={value ?? ""}>{value || "—"}</p>
    </div>
  );
}
