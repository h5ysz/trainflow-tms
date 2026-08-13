"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilePen, Plus, Check, X, User, AlertCircle, ClipboardList } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { newQuestionDefaults, validateQuestion } from "@/lib/questions";

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
  imageUrl?: string | null;
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
  const { navigate } = useAppStore();
  const [courses, setCourses] = useState<CourseOption[]>([]);

  const questionsList = useList<Question>("/questions", { extraParams: { testType: TEST_TYPE } });
  const resultsList = useList<TestResultRow>("/test-results", { extraParams: { testType: TEST_TYPE } });

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Question>({
    resource: "/questions",
    module: "pre-test",
    refetch: questionsList.refetch,
    fetchOnEdit: true,
  });

  useEffect(() => {
    if (dialogOpen && courses.length === 0) {
      api.getList<CourseOption>("/courses", { pageSize: 100 }).then((r) => {
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
      cell: (row) => (
        <RowActions
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => void openEdit(row)}
          onDelete={() => setDeleteTarget(row)}
        />
      ),
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
          <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-xs font-medium">
            <ClipboardList className="h-3 w-3" />{t("preTest.assessment")}
          </span>
        </div>
      ),
    },
    { key: "attemptedAt", header: t("preTest.attemptedAt"), cell: (r) => <span className="text-xs text-muted-foreground">{new Date(r.attemptedAt).toLocaleString()}</span> },
  ];

  const handleSubmit = () =>
    void submit(() =>
      validateQuestion(formData, {
        course: `${t("courses.title2")} — ${t("misc.required")}`,
        text: `${t("preTest.questionText")} — ${t("misc.required")}`,
        minOptions: t("questions.minOptions"),
        minCorrect: t("questions.minCorrect"),
      })
    );

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
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("exam-attempts", TEST_TYPE)}>
              <ClipboardList className="h-4 w-4 me-1.5" />{t("exam.title")}
            </Button>
            {canCreate && <Button onClick={() => openCreate(newQuestionDefaults(TEST_TYPE))}><Plus className="h-4 w-4 me-1.5" />{t("preTest.newQuestion")}</Button>}
          </div>
        }
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
            emptyAction={canCreate && <Button onClick={() => openCreate(newQuestionDefaults(TEST_TYPE))}><Plus className="h-4 w-4 me-1.5" />{t("preTest.newQuestion")}</Button>}
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
            emptySubtitle={t("misc.noDataYet")}
          />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("action.edit") : t("preTest.newQuestion")}
        icon={FilePen}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t("courses.title2")} required>
              <Select value={(formData.courseId as string) ?? ""} onValueChange={(v) => setField("courseId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("preTest.questionType")} required>
              <Select value={(formData.type as string) ?? "SINGLE_CHOICE"} onValueChange={(v) => setField("type", v)}>
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
              <Input type="number" min={1} value={(formData.points as number) ?? 1} onChange={(e) => setField("points", parseInt(e.target.value, 10) || 1)} />
            </Field>
            <Field label={t("preTest.order")}>
              <Input type="number" min={1} value={(formData.order as number) ?? 1} onChange={(e) => setField("order", parseInt(e.target.value, 10) || 1)} />
            </Field>
          </FormGrid>
          <Field label={t("questions.imageUrl")}>
            <Input placeholder="/question-images/saf02/figure-1-2.png" value={(formData.imageUrl as string) ?? ""} onChange={(e) => setField("imageUrl", e.target.value)} />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.text}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
