"use client";

import { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck, Plus, Pencil, Trash2, Copy, History, Loader2, AlertCircle, Lock, Archive, X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface MatrixRow {
  id: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  clientName: string | null;
  jobPosition: string | null;
  projectName: string | null;
  version: number;
  isActive: boolean;
  isArchived: boolean;
  _count: { courseRequirements: number; versions: number };
  createdAt: string;
}

interface CourseOption { id: string; code: string; title: string; }

interface CourseReq {
  courseId: string;
  isMandatory: boolean;
  validityMonths: number;
  renewalRequired: boolean;
  gracePeriodDays: number;
  priority: string;
}

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

export function TrainingMatrixRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [matrices, setMatrices] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formData, setFormData] = useState<Partial<MatrixRow> & { courseRequirements: CourseReq[]; siteName?: string }>({ courseRequirements: [] });
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<MatrixRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<unknown[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const canAccess = canAccessModule((user?.permissions ?? []) as never, "compliance-matrix");
  const canManage = user?.role === "SUPER_ADMIN";

  const fetchMatrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MatrixRow[]>("/training-matrices");
      setMatrices(data);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  if (matrices.length === 0 && !loading && !error) fetchMatrices();

  const openCreate = async () => {
    setFormMode("create");
    setFormData({ isActive: true, courseRequirements: [] });
    try {
      const courseList = await api.get<CourseOption[]>("/courses?pageSize=100");
      setCourses(courseList);
    } catch { /* ignore */ }
    setFormOpen(true);
  };

  const openEdit = async (row: MatrixRow) => {
    setFormMode("edit");
    try {
      const detail = await api.get<MatrixRow & { courseRequirements: Array<{ courseId: string; isMandatory: boolean; validityMonths: number; renewalRequired: boolean; gracePeriodDays: number; priority: string; course: { id: string; code: string; title: string } }> }>("/training-matrices/" + row.id);
      setFormData({
        ...detail,
        courseRequirements: detail.courseRequirements?.map((cr) => ({
          courseId: cr.courseId, isMandatory: cr.isMandatory, validityMonths: cr.validityMonths,
          renewalRequired: cr.renewalRequired, gracePeriodDays: cr.gracePeriodDays, priority: cr.priority,
        })) ?? [],
      });
      const courseList = await api.get<CourseOption[]>("/courses?pageSize=100");
      setCourses(courseList);
    } catch (e) { toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" }); }
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!formData.name) { toast({ title: t("misc.error"), description: "Name is required", variant: "destructive" }); return; }
    setActionLoading("form");
    try {
      if (formMode === "create") {
        await api.post("/training-matrices", formData);
        toast({ title: t("misc.success"), description: "Matrix created" });
      } else if (formData.id) {
        await api.put(`/training-matrices/${formData.id}`, formData);
        toast({ title: t("misc.success"), description: "Matrix updated" });
      }
      setFormOpen(false); fetchMatrices();
    } catch (e) { toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" }); }
    finally { setActionLoading(null); }
  };

  const handleDuplicate = async (row: MatrixRow) => {
    setActionLoading(row.id + "dup");
    try { await api.post(`/training-matrices/${row.id}/duplicate`, { name: `${row.name} (Copy)` });
      toast({ title: t("misc.success"), description: "Matrix duplicated" }); fetchMatrices();
    } catch (e) { toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" }); }
    finally { setActionLoading(null); }
  };

  const handleArchive = async () => {
    if (!confirmArchive) return;
    setActionLoading(confirmArchive.id + "archive");
    try { await api.delete(`/training-matrices/${confirmArchive.id}`);
      toast({ title: t("misc.success"), description: "Matrix archived" });
      setConfirmArchive(null); fetchMatrices();
    } catch (e) { toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" }); }
    finally { setActionLoading(null); }
  };

  const openHistory = async (row: MatrixRow) => {
    setHistoryOpen(true); setHistoryLoading(true); setHistoryData([]);
    try { const data = await api.get<unknown[]>(`/training-matrices/${row.id}/versions`); setHistoryData(data); }
    catch (e) { toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" }); }
    finally { setHistoryLoading(false); }
  };

  if (!canAccess) return <div className="flex flex-col items-center justify-center py-16 text-center"><p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p></div>;

  const columns: Column<MatrixRow>[] = [
    { key: "name", header: locale === "en" ? "Matrix Name" : "اسم المصفوفة", cell: (r) => (<div><div className="font-medium">{r.name}</div>{r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}</div>) },
    { key: "clientName", header: locale === "en" ? "Client" : "العميل", cell: (r) => r.clientName || "—" },
    { key: "jobPosition", header: locale === "en" ? "Job Position" : "المسمى", cell: (r) => r.jobPosition || (locale === "en" ? "All" : "الكل") },
    { key: "version", header: "Version", cell: (r) => <Badge variant="outline">v{r.version}</Badge> },
    { key: "isActive", header: locale === "en" ? "Status" : "الحالة", cell: (r) => (<div className="flex gap-1">{r.isArchived ? <Badge variant="outline" className="bg-gray-50 text-gray-500">Archived</Badge> : r.isActive ? <Badge variant="outline" className="bg-green-50 text-green-700">Active</Badge> : <Badge variant="outline" className="bg-orange-50 text-orange-700">Inactive</Badge>}</div>) },
    { key: "_count", header: locale === "en" ? "Courses" : "الدورات", cell: (r) => <Badge variant="secondary">{r._count?.courseRequirements ?? 0}</Badge> },
    { key: "actions", header: "", cell: (r) => (<div className="flex gap-1">
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!canManage || !!actionLoading} onClick={() => openHistory(r)} title="History"><History className="h-3.5 w-3.5" /></Button>
      {canManage && (<>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!!actionLoading} onClick={() => openEdit(r)} title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!!actionLoading} onClick={() => handleDuplicate(r)} title="Duplicate"><Copy className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" disabled={!!actionLoading || r.isArchived} onClick={() => setConfirmArchive(r)} title="Archive"><Archive className="h-3.5 w-3.5" /></Button>
      </>)}
    </div>) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={locale === "en" ? "Training Matrix Management" : "إدارة مصفوفة التدريب"} subtitle={locale === "en" ? "Versioned training matrices for clients, projects, and job positions" : "مصفوفات تدريب مرنة لكل عميل ومشروع ومسمى وظيفي"}
        actions={canManage ? <Button size="sm" onClick={openCreate} className="gap-1.5"><Plus className="h-4 w-4" />{locale === "en" ? "New Matrix" : "مصفوفة جديدة"}</Button> : undefined} />
      <Card className="p-0">
        {error ? <div className="p-6"><EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={error} /></div> : (
          <DataTable data={matrices} columns={columns} loading={loading} rowKey={(r) => r.id}
            emptyIcon={ClipboardCheck} emptyTitle={locale === "en" ? "No training matrices" : "لا توجد مصفوفات"} emptySubtitle={locale === "en" ? "Create matrices to define required courses per job position" : "أنشئ مصفوفات لتعريف الدورات المطلوبة"} />
        )}
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{formMode === "create" ? (locale === "en" ? "New Training Matrix" : "مصفوفة تدريب جديدة") : (locale === "en" ? "Edit Matrix" : "تعديل المصفوفة")}</DialogTitle>
            <DialogDescription>{locale === "en" ? "Define scope and required courses for a training matrix." : "حدد النطاق والدورات المطلوبة."}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-sm font-medium">{locale === "en" ? "Name" : "الاسم"} *</Label><Input value={formData.name ?? ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="h-10 mt-1" /></div>
              <div><Label className="text-sm font-medium">{locale === "en" ? "Arabic Name" : "الاسم بالعربي"}</Label><Input dir="rtl" value={formData.nameAr ?? ""} onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })} className="h-10 mt-1" /></div>
              <div><Label className="text-sm font-medium">{locale === "en" ? "Client" : "العميل"}</Label><Input placeholder="Saudi Aramco / SEC / SABIC" value={formData.clientName ?? ""} onChange={(e) => setFormData({ ...formData, clientName: e.target.value })} className="h-10 mt-1" /></div>
              <div><Label className="text-sm font-medium">{locale === "en" ? "Job Position" : "المسمى الوظيفي"}</Label><Input placeholder="Electrician / Welder / All" value={formData.jobPosition ?? ""} onChange={(e) => setFormData({ ...formData, jobPosition: e.target.value })} className="h-10 mt-1" /></div>
              <div><Label className="text-sm font-medium">{locale === "en" ? "Project" : "المشروع"}</Label><Input value={formData.projectName ?? ""} onChange={(e) => setFormData({ ...formData, projectName: e.target.value })} className="h-10 mt-1" /></div>
              <div><Label className="text-sm font-medium">{locale === "en" ? "Site" : "الموقع"}</Label><Input value={formData.siteName ?? ""} onChange={(e) => setFormData({ ...formData, siteName: e.target.value })} className="h-10 mt-1" /></div>
            </div>
            <div><Label className="text-sm font-medium">{locale === "en" ? "Description" : "الوصف"}</Label><Input value={formData.description ?? ""} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="h-10 mt-1" /></div>

            {/* Course requirements */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">{locale === "en" ? "Required Courses" : "الدورات المطلوبة"} ({formData.courseRequirements?.length ?? 0})</h4>
                <Button type="button" size="sm" variant="outline" onClick={() => setFormData({ ...formData, courseRequirements: [...(formData.courseRequirements ?? []), { courseId: "", isMandatory: true, validityMonths: 24, renewalRequired: true, gracePeriodDays: 0, priority: "NORMAL" }] })}><Plus className="h-3.5 w-3.5 me-1" />{locale === "en" ? "Add Course" : "إضافة دورة"}</Button>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-2">
                {(formData.courseRequirements ?? []).map((cr, i) => (
                  <div key={i} className="flex items-center gap-2 border rounded p-2">
                    <Select value={cr.courseId} onValueChange={(v) => { const n = [...(formData.courseRequirements ?? [])]; n[i].courseId = v; setFormData({ ...formData, courseRequirements: n }); }}>
                      <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Select course" /></SelectTrigger>
                      <SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" className="h-8 w-16 text-xs" placeholder="Months" value={cr.validityMonths} onChange={(e) => { const n = [...(formData.courseRequirements ?? [])]; n[i].validityMonths = parseInt(e.target.value) || 24; setFormData({ ...formData, courseRequirements: n }); }} />
                    <Checkbox checked={cr.isMandatory} onCheckedChange={(v) => { const n = [...(formData.courseRequirements ?? [])]; n[i].isMandatory = v === true; setFormData({ ...formData, courseRequirements: n }); }} />
                    <span className="text-xs">Mandatory</span>
                    <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => setFormData({ ...formData, courseRequirements: (formData.courseRequirements ?? []).filter((_, idx) => idx !== i) })}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
                {(!formData.courseRequirements || formData.courseRequirements.length === 0) && <p className="text-xs text-muted-foreground text-center py-2">No courses added yet.</p>}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={!!actionLoading}>{locale === "en" ? "Cancel" : "إلغاء"}</Button>
            <Button onClick={submitForm} disabled={!!actionLoading || !canManage}>{actionLoading === "form" ? <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Saving..." : "حفظ..."}</> : formMode === "create" ? (locale === "en" ? "Create" : "إنشاء") : (locale === "en" ? "Save" : "حفظ")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirm */}
      <Dialog open={!!confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><Archive className="h-5 w-5" />{locale === "en" ? "Archive Matrix" : "أرشفة المصفوفة"}</DialogTitle>
          <DialogDescription>{locale === "en" ? `Archive "${confirmArchive?.name}"? Existing projects keep their version. New projects won't use this matrix.` : `أرشفة "${confirmArchive?.name}"؟ المشاريع الحالية تحتفظ بنسختها.`}</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setConfirmArchive(null)} disabled={!!actionLoading}>{locale === "en" ? "Cancel" : "إلغاء"}</Button>
            <Button variant="destructive" onClick={handleArchive} disabled={!!actionLoading}>{actionLoading?.endsWith("archive") ? <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Archiving..." : "أرشفة..."}</> : (locale === "en" ? "Archive" : "أرشفة")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]"><DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" />{locale === "en" ? "Version History" : "سجل الإصدارات"}</DialogTitle>
          <DialogDescription>{locale === "en" ? "Immutable audit trail" : "سجل تدقيق كامل"}</DialogDescription></DialogHeader>
          {historyLoading ? <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div> : historyData.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{locale === "en" ? "No history" : "لا يوجد سجل"}</div> : (
            <div className="max-h-[55vh] overflow-y-auto space-y-2">{historyData.map((v, i) => { const ver = v as { version: number; name: string; changedBy: string; changedAt: string; changeType: string; reason: string | null }; return (
              <div key={i} className="border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-2"><Badge variant="outline" className="text-xs">v{ver.version}</Badge><Badge variant="outline" className={`text-xs ${ver.changeType === "CREATE" ? "bg-green-50 text-green-700" : ver.changeType === "ARCHIVE" ? "bg-red-50 text-red-700" : "bg-gray-50"}`}>{ver.changeType}</Badge></div>
                  <span className="text-xs text-muted-foreground">{new Date(ver.changedAt).toLocaleString()}</span></div>
                <div className="text-xs text-muted-foreground">{ver.name} · by {ver.changedBy}{ver.reason && <span className="italic"> · {ver.reason}</span>}</div>
              </div>); })}</div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setHistoryOpen(false)}>{locale === "en" ? "Close" : "إغلاق"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
