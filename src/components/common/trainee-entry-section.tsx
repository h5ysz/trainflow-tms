"use client";

import { useState, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileSpreadsheet, ClipboardPaste, Plus, Trash2,
  AlertCircle, Check, X, Users, FileUp, Link2, Loader2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Types — shared trainee shape used by all 3 entry methods
// ─────────────────────────────────────────────────────────────────────────

export interface TraineeEntry {
  id: string; // local ID for React keys (not persisted)
  fullName: string;
  nationalId: string;
  nationality: string;
  jobTitle: string;
  idAttachmentUrl: string | null;
  idAttachmentName: string | null;
  valid: boolean;
  errors: string[];
}

export interface TraineeEntrySectionProps {
  trainees: TraineeEntry[];
  onChange: (trainees: TraineeEntry[]) => void;
  companyId?: string | null;
}

type EntryMode = "excel" | "manual" | "paste";

// ─────────────────────────────────────────────────────────────────────────
// Preview interface (from /api/requests/import/preview)
// ─────────────────────────────────────────────────────────────────────────

interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateNationalIds: { nationalId: string; rows: number[] }[];
  rows: {
    rowNumber: number;
    name: string;
    nationalId: string;
    nationality: string | null;
    jobTitle: string | null;
    companyName: string;
    courseTitle: string;
    phone: string | null;
    email: string | null;
    valid: boolean;
    errors: string[];
  }[];
  missingRequiredColumns: { field: string; canonicalAlias: string }[];
  matchedColumns: { field: string; header: string }[];
  unmatchedHeaders: string[];
  traineeCount: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export function TraineeEntrySection({ trainees, onChange, companyId }: TraineeEntrySectionProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [mode, setMode] = useState<EntryMode>("excel");
  const [importing, setImporting] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [uploadingIdFor, setUploadingIdFor] = useState<string | null>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────

  const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const validateTrainee = (t: Partial<TraineeEntry>): string[] => {
    const errors: string[] = [];
    if (!t.fullName?.trim()) errors.push("Missing name");
    if (!t.nationalId?.trim()) errors.push("Missing ID/Iqama");
    return errors;
  };

  const updateTrainees = (newTrainees: TraineeEntry[]) => {
    // Validate all + detect duplicates
    const nationalIdMap = new Map<string, number[]>();
    newTrainees.forEach((t, i) => {
      if (!t.nationalId) return;
      const key = t.nationalId.trim().toLowerCase();
      if (!nationalIdMap.has(key)) nationalIdMap.set(key, []);
      nationalIdMap.get(key)!.push(i);
    });

    const validated = newTrainees.map((t, i) => {
      const errors = validateTrainee(t);
      const key = t.nationalId?.trim().toLowerCase();
      if (key && nationalIdMap.get(key)!.length > 1) {
        errors.push("Duplicate ID");
      }
      return { ...t, valid: errors.length === 0, errors };
    });
    onChange(validated);
  };

  // ─── Excel Import ─────────────────────────────────────────────────────

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingFile(file);
    setImporting(true);
    try {
      const result = await api.postFile<ImportPreview>("/requests/import/preview", file);
      setPreviewData(result);
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
      setPendingFile(null);
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmExcelImport = () => {
    if (!previewData) return;
    // Convert preview rows to TraineeEntry objects
    const newTrainees: TraineeEntry[] = previewData.rows
      .filter((r) => r.valid)
      .map((r) => ({
        id: generateId(),
        fullName: r.name,
        nationalId: r.nationalId,
        nationality: r.nationality ?? "",
        jobTitle: r.jobTitle ?? "",
        idAttachmentUrl: null,
        idAttachmentName: null,
        valid: true,
        errors: [],
      }));
    updateTrainees([...trainees, ...newTrainees]);
    setPreviewData(null);
    setPendingFile(null);
    toast({
      title: t("misc.success"),
      description: `Imported ${newTrainees.length} trainee(s)`,
    });
  };

  // ─── Manual Entry ─────────────────────────────────────────────────────

  const addRow = () => {
    const newRow: TraineeEntry = {
      id: generateId(),
      fullName: "",
      nationalId: "",
      nationality: "",
      jobTitle: "",
      idAttachmentUrl: null,
      idAttachmentName: null,
      valid: false,
      errors: [],
    };
    updateTrainees([...trainees, newRow]);
  };

  const addRows = (count: number) => {
    const newRows: TraineeEntry[] = Array.from({ length: count }, () => ({
      id: generateId(),
      fullName: "",
      nationalId: "",
      nationality: "",
      jobTitle: "",
      idAttachmentUrl: null,
      idAttachmentName: null,
      valid: false,
      errors: [],
    }));
    updateTrainees([...trainees, ...newRows]);
  };

  const updateRow = (id: string, field: keyof TraineeEntry, value: string) => {
    const updated = trainees.map((t) => (t.id === id ? { ...t, [field]: value } : t));
    updateTrainees(updated);
  };

  const deleteRow = (id: string) => {
    updateTrainees(trainees.filter((t) => t.id !== id));
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const deleteSelected = () => {
    updateTrainees(trainees.filter((t) => !selectedRows.has(t.id)));
    setSelectedRows(new Set());
  };

  const toggleSelectRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === trainees.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(trainees.map((t) => t.id)));
    }
  };

  // ─── ID Attachment Upload ─────────────────────────────────────────────

  const handleIdUpload = async (traineeId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingIdFor(traineeId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api.postFile<{ url: string; filename: string }>("/trainees/upload-id", file);
      updateRow(traineeId, "idAttachmentUrl", result.url);
      updateRow(traineeId, "idAttachmentName" as keyof TraineeEntry, file.name);
      toast({ title: t("misc.success"), description: "ID attachment uploaded" });
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploadingIdFor(null);
    }
  };

  // ─── Copy & Paste ─────────────────────────────────────────────────────

  const handlePasteImport = () => {
    const text = pasteText.trim();
    if (!text) return;

    // Parse tab-separated values (from Excel/Google Sheets clipboard)
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return;

    // Detect delimiter: tab (Excel/Google Sheets) or comma (CSV)
    const firstLine = lines[0];
    const delimiter = firstLine.includes("\t") ? "\t" : ",";

    // Check if the first row is a header
    const headerLine = firstLine.toLowerCase();
    const hasHeader = headerLine.includes("name") || headerLine.includes("الاسم") || headerLine.includes("id") || headerLine.includes("هوية");

    const dataLines = hasHeader ? lines.slice(1) : lines;

    // If header, try to map columns; otherwise assume a default order:
    // Name, National ID, Nationality, Job Title
    let colMap: Record<string, number> = { name: 0, nationalId: 1, nationality: 2, jobTitle: 3 };
    if (hasHeader) {
      const headers = firstLine.split(delimiter).map((h) => h.trim().toLowerCase());
      colMap = {};
      headers.forEach((h, i) => {
        if (h === "name" || h === "الاسم" || h === "employee name" || h === "trainee name" || h === "full name") colMap.name = i;
        else if (h === "national id" || h === "id" || h === "iqama" || h === "رقم الهوية" || h === "رقم الاقامة" || h === "nationality id") colMap.nationalId = i;
        else if (h === "nationality" || h === "الجنسية" || h === "national") colMap.nationality = i;
        else if (h === "job" || h === "job title" || h === "occupation" || h === "position" || h === "المهنة" || h === "الوظيفة") colMap.jobTitle = i;
      });
      // Default if headers didn't match
      if (colMap.name === undefined) colMap.name = 0;
      if (colMap.nationalId === undefined) colMap.nationalId = 1;
      if (colMap.nationality === undefined) colMap.nationality = 2;
      if (colMap.jobTitle === undefined) colMap.jobTitle = 3;
    }

    const newTrainees: TraineeEntry[] = dataLines.map((line) => {
      const cells = line.split(delimiter).map((c) => c.trim());
      return {
        id: generateId(),
        fullName: cells[colMap.name] ?? "",
        nationalId: cells[colMap.nationalId] ?? "",
        nationality: cells[colMap.nationality] ?? "",
        jobTitle: cells[colMap.jobTitle] ?? "",
        idAttachmentUrl: null,
        idAttachmentName: null,
        valid: false,
        errors: [],
      };
    });

    updateTrainees([...trainees, ...newTrainees]);
    setPasteText("");
    toast({
      title: t("misc.success"),
      description: `Pasted ${newTrainees.length} trainee(s)`,
    });
  };

  // ─── Stats ────────────────────────────────────────────────────────────

  const validCount = trainees.filter((t) => t.valid).length;
  const invalidCount = trainees.length - validCount;

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="gap-1.5">
          <Users className="h-3.5 w-3.5" />
          {trainees.length} {t("requests.import.trainees") || "trainees"}
        </Badge>
        {validCount > 0 && (
          <Badge variant="outline" className="gap-1.5 text-green-600 border-green-500/30 bg-green-500/5">
            <Check className="h-3.5 w-3.5" />
            {validCount} valid
          </Badge>
        )}
        {invalidCount > 0 && (
          <Badge variant="outline" className="gap-1.5 text-red-600 border-red-500/30 bg-red-500/5">
            <AlertCircle className="h-3.5 w-3.5" />
            {invalidCount} invalid
          </Badge>
        )}
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 border-b">
        <ModeTab active={mode === "excel"} onClick={() => setMode("excel")} icon={FileSpreadsheet} label="Excel Import" />
        <ModeTab active={mode === "manual"} onClick={() => setMode("manual")} icon={Plus} label="Manual Entry" />
        <ModeTab active={mode === "paste"} onClick={() => setMode("paste")} icon={ClipboardPaste} label="Copy & Paste" />
      </div>

      {/* Excel Import tab */}
      {mode === "excel" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleExcelUpload(e)} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Upload className="h-4 w-4 me-1.5" />}
              {importing ? "Previewing..." : "Upload Excel File"}
            </Button>
            {pendingFile && !previewData && <span className="text-xs text-muted-foreground">{pendingFile.name}</span>}
          </div>

          {/* Preview results */}
          {previewData && (
            <div className="border rounded-md p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="border rounded p-2">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-xl font-bold">{previewData.totalRows}</div>
                </div>
                <div className="border rounded p-2 border-green-500/30 bg-green-500/5">
                  <div className="text-xs text-muted-foreground">Valid</div>
                  <div className="text-xl font-bold text-green-600">{previewData.validRows}</div>
                </div>
                <div className="border rounded p-2 border-red-500/30 bg-red-500/5">
                  <div className="text-xs text-muted-foreground">Invalid</div>
                  <div className="text-xl font-bold text-red-600">{previewData.invalidRows}</div>
                </div>
                <div className="border rounded p-2 border-blue-500/30 bg-blue-500/5">
                  <div className="text-xs text-muted-foreground">Trainees</div>
                  <div className="text-xl font-bold text-blue-600">{previewData.traineeCount}</div>
                </div>
              </div>

              {previewData.missingRequiredColumns.length > 0 && (
                <div className="border border-red-500/30 bg-red-500/5 rounded p-2 text-xs text-red-700">
                  <strong>Missing required columns:</strong>{" "}
                  {previewData.missingRequiredColumns.map((m) => m.canonicalAlias).join(", ")}
                </div>
              )}

              {previewData.duplicateNationalIds.length > 0 && (
                <div className="border border-orange-500/30 bg-orange-500/5 rounded p-2 text-xs text-orange-700">
                  <strong>Duplicate IDs:</strong>{" "}
                  {previewData.duplicateNationalIds.map((d) => d.nationalId).join(", ")}
                </div>
              )}

              {/* Row preview */}
              <div className="max-h-48 overflow-y-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 sticky top-0">
                    <tr>
                      <th className="text-start p-1.5">Name</th>
                      <th className="text-start p-1.5">ID</th>
                      <th className="text-start p-1.5">Job</th>
                      <th className="text-start p-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.slice(0, 10).map((r) => (
                      <tr key={r.rowNumber} className="border-t">
                        <td className="p-1.5">{r.name || "—"}</td>
                        <td className="p-1.5 font-mono">{r.nationalId || "—"}</td>
                        <td className="p-1.5">{r.jobTitle || "—"}</td>
                        <td className="p-1.5">
                          {r.valid ? (
                            <span className="text-green-600">✓</span>
                          ) : (
                            <span className="text-red-600" title={r.errors.join("; ")}>✗</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleConfirmExcelImport}
                  disabled={previewData.validRows === 0 || previewData.missingRequiredColumns.length > 0}
                >
                  <Check className="h-4 w-4 me-1.5" />
                  Import {previewData.validRows} Trainees
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setPreviewData(null); setPendingFile(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Entry tab */}
      {mode === "manual" && (
        <div className="space-y-3">
          {/* Add row buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => addRow()}>
              <Plus className="h-3.5 w-3.5 me-1" /> Add Row
            </Button>
            <Button size="sm" variant="outline" onClick={() => addRows(10)}>+10 Rows</Button>
            <Button size="sm" variant="outline" onClick={() => addRows(50)}>+50 Rows</Button>
            <Button size="sm" variant="outline" onClick={() => addRows(100)}>+100 Rows</Button>
            {selectedRows.size > 0 && (
              <Button size="sm" variant="destructive" onClick={deleteSelected} className="ms-auto">
                <Trash2 className="h-3.5 w-3.5 me-1" /> Delete Selected ({selectedRows.size})
              </Button>
            )}
          </div>

          {/* Editable table */}
          {trainees.length > 0 && (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="p-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectedRows.size === trainees.length && trainees.length > 0}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded"
                      />
                    </th>
                    <th className="text-start p-2 font-medium text-xs">{t("requests.traineeName") || "Name"} *</th>
                    <th className="text-start p-2 font-medium text-xs">ID / Iqama *</th>
                    <th className="text-start p-2 font-medium text-xs">Nationality</th>
                    <th className="text-start p-2 font-medium text-xs">Job Title</th>
                    <th className="text-start p-2 font-medium text-xs">ID Attachment</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {trainees.map((trainee) => (
                    <tr key={trainee.id} className={cn("border-t", !trainee.valid && "bg-red-500/5")}>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedRows.has(trainee.id)}
                          onChange={() => toggleSelectRow(trainee.id)}
                          className="h-4 w-4 rounded"
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          value={trainee.fullName}
                          onChange={(e) => updateRow(trainee.id, "fullName", e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Full name"
                        />
                        {!trainee.valid && trainee.errors.includes("Missing name") && (
                          <span className="text-[10px] text-red-500">Name required</span>
                        )}
                      </td>
                      <td className="p-1">
                        <Input
                          value={trainee.nationalId}
                          onChange={(e) => updateRow(trainee.id, "nationalId", e.target.value)}
                          className="h-8 text-xs font-mono"
                          placeholder="1234567890"
                        />
                        {!trainee.valid && trainee.errors.includes("Missing ID/Iqama") && (
                          <span className="text-[10px] text-red-500">ID required</span>
                        )}
                        {!trainee.valid && trainee.errors.includes("Duplicate ID") && (
                          <span className="text-[10px] text-orange-500">Duplicate</span>
                        )}
                      </td>
                      <td className="p-1">
                        <Input
                          value={trainee.nationality}
                          onChange={(e) => updateRow(trainee.id, "nationality", e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Saudi"
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          value={trainee.jobTitle}
                          onChange={(e) => updateRow(trainee.id, "jobTitle", e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Electrician"
                        />
                      </td>
                      <td className="p-1">
                        {trainee.idAttachmentUrl ? (
                          <div className="flex items-center gap-1">
                            <a href={trainee.idAttachmentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                              <Link2 className="h-3 w-3" /> View
                            </a>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              className="hidden"
                              id={`id-upload-${trainee.id}`}
                              onChange={(e) => void handleIdUpload(trainee.id, e)}
                            />
                            <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => document.getElementById(`id-upload-${trainee.id}`)?.click()}>
                              Replace
                            </Button>
                          </div>
                        ) : (
                          <>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              className="hidden"
                              id={`id-upload-${trainee.id}`}
                              onChange={(e) => void handleIdUpload(trainee.id, e)}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={uploadingIdFor === trainee.id}
                              onClick={() => document.getElementById(`id-upload-${trainee.id}`)?.click()}
                            >
                              {uploadingIdFor === trainee.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileUp className="h-3 w-3 me-1" />
                              )}
                              Upload
                            </Button>
                          </>
                        )}
                      </td>
                      <td className="p-1 text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => deleteRow(trainee.id)}>
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {trainees.length === 0 && (
            <div className="border border-dashed rounded-md p-8 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No trainees yet. Click "Add Row" to start, or switch to Excel/Paste mode.</p>
            </div>
          )}
        </div>
      )}

      {/* Copy & Paste tab */}
      {mode === "paste" && (
        <div className="space-y-3">
          <div className="border border-blue-500/30 bg-blue-500/5 rounded-md p-3 text-xs text-muted-foreground">
            <strong>How to use:</strong> Copy cells from Excel, Google Sheets, or any HR system (Ctrl+C / Cmd+C), then paste into the textarea below (Ctrl+V / Cmd+V).
            The first row can be a header (e.g., "Name, ID, Nationality, Job") or direct data.
            Columns should be separated by tabs (default Excel copy) or commas.
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Paste here — e.g.:\nName\tID\tNationality\tJob\nAhmed Ali\t1234567890\tSaudi\tElectrician\nKhalid Hassan\t9876543210\tEgyptian\tPlumber"}
            className="w-full min-h-[200px] p-3 border rounded-md text-xs font-mono resize-y"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handlePasteImport} disabled={!pasteText.trim()}>
              <ClipboardPaste className="h-4 w-4 me-1.5" />
              Parse & Add Trainees
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPasteText("")}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Trainee count summary (auto-calculated, shown to user) */}
      <div className="border-t pt-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t("requests.import.traineeCount") || "Trainees"}: <span className="font-bold text-foreground">{validCount}</span> valid / {trainees.length} total
        </div>
        <div className="text-xs text-muted-foreground">
          {t("requests.import.traineeCount") || "Trainee count"} is auto-calculated
        </div>
      </div>
    </div>
  );
}

// ─── Tab button ──────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
