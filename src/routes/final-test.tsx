"use client";

import { useState } from "react";
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
import { FileCheck2, Plus, Check, X, User } from "lucide-react";

interface Question {
  id: string;
  courseCode: string;
  type: string;
  text: string;
  points: number;
  order: number;
  isActive: boolean;
}
interface TestResultRow {
  id: string;
  sessionCode: string;
  traineeName: string;
  scorePercent: number;
  passed: boolean;
  attemptedAt: string;
}

export function FinalTestRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const questions: Question[] = [];
  const results: TestResultRow[] = [];

  const questionColumns: Column<Question>[] = [
    {
      key: "text",
      header: t("finalTest.questionText"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-mono font-semibold shrink-0">{r.order}</div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate max-w-md">{r.text}</div>
            <div className="text-xs text-muted-foreground">{r.courseCode} · {r.type.replace("_", " ")}</div>
          </div>
        </div>
      ),
    },
    { key: "points", header: t("finalTest.points"), cell: (r) => <div className="text-sm font-semibold tabular-nums">{r.points}</div> },
    {
      key: "active", header: t("status.ACTIVE"),
      cell: (r) => r.isActive ? (
        <span className="inline-flex items-center gap-1 text-success text-xs font-medium"><Check className="h-3.5 w-3.5" />{t("status.ACTIVE")}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs font-medium"><X className="h-3.5 w-3.5" />{t("status.INACTIVE")}</span>
      ),
    },
    {
      key: "actions", header: t("action.actions"), headerClassName: "text-end", className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.edit")}</Button>,
    },
  ];

  const resultColumns: Column<TestResultRow>[] = [
    {
      key: "trainee", header: t("finalTest.trainee"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success text-xs font-semibold shrink-0">
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
      key: "score", header: t("finalTest.score"),
      cell: (r) => (
        <div className="flex items-center gap-2">
          <div className="text-lg font-bold tabular-nums">{r.scorePercent}%</div>
          {r.passed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success border border-success/20 px-2 py-0.5 text-xs font-medium"><Check className="h-3 w-3" />{t("finalTest.passed")}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 text-xs font-medium"><X className="h-3 w-3" />{t("status.REJECTED")}</span>
          )}
        </div>
      ),
    },
    { key: "attemptedAt", header: t("finalTest.attemptedAt"), cell: (r) => <span className="text-xs text-muted-foreground">{r.attemptedAt}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("finalTest.title")}
        subtitle={t("finalTest.subtitle")}
        icon={FileCheck2}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("finalTest.newQuestion")}</Button>}
      />
      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">{t("finalTest.questions")}</TabsTrigger>
          <TabsTrigger value="results">{t("finalTest.results")}</TabsTrigger>
        </TabsList>
        <TabsContent value="questions" className="mt-4">
          <DataTable
            columns={questionColumns}
            data={questions}
            rowKey={(r) => r.id}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            emptyIcon={FileCheck2}
            emptyTitle={t("finalTest.empty.title")}
            emptySubtitle={t("finalTest.empty.subtitle")}
            emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("finalTest.newQuestion")}</Button>}
          />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <DataTable
            columns={resultColumns}
            data={results}
            rowKey={(r) => r.id}
            emptyIcon={User}
            emptyTitle={t("finalTest.empty.title")}
            emptySubtitle={t("misc.pageUnderConstruction")}
          />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("finalTest.newQuestion")}
        icon={FileCheck2}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t("courses.title2")} required>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("finalTest.questionType")} required>
              <Select defaultValue="SINGLE_CHOICE"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="SINGLE_CHOICE">Single Choice</SelectItem>
                <SelectItem value="MULTIPLE_CHOICE">Multiple Choice</SelectItem>
                <SelectItem value="TRUE_FALSE">True / False</SelectItem>
                <SelectItem value="SHORT_ANSWER">Short Answer</SelectItem>
              </SelectContent></Select>
            </Field>
          </FormGrid>
          <Field label={t("finalTest.questionText")} required>
            <Textarea rows={3} placeholder={t("finalTest.questionText")} />
          </Field>
          <div>
            <Label className="text-xs font-medium mb-2 block">{t("finalTest.options")}</Label>
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder={`Option ${i}`} />
                  <Button variant="outline" size="icon" className="h-9 w-9"><Check className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="text-xs"><Plus className="h-3.5 w-3.5 me-1" />{t("action.add")}</Button>
            </div>
          </div>
          <FormGrid>
            <Field label={t("finalTest.points")}><Input type="number" defaultValue={1} min={1} /></Field>
            <Field label={t("finalTest.order")}><Input type="number" defaultValue={1} min={1} /></Field>
          </FormGrid>
        </div>
      </FormDialog>
    </div>
  );
}
