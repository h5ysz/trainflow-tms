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
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck, Plus, Pencil, Trash2, History, Loader2, AlertCircle,
  Lock, ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface ComplianceRuleRow {
  id: string;
  courseId: string;
  course: { id: string; code: string; title: string; validityMonths: number };
  isMandatory: boolean;
  isCoreMandatory: boolean;
  validityMonths: number;
  scopeType: string;
  scopeValue: string | null;
  scopeLabel: string | null;
  isActive: boolean;
  _count?: { versions: number };
  createdAt: string;
}

interface CourseOption {
  id: string;
  code: string;
  title: string;
  validityMonths: number;
}

interface VersionRow {
  id: string;
  version: number;
  courseId: string;
  isMandatory: boolean;
  isCoreMandatory: boolean;
  validityMonths: number;
  scopeType: string;
  scopeValue: string | null;
  scopeLabel: string | null;
  isActive: boolean;
  changedBy: string;
  changedAt: string;
  changeType: string;
  reason: string | null;
  previousValues: string | null;
}

const SCOPE_TYPES = [
  { value: "ALL", labelEn: "All Workers", labelAr: "كل العمال" },
  { value: "COMPANY", labelEn: "Company", labelAr: "شركة" },
  { value: "JOB_TITLE", labelEn: "Job Title", labelAr: "مسمى وظيفي" },
  { value: "PROJECT", labelEn: "Project", labelAr: "مشروع" },
  { value: "CLIENT", labelEn: "Client", labelAr: "عميل" },
];

export function ComplianceMatrixRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [rules, setRules] = useState<ComplianceRuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formData, setFormData] = useState<Partial<ComplianceRuleRow>>({});
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ComplianceRuleRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<VersionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const canAccess = canAccessModule((user?.permissions ?? []) as never, "compliance-matrix");
  const canManage = user?.role === "SUPER_ADMIN";

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ComplianceRuleRow[]>("/compliance/rules");
      setRules(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  if (rules.length === 0 && !loading && !error) fetchRules();

  const openCreate = async () => {
    setFormMode("create");
    setFormData({ isMandatory: true, isCoreMandatory: false, scopeType: "ALL", isActive: true, validityMonths: 24 });
    // Fetch courses for dropdown
    try {
      const courseList = await api.get<CourseOption[]>("/courses?pageSize=100");
      setCourses(courseList);
    } catch { /* ignore */ }
    setFormOpen(true);
  };

  const openEdit = (row: ComplianceRuleRow) => {
    setFormMode("edit");
    setFormData(row);
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!formData.courseId) {
      toast({ title: t("misc.error"), description: locale === "en" ? "Course is required" : "الدورة مطلوبة", variant: "destructive" });
      return;
    }
    setActionLoading("form");
    try {
      if (formMode === "create") {
        await api.post("/compliance/rules", {
          courseId: formData.courseId,
          isMandatory: formData.isMandatory ?? true,
          isCoreMandatory: formData.isCoreMandatory ?? false,
          validityMonths: formData.validityMonths ?? 24,
          scopeType: formData.scopeType ?? "ALL",
          scopeValue: formData.scopeValue || null,
          scopeLabel: formData.scopeLabel || null,
          isActive: formData.isActive ?? true,
        });
        toast({ title: t("misc.success"), description: locale === "en" ? "Rule created" : "تم إنشاء القاعدة" });
      } else if (formData.id) {
        await api.put(`/compliance/rules/${formData.id}`, {
          isMandatory: formData.isMandatory,
          isCoreMandatory: formData.isCoreMandatory,
          validityMonths: formData.validityMonths,
          scopeType: formData.scopeType,
          scopeValue: formData.scopeValue || null,
          scopeLabel: formData.scopeLabel || null,
          isActive: formData.isActive,
        });
        toast({ title: t("misc.success"), description: locale === "en" ? "Rule updated" : "تم تحديث القاعدة" });
      }
      setFormOpen(false);
      fetchRules();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(confirmDelete.id + "delete");
    try {
      await api.delete(`/compliance/rules/${confirmDelete.id}`);
      toast({ title: t("misc.success"), description: locale === "en" ? "Rule deleted" : "تم حذف القاعدة" });
      setConfirmDelete(null);
      fetchRules();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const openHistory = async (row: ComplianceRuleRow) => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryData([]);
    try {
      const data = await api.get<VersionRow[]>(`/compliance/rules/${row.id}/versions`);
      setHistoryData(data);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const columns: Column<ComplianceRuleRow>[] = [
    {
      key: "course",
      header: locale === "en" ? "Course" : "الدورة",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.course.title}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.course.code}</div>
        </div>
      ),
    },
    {
      key: "isCoreMandatory",
      header: locale === "en" ? "Type" : "النوع",
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          {row.isCoreMandatory ? (
            <Badge variant="outline" className="gap-1 bg-red-50 border-red-200 text-red-700">
              <Lock className="h-3 w-3" />
              {locale === "en" ? "Core" : "أساسي"}
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700">
              {locale === "en" ? "Dynamic" : "ديناميكي"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "scopeType",
      header: locale === "en" ? "Scope" : "النطاق",
      cell: (row) => (
        <div>
          <div className="text-sm">{SCOPE_TYPES.find(s => s.value === row.scopeType)?.[locale === "en" ? "labelEn" : "labelAr"] ?? row.scopeType}</div>
          {row.scopeLabel && <div className="text-xs text-muted-foreground">{row.scopeLabel}</div>}
        </div>
      ),
    },
    {
      key: "validityMonths",
      header: locale === "en" ? "Validity" : "الصلاحية",
      cell: (row) => <span className="text-sm">{row.validityMonths} {locale === "en" ? "months" : "شهر"}</span>,
    },
    {
      key: "isActive",
      header: locale === "en" ? "Status" : "الحالة",
      cell: (row) => (
        <Badge variant="outline" className={row.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}>
          {row.isActive ? (locale === "en" ? "Active" : "نشط") : (locale === "en" ? "Inactive" : "غير نشط")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: locale === "en" ? "Actions" : "إجراءات",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!canManage || !!actionLoading}
            onClick={() => openHistory(row)} title={locale === "en" ? "Version History" : "سجل الإصدارات"}>
            <History className="h-3.5 w-3.5" />
          </Button>
          {canManage && (
            <>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!!actionLoading}
                onClick={() => openEdit(row)} title={locale === "en" ? "Edit" : "تعديل"}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                disabled={!!actionLoading || row.isCoreMandatory}
                onClick={() => setConfirmDelete(row)}
                title={row.isCoreMandatory ? (locale === "en" ? "Core rules cannot be deleted" : "لا يمكن حذف القواعد الأساسية") : (locale === "en" ? "Delete" : "حذف")}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={locale === "en" ? "Compliance Matrix" : "مصفوفة الامتثال"}
        subtitle={locale === "en" ? "Manage mandatory course requirements for workers" : "إدارة متطلبات الدورات الإلزامية للعمال"}
        actions={canManage ? (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {locale === "en" ? "New Rule" : "قاعدة جديدة"}
          </Button>
        ) : undefined}
      />

      {/* Core mandatory info banner */}
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-red-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-red-800">
            {locale === "en" ? "Core Mandatory Courses (OHS, Fire Safety, First Aid)" : "الدورات الأساسية الإلزامية (السلامة المهنية، السلامة من الحريق، الإسعافات الأولية)"}
          </p>
          <p className="text-xs text-red-600">
            {locale === "en"
              ? "These are always required. Only SUPER_ADMIN can modify or deactivate them. They cannot be deleted."
              : "هذه مطلوبة دائماً. فقط المدير العام يمكنه تعديلها أو إلغاء تنشيطها. لا يمكن حذفها."}
          </p>
        </div>
      </div>

      <Card className="p-0">
        {error ? (
          <div className="p-6">
            <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={error} />
          </div>
        ) : (
          <DataTable
            data={rules}
            columns={columns}
            loading={loading}
            rowKey={(r) => r.id}
            emptyIcon={ClipboardCheck}
            emptyTitle={locale === "en" ? "No compliance rules" : "لا توجد قواعد امتثال"}
            emptySubtitle={locale === "en" ? "Create rules to define mandatory courses" : "أنشئ قواعد لتعريف الدورات الإلزامية"}
          />
        )}
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" ? (locale === "en" ? "New Compliance Rule" : "قاعدة امتثال جديدة") : (locale === "en" ? "Edit Rule" : "تعديل القاعدة")}
            </DialogTitle>
            <DialogDescription>
              {locale === "en" ? "Define which courses are mandatory and for whom." : "حدد الدورات الإلزامية ولمن تنطبق."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto py-1">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Course" : "الدورة"} *</Label>
              <Select
                value={formData.courseId ?? ""}
                onValueChange={(v) => {
                  const c = courses.find(c => c.id === v);
                  setFormData({ ...formData, courseId: v, validityMonths: c?.validityMonths ?? 24 });
                }}
                disabled={formMode === "edit"}
              >
                <SelectTrigger className="h-10"><SelectValue placeholder={locale === "en" ? "Select course..." : "اختر دورة..."} /></SelectTrigger>
                <SelectContent>
                  {courses.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Scope Type" : "نوع النطاق"}</Label>
              <Select value={formData.scopeType ?? "ALL"} onValueChange={(v) => setFormData({ ...formData, scopeType: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPE_TYPES.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      {locale === "en" ? s.labelEn : s.labelAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.scopeType && formData.scopeType !== "ALL" && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {locale === "en" ? "Scope Value (ID or name)" : "قيمة النطاق (معرف أو اسم)"}
                </Label>
                <Input
                  value={formData.scopeValue ?? ""}
                  onChange={(e) => setFormData({ ...formData, scopeValue: e.target.value })}
                  className="h-10"
                  placeholder={formData.scopeType === "COMPANY" ? "company-id" : formData.scopeType === "JOB_TITLE" ? "Electrician" : "name"}
                />
                <Input
                  value={formData.scopeLabel ?? ""}
                  onChange={(e) => setFormData({ ...formData, scopeLabel: e.target.value })}
                  className="h-10 mt-1"
                  placeholder={locale === "en" ? "Human-readable label (e.g. 'Acme Co.')" : "وصف مقروء"}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Validity (months)" : "الصلاحية (شهور)"}</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={formData.validityMonths ?? 24}
                onChange={(e) => setFormData({ ...formData, validityMonths: parseInt(e.target.value, 10) || 24 })}
                className="h-10"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="cr-mandatory"
                checked={formData.isMandatory ?? true}
                onCheckedChange={(v) => setFormData({ ...formData, isMandatory: v === true })}
              />
              <Label htmlFor="cr-mandatory" className="text-sm cursor-pointer">{locale === "en" ? "Mandatory" : "إلزامي"}</Label>
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cr-core"
                  checked={formData.isCoreMandatory ?? false}
                  onCheckedChange={(v) => setFormData({ ...formData, isCoreMandatory: v === true })}
                />
                <Label htmlFor="cr-core" className="text-sm cursor-pointer">
                  {locale === "en" ? "Core Mandatory (protected — only SUPER_ADMIN can disable)" : "أساسي إلزامي (محمي)"}
                </Label>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="cr-active"
                checked={formData.isActive ?? true}
                onCheckedChange={(v) => setFormData({ ...formData, isActive: v === true })}
              />
              <Label htmlFor="cr-active" className="text-sm cursor-pointer">{locale === "en" ? "Active" : "نشط"}</Label>
            </div>

            {formMode === "edit" && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{locale === "en" ? "Reason for change (optional)" : "سبب التغيير (اختياري)"}</Label>
                <Textarea
                  value={(formData as Record<string, unknown>).__reason as string ?? ""}
                  onChange={(e) => setFormData({ ...formData, __reason: e.target.value } as Record<string, unknown>)}
                  rows={2}
                  placeholder={locale === "en" ? "e.g. Updated validity period per client request" : "مثال: تحديث فترة الصلاحية"}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button onClick={submitForm} disabled={!!actionLoading || !canManage}>
              {actionLoading === "form" ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Saving..." : "حفظ..."}</>
              ) : formMode === "create" ? (locale === "en" ? "Create" : "إنشاء") : (locale === "en" ? "Save" : "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {locale === "en" ? "Delete Rule" : "حذف القاعدة"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en"
                ? `Delete compliance rule for "${confirmDelete?.course.title}"? This will deactivate the rule. The version history is preserved permanently.`
                : `حذف قاعدة الامتثال لـ "${confirmDelete?.course.title}"؟ سيتم إلغاء تنشيط القاعدة. يُحفظ سجل الإصدارات بشكل دائم.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!!actionLoading}>
              {actionLoading?.endsWith("delete") ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Deleting..." : "حذف..."}</>
              ) : (locale === "en" ? "Delete" : "حذف")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {locale === "en" ? "Version History" : "سجل الإصدارات"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en" ? "Complete audit trail — never deleted" : "سجل تدقيق كامل — لا يُحذف أبداً"}
            </DialogDescription>
          </DialogHeader>

          {historyLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : historyData.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {locale === "en" ? "No version history" : "لا يوجد سجل إصدارات"}
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto space-y-2">
              {historyData.map((v) => (
                <div key={v.id} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">v{v.version}</Badge>
                      <Badge variant="outline" className={`text-xs ${
                        v.changeType === "CREATE" ? "bg-green-50 text-green-700" :
                        v.changeType === "DEACTIVATE" ? "bg-red-50 text-red-700" :
                        v.changeType === "ACTIVATE" ? "bg-blue-50 text-blue-700" :
                        "bg-gray-50 text-gray-700"
                      }`}>
                        {v.changeType}
                      </Badge>
                      <span className={v.isActive ? "text-green-600" : "text-gray-400"}>
                        {v.isActive ? "●" : "○"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.changedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>Scope: {v.scopeType} {v.scopeLabel ? `(${v.scopeLabel})` : ""}</div>
                    <div>Validity: {v.validityMonths} months · Mandatory: {v.isMandatory ? "Yes" : "No"}</div>
                    {v.reason && <div className="italic">Reason: {v.reason}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              {locale === "en" ? "Close" : "إغلاق"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
