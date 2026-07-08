"use client";

import { useState, useEffect, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilePen, Plus, Check, X, User, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface CourseOption { id: string; title: string; code: string; }
interface Question {
  id: string;
  courseCode?: string | null;
  courseTitle?: string | null;
  type: string;
  text: string;
  options: string[];
  correctAnswers: number[];
  points: number;
  order: number;
  isActive: boolean;
}
interface TestResultRow {
  id: string;
  sessionCode?: string | null;
  courseTitle?: string | null;
  traineeName: string;
  scorePercent: number;
  passed: boolean;
  attemptedAt: string;
}

const TEST_TYPE = "PRE_TEST";

export function PreTestRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    type: "SINGLE_CHOICE",
    testType: TEST_TYPE,
    points: 1,
    order: 1,
    isActive: true,
    options: ["", "", "", ""],
    correctAnswers: [] as number[],
  });
  const [courses, setCourses] = useReactState<CourseOption[]>([]);

  const questionsList = useList<Question>("/questions", { extraParams: { testType: TEST_TYPE } });
  const resultsList = useList<TestResultRow>("/test-results", { extraParams: { testType: TEST_TYPE } });

  const canCreate = user ? canPerformAction(user.role, "pre-test", "create") : false;

  useEffect(() => {
    if (dialogOpen && courses.length === 0) {
      api.get<{ rows: CourseOption[] }>("/courses", { pageSize: 100 }).then((r) => {
        setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code })));
      }).catch(() => {});
    }
  }, [dialogOpen, courses.length]);

  const questionColumns: Column<Question>[] = [
    {
      key: "text",
      header: t("preTest.questionText"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-mono font-semibold shrink-0">{r.order}</div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate max-w-md">{r.text}</div>
            <div className="text-xs text-muted-foreground">{r.courseCode || "—"} · {r.type.replace("_", " ")}</div>
          </div>
        </div>
      ),
    },
    { key: "points", header: t("preTest.points"), cell: (r) => <div className="text-sm font-semibold tabular-nums">{r.points}</div> },
    {
      key: "active", header: t("status.ACTIVE"),
      cell: (r) => r.isActive ? (
        <span className="inline-flex items-center gap-1 text-success text-xs font-medium"><Check className="h-3.5 w-3.5" />{t("status.ACTIVE")}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs font-medium"><X className="h-3.5 w-3.5" />{t("status.INACTIVE")}</span>
      ),
    },
    { key: "actions", header: t("action.actions"), headerClassName: "text-end", className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.edit")}</Button>,
    },
  ];

  const resultColumns: Column<TestResultRow>[] = [
    {
      key: "trainee", header: t("preTest.trainee"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-info/10 text-info text-xs font-semibold shrink-0">
            {r.traineeName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium">{r.traineeName}</div>
            <div className="text-xs text-muted-foreground font-mono">{r.sessionCode}</div>
          </div>
        </div>
      ),
    },
    {
      key: "score", header: t("preTest.score"),
      cell: (r) => (
        <div className="flex items-center gap-2">
          <div className="text-lg font-bold tabular-nums">{r.scorePercent}%</div>
          {r.passed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success border border-success/20 px-2 py-0.5 text-xs font-medium"><Check className="h-3 w-3" />{t("preTest.passed")}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 text-xs font-medium"><X className="h-3 w-3" />{t("status.REJECTED")}</span>
          )}
        </div>
      ),
    },
    { key: "attemptedAt", header: t("preTest.attemptedAt"), cell: (r) => <span className="text-xs text-muted-foreground">{new Date(r.attemptedAt).toLocaleString()}</span> },
  ];

  const handleSubmit = async () => {
    if (!formData.courseId || !formData.text) {
      toast({ title: t("misc.error"), description: "Course and text are required", variant: "destructive" });
      return;
    }
    const options = (formData.options as string[]).filter((o) => o.trim() !== "");
    if (options.length < 2) {
      toast({ title: t("misc.error"), description: "At least 2 options required", variant: "destructive" });
      return;
    }
    if ((formData.correctAnswers as number[]).length === 0) {
      toast({ title: t("misc.error"), description: "Mark at least 1 correct answer", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/questions", formData);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({ type: "SINGLE_CHOICE", testType: TEST_TYPE, points: 1, order: 1, isActive: true, options: ["", "", "", ""], correctAnswers: [] });
      questionsList.refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (k: string, v: unknown) => setFormData((p) => ({ ...p, [k]: v }));

  const toggleCorrect = (idx: number) => {
    const current = (formData.correctAnswers as number[]) ?? [];
    const next = current.includes(idx) ? current.filter((i) => i !== idx) : [...current, idx];
    setField("correctAnswers", next);
  };

  const updateOption = (idx: number, value: string) => {
    const opts = [...((formData.options as string[]) ?? [])];
    opts[idx] = value;
    setField("options", opts);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("preTest.title")}
        subtitle={t("preTest.subtitle")}
        icon={FilePen}
        actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("preTest.newQuestion")}</Button>}
      />

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">{t("preTest.questions")}</TabsTrigger>
          <TabsTrigger value="results">{t("preTest.results")}</TabsTrigger>
        </TabsList>
        <TabsContent value="questions" className="mt-4">
          {questionsList.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive mb-3">
              <AlertCircle className="h-4 w-4" /> {questionsList.error}
            </div>
          )}
          <DataTable
            columns={questionColumns}
            data={questionsList.data}
            loading={questionsList.loading}
            rowKey={(r) => r.id}
            searchable
            searchValue={questionsList.search}
            onSearchChange={questionsList.setSearch}
            page={questionsList.page}
            total={questionsList.pagination?.total ?? 0}
            pageSize={questionsList.pagination?.pageSize ?? 10}
            onPageChange={questionsList.setPage}
            emptyIcon={FilePen}
            emptyTitle={t("preTest.empty.title")}
            emptySubtitle={t("preTest.empty.subtitle")}
            emptyAction={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("preTest.newQuestion")}</Button>}
          />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          {resultsList.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive mb-3">
              <AlertCircle className="h-4 w-4" /> {resultsList.error}
            </div>
          )}
          <DataTable
            columns={resultColumns}
            data={resultsList.data}
            loading={resultsList.loading}
            rowKey={(r) => r.id}
            page={resultsList.page}
            total={resultsList.pagination?.total ?? 0}
            pageSize={resultsList.pagination?.pageSize ?? 10}
            onPageChange={resultsList.setPage}
            emptyIcon={User}
            emptyTitle={t("preTest.empty.title")}
            emptySubtitle={t("misc.pageUnderConstruction")}
          />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("preTest.newQuestion")}
        icon={FilePen}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t("courses.title2")} required>
              <Select onValueChange={(v) => setField("courseId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("preTest.questionType")} required>
              <Select value={formData.type as string} onValueChange={(v) => setField("type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SINGLE_CHOICE">Single Choice</SelectItem>
                  <SelectItem value="MULTIPLE_CHOICE">Multiple Choice</SelectItem>
                  <SelectItem value="TRUE_FALSE">True / False</SelectItem>
                  <SelectItem value="SHORT_ANSWER">Short Answer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
          <Field label={t("preTest.questionText")} required>
            <Textarea rows={3} placeholder={t("preTest.questionText")} value={(formData.text as string) ?? ""} onChange={(e) => setField("text", e.target.value)} />
          </Field>

          <div>
            <Label className="text-xs font-medium mb-2 block">{t("preTest.options")} ({t("preTest.correctAnswers")})</Label>
            <div className="space-y-2">
              {((formData.options as string[]) ?? []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder={`Option ${i + 1}`} value={opt} onChange={(e) => updateOption(i, e.target.value)} />
                  <Button
                    type="button"
                    variant={((formData.correctAnswers as number[]) ?? []).includes(i) ? "default" : "outline"}
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => toggleCorrect(i)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setField("options", [...((formData.options as string[]) ?? []), ""])}
              >
                <Plus className="h-3.5 w-3.5 me-1" />{t("action.add")}
              </Button>
            </div>
          </div>

          <FormGrid>
            <Field label={t("preTest.points")}>
              <Input type="number" min={1} value={formData.points as number} onChange={(e) => setField("points", parseInt(e.target.value, 10) || 1)} />
            </Field>
            <Field label={t("preTest.order")}>
              <Input type="number" min={1} value={formData.order as number} onChange={(e) => setField("order", parseInt(e.target.value, 10) || 1)} />
            </Field>
          </FormGrid>
        </div>
      </FormDialog>
    </div>
  );
}
