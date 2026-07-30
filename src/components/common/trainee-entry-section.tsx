"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileSpreadsheet, ClipboardPaste, Plus, Trash2,
  AlertCircle, Check, X, Users, FileUp, Link2, Loader2,
  Search, Filter, FileArchive, CheckCircle2, AlertTriangle,
  Save, ChevronUp, ChevronDown,
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
  /** Optional: save draft callback (called when user clicks "Save Draft") */
  onSaveDraft?: () => void;
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
// Bulk attachment matching result
// ─────────────────────────────────────────────────────────────────────────

interface BulkAttachmentResult {
  matched: { fileName: string; nationalId: string; url: string; traineeId: string }[];
  unmatched: { fileName: string; reason: string }[];
  missingAttachments: { traineeId: string; fullName: string; nationalId: string }[];
}

// ─────────────────────────────────────────────────────────────────────────
// Virtualized row — renders only visible rows for performance with 500+ rows
// ─────────────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 48; // px per row
const VISIBLE_ROWS_BUFFER = 5; // extra rows rendered above/below viewport

interface VirtualizedTableProps {
  trainees: TraineeEntry[];
  selectedRows: Set<string>;
  onToggleSelectRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onUpdateRow: (id: string, field: keyof TraineeEntry, value: string) => void;
  onDeleteRow: (id: string) => void;
  onUploadId: (traineeId: string, e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingIdFor: string | null;
  highlightSet: Set<string>;
  traineesLabel: string;
}

function VirtualizedTable({
  trainees, selectedRows, onToggleSelectRow, onToggleSelectAll,
  onUpdateRow, onDeleteRow, onUploadId, uploadingIdFor, highlightSet, traineesLabel,
}: VirtualizedTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_ROWS_BUFFER);
  const endIndex = Math.min(
    trainees.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + VISIBLE_ROWS_BUFFER
  );
  const visibleTrainees = trainees.slice(startIndex, endIndex);
  const totalHeight = trainees.length * ROW_HEIGHT;
  const offsetY = startIndex * ROW_HEIGHT;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Update viewport height on mount + resize
  useMemo(() => {
    if (containerRef.current) {
      setViewportHeight(containerRef.current.clientHeight);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-auto border rounded-md"
      style={{ maxHeight: "500px", overflowY: "auto" }}
      onScroll={handleScroll}
    >
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <thead className="bg-muted/30 sticky top-0 z-10">
          <tr>
            <th className="p-2 w-10" style={{ width: 40 }}>
              <input
                type="checkbox"
                checked={selectedRows.size === trainees.length && trainees.length > 0}
                onChange={onToggleSelectAll}
                className="h-4 w-4 rounded"
              />
            </th>
            <th className="text-start p-2 font-medium text-xs" style={{ width: "25%" }}>{traineesLabel} *</th>
            <th className="text-start p-2 font-medium text-xs" style={{ width: "18%" }}>ID / Iqama *</th>
            <th className="text-start p-2 font-medium text-xs" style={{ width: "15%" }}>Nationality</th>
            <th className="text-start p-2 font-medium text-xs" style={{ width: "15%" }}>Job Title</th>
            <th className="text-start p-2 font-medium text-xs" style={{ width: "20%" }}>ID Attachment</th>
            <th className="p-2" style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {/* Spacer row for virtualization offset */}
          {startIndex > 0 && (
            <tr style={{ height: offsetY }}>
              <td colSpan={7} style={{ padding: 0, border: "none" }} />
            </tr>
          )}
          {visibleTrainees.map((trainee) => (
            <tr
              key={trainee.id}
              className={cn(
                "border-t",
                !trainee.valid && "bg-red-500/5",
                highlightSet.has(trainee.id) && "ring-2 ring-blue-400 ring-inset"
              )}
              style={{ height: ROW_HEIGHT }}
            >
              <td className="p-2 text-center">
                <input
                  type="checkbox"
                  checked={selectedRows.has(trainee.id)}
                  onChange={() => onToggleSelectRow(trainee.id)}
                  className="h-4 w-4 rounded"
                />
              </td>
              <td className="p-1">
                <Input
                  value={trainee.fullName}
                  onChange={(e) => onUpdateRow(trainee.id, "fullName", e.target.value)}
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
                  onChange={(e) => onUpdateRow(trainee.id, "nationalId", e.target.value)}
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
                  onChange={(e) => onUpdateRow(trainee.id, "nationality", e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Saudi"
                />
              </td>
              <td className="p-1">
                <Input
                  value={trainee.jobTitle}
                  onChange={(e) => onUpdateRow(trainee.id, "jobTitle", e.target.value)}
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
                      onChange={(e) => onUploadId(trainee.id, e)}
                    />
                    <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => document.getElementById(`id-upload-${trainee.id}`)?.click()}>
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
                      onChange={(e) => onUploadId(trainee.id, e)}
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
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onDeleteRow(trainee.id)}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </td>
            </tr>
          ))}
          {/* Bottom spacer */}
          {endIndex < trainees.length && (
            <tr style={{ height: (trainees.length - endIndex) * ROW_HEIGHT }}>
              <td colSpan={7} style={{ padding: 0, border: "none" }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export function TraineeEntrySection({ trainees, onChange, companyId, onSaveDraft }: TraineeEntrySectionProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [mode, setMode] = useState<EntryMode>("excel");
  const [importing, setImporting] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [uploadingIdFor, setUploadingIdFor] = useState<string | null>(null);

  // ─── Enhancement 3: Search & Filter ───────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMissingAttachment, setFilterMissingAttachment] = useState(false);
  const [filterInvalid, setFilterInvalid] = useState(false);
  const [filterDuplicate, setFilterDuplicate] = useState(false);

  // ─── Enhancement 5: Validation Summary jump-to ────────────────────────
  const [highlightSet, setHighlightSet] = useState<Set<string>>(new Set());
  const [showSearch, setShowSearch] = useState(false);

  // ─── Enhancement 6: Bulk attachment progress ──────────────────────────
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{
    visible: boolean;
    phase: "uploading" | "matching" | "completed";
    current: number;
    total: number;
    result?: BulkAttachmentResult;
  } | null>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────

  const generateId = useCallback(() => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, []);

  const validateTrainee = useCallback((t: Partial<TraineeEntry>): string[] => {
    const errors: string[] = [];
    if (!t.fullName?.trim()) errors.push("Missing name");
    if (!t.nationalId?.trim()) errors.push("Missing ID/Iqama");
    return errors;
  }, []);

  const updateTrainees = useCallback((newTrainees: TraineeEntry[]) => {
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
  }, [onChange, validateTrainee]);

  // ─── Enhancement 5: Computed validation summary (useMemo for perf) ────

  const stats = useMemo(() => {
    const nationalIdMap = new Map<string, number[]>();
    trainees.forEach((t, i) => {
      if (!t.nationalId) return;
      const key = t.nationalId.trim().toLowerCase();
      if (!nationalIdMap.has(key)) nationalIdMap.set(key, []);
      nationalIdMap.get(key)!.push(i);
    });
    const duplicateIds = new Set<string>();
    for (const [, indices] of nationalIdMap) {
      if (indices.length > 1) {
        indices.forEach((i) => duplicateIds.add(trainees[i].id));
      }
    }
    const validCount = trainees.filter((t) => t.valid).length;
    const missingAttachments = trainees.filter((t) => !t.idAttachmentUrl);
    return {
      total: trainees.length,
      valid: validCount,
      invalid: trainees.length - validCount,
      duplicateCount: duplicateIds.size,
      missingAttachmentCount: missingAttachments.length,
      duplicateIds,
      missingAttachmentIds: new Set(missingAttachments.map((t) => t.id)),
      invalidIds: new Set(trainees.filter((t) => !t.valid).map((t) => t.id)),
    };
  }, [trainees]);

  // ─── Enhancement 3: Filtered + searched trainees (useMemo for perf) ───

  const filteredTrainees = useMemo(() => {
    if (!searchQuery && !filterMissingAttachment && !filterInvalid && !filterDuplicate) {
      return trainees;
    }
    const q = searchQuery.trim().toLowerCase();
    return trainees.filter((t) => {
      if (q && !t.fullName.toLowerCase().includes(q) && !t.nationalId.toLowerCase().includes(q)) return false;
      if (filterMissingAttachment && t.idAttachmentUrl) return false;
      if (filterInvalid && t.valid) return false;
      if (filterDuplicate && !stats.duplicateIds.has(t.id)) return false;
      return true;
    });
  }, [trainees, searchQuery, filterMissingAttachment, filterInvalid, filterDuplicate, stats.duplicateIds]);

  // ─── Enhancement 5: Jump-to function ──────────────────────────────────

  const jumpToRows = useCallback((ids: Set<string>) => {
    setHighlightSet(ids);
    setShowSearch(true);
    setTimeout(() => setHighlightSet(new Set()), 3000); // clear highlight after 3s
  }, []);

  // ─── Excel Import (unchanged) ─────────────────────────────────────────

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
    toast({ title: t("misc.success"), description: `Imported ${newTrainees.length} trainee(s)` });
  };

  // ─── Manual Entry (useCallback for stable handlers) ───────────────────

  const addRows = useCallback((count: number) => {
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
  }, [trainees, updateTrainees, generateId]);

  const addRow = useCallback(() => addRows(1), [addRows]);

  const updateRow = useCallback((id: string, field: keyof TraineeEntry, value: string) => {
    const updated = trainees.map((t) => (t.id === id ? { ...t, [field]: value } : t));
    updateTrainees(updated);
  }, [trainees, updateTrainees]);

  const deleteRow = useCallback((id: string) => {
    updateTrainees(trainees.filter((t) => t.id !== id));
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [trainees, updateTrainees]);

  const deleteSelected = useCallback(() => {
    updateTrainees(trainees.filter((t) => !selectedRows.has(t.id)));
    setSelectedRows(new Set());
  }, [trainees, selectedRows, updateTrainees]);

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedRows.size === filteredTrainees.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredTrainees.map((t) => t.id)));
    }
  }, [selectedRows, filteredTrainees]);

  // ─── Single ID Attachment Upload (unchanged) ──────────────────────────

  const handleIdUpload = async (traineeId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingIdFor(traineeId);
    try {
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

  // ─── Enhancement 1: Bulk ID Attachment Upload ─────────────────────────

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setBulkUploadProgress({ visible: true, phase: "uploading", current: 0, total: files.length });

    try {
      // Phase 1: Upload all files
      const uploadedFiles: { fileName: string; url: string; nationalId: string | null }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBulkUploadProgress({ visible: true, phase: "uploading", current: i + 1, total: files.length });
        try {
          const result = await api.postFile<{ url: string; filename: string }>("/trainees/upload-id", file);
          // Extract national ID from filename (strip extension)
          const nationalId = file.name.replace(/\.(jpg|jpeg|png|webp|pdf)$/i, "").trim();
          uploadedFiles.push({ fileName: file.name, url: result.url, nationalId });
        } catch {
          // Skip failed uploads
        }
      }

      // Phase 2: Match files to trainees by national ID
      setBulkUploadProgress({ visible: true, phase: "matching", current: 0, total: uploadedFiles.length });

      const result: BulkAttachmentResult = {
        matched: [],
        unmatched: [],
        missingAttachments: [],
      };

      const traineeByNationalId = new Map<string, TraineeEntry>();
      trainees.forEach((t) => {
        if (t.nationalId) traineeByNationalId.set(t.nationalId.trim().toLowerCase(), t);
      });

      for (const f of uploadedFiles) {
        if (f.nationalId) {
          const trainee = traineeByNationalId.get(f.nationalId.toLowerCase());
          if (trainee) {
            result.matched.push({
              fileName: f.fileName,
              nationalId: f.nationalId,
              url: f.url,
              traineeId: trainee.id,
            });
          } else {
            result.unmatched.push({ fileName: f.fileName, reason: `No trainee with ID ${f.nationalId}` });
          }
        } else {
          result.unmatched.push({ fileName: f.fileName, reason: "Could not extract ID from filename" });
        }
      }

      // Apply matched attachments
      const updated = trainees.map((t) => {
        const match = result.matched.find((m) => m.traineeId === t.id);
        if (match) {
          return { ...t, idAttachmentUrl: match.url, idAttachmentName: match.fileName };
        }
        return t;
      });
      updateTrainees(updated);

      // Find missing attachments (trainees with no attachment)
      result.missingAttachments = trainees
        .filter((t) => !t.idAttachmentUrl && !result.matched.find((m) => m.traineeId === t.id))
        .map((t) => ({ traineeId: t.id, fullName: t.fullName, nationalId: t.nationalId }));

      setBulkUploadProgress({ visible: true, phase: "completed", current: files.length, total: files.length, result });
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
      setBulkUploadProgress(null);
    }
  };

  // Manual attachment correction (for unmatched files)
  const assignAttachmentManually = (traineeId: string, url: string, fileName: string) => {
    updateRow(traineeId, "idAttachmentUrl", url);
    updateRow(traineeId, "idAttachmentName" as keyof TraineeEntry, fileName);
  };

  // ─── Copy & Paste (unchanged logic) ───────────────────────────────────

  const handlePasteImport = useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return;

    const firstLine = lines[0];
    const delimiter = firstLine.includes("\t") ? "\t" : ",";
    const headerLine = firstLine.toLowerCase();
    const hasHeader = headerLine.includes("name") || headerLine.includes("الاسم") || headerLine.includes("id") || headerLine.includes("هوية");

    const dataLines = hasHeader ? lines.slice(1) : lines;

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
    toast({ title: t("misc.success"), description: `Pasted ${newTrainees.length} trainee(s)` });
  }, [pasteText, trainees, updateTrainees, generateId, t]);

  // ─── Enhancement 7: Validation for submission ─────────────────────────

  const submissionValid = useMemo(() => {
    return stats.valid > 0 && stats.invalid === 0 && stats.duplicateCount === 0;
  }, [stats]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Enhancement 5: Validation Summary — clickable stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button
          onClick={() => jumpToRows(new Set(trainees.map((t) => t.id)))}
          className="border rounded-md p-2 text-center hover:bg-muted/50 transition-colors"
        >
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Users className="h-3 w-3" /> Total</div>
          <div className="text-xl font-bold">{stats.total}</div>
        </button>
        <button
          onClick={() => jumpToRows(new Set(trainees.filter((t) => t.valid).map((t) => t.id)))}
          className="border rounded-md p-2 text-center border-green-500/30 bg-green-500/5 hover:bg-green-500/10 transition-colors"
        >
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><CheckCircle2 className="h-3 w-3" /> Valid</div>
          <div className="text-xl font-bold text-green-600">{stats.valid}</div>
        </button>
        <button
          onClick={() => jumpToRows(stats.invalidIds)}
          className="border rounded-md p-2 text-center border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition-colors"
          disabled={stats.invalid === 0}
        >
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><AlertCircle className="h-3 w-3" /> Invalid</div>
          <div className="text-xl font-bold text-red-600">{stats.invalid}</div>
        </button>
        <button
          onClick={() => { setFilterDuplicate(true); jumpToRows(stats.duplicateIds); }}
          className="border rounded-md p-2 text-center border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 transition-colors"
          disabled={stats.duplicateCount === 0}
        >
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" /> Duplicates</div>
          <div className="text-xl font-bold text-orange-600">{stats.duplicateCount}</div>
        </button>
        <button
          onClick={() => { setFilterMissingAttachment(true); jumpToRows(stats.missingAttachmentIds); }}
          className="border rounded-md p-2 text-center border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
          disabled={stats.missingAttachmentCount === 0}
        >
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><FileUp className="h-3 w-3" /> Missing ID</div>
          <div className="text-xl font-bold text-blue-600">{stats.missingAttachmentCount}</div>
        </button>
      </div>

      {/* Enhancement 7: Submission validation warnings */}
      {!submissionValid && stats.total > 0 && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-md p-3 text-sm text-red-700">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertCircle className="h-4 w-4" /> Cannot submit — fix these issues first:
          </div>
          <ul className="text-xs space-y-0.5 ms-6">
            {stats.invalid > 0 && <li>• {stats.invalid} trainee(s) with missing required fields (name or ID/Iqama)</li>}
            {stats.duplicateCount > 0 && <li>• {stats.duplicateCount} trainee(s) with duplicate ID/Iqama numbers</li>}
            {stats.valid === 0 && <li>• No valid trainees — add at least 1 valid trainee</li>}
          </ul>
        </div>
      )}

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

          {previewData && (
            <div className="border rounded-md p-3 space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Total</div><div className="text-xl font-bold">{previewData.totalRows}</div></div>
                <div className="border rounded p-2 border-green-500/30 bg-green-500/5"><div className="text-xs text-muted-foreground">Valid</div><div className="text-xl font-bold text-green-600">{previewData.validRows}</div></div>
                <div className="border rounded p-2 border-red-500/30 bg-red-500/5"><div className="text-xs text-muted-foreground">Invalid</div><div className="text-xl font-bold text-red-600">{previewData.invalidRows}</div></div>
                <div className="border rounded p-2 border-blue-500/30 bg-blue-500/5"><div className="text-xs text-muted-foreground">Trainees</div><div className="text-xl font-bold text-blue-600">{previewData.traineeCount}</div></div>
              </div>
              {previewData.missingRequiredColumns.length > 0 && (
                <div className="border border-red-500/30 bg-red-500/5 rounded p-2 text-xs text-red-700"><strong>Missing required columns:</strong> {previewData.missingRequiredColumns.map((m) => m.canonicalAlias).join(", ")}</div>
              )}
              {previewData.duplicateNationalIds.length > 0 && (
                <div className="border border-orange-500/30 bg-orange-500/5 rounded p-2 text-xs text-orange-700"><strong>Duplicate IDs:</strong> {previewData.duplicateNationalIds.map((d) => d.nationalId).join(", ")}</div>
              )}
              <div className="max-h-48 overflow-y-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 sticky top-0"><tr><th className="text-start p-1.5">Name</th><th className="text-start p-1.5">ID</th><th className="text-start p-1.5">Job</th><th className="text-start p-1.5">Status</th></tr></thead>
                  <tbody>
                    {previewData.rows.slice(0, 10).map((r) => (
                      <tr key={r.rowNumber} className="border-t"><td className="p-1.5">{r.name || "—"}</td><td className="p-1.5 font-mono">{r.nationalId || "—"}</td><td className="p-1.5">{r.jobTitle || "—"}</td><td className="p-1.5">{r.valid ? <span className="text-green-600">✓</span> : <span className="text-red-600" title={r.errors.join("; ")}>✗</span>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleConfirmExcelImport} disabled={previewData.validRows === 0 || previewData.missingRequiredColumns.length > 0}><Check className="h-4 w-4 me-1.5" /> Import {previewData.validRows} Trainees</Button>
                <Button size="sm" variant="outline" onClick={() => { setPreviewData(null); setPendingFile(null); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Entry tab */}
      {mode === "manual" && (
        <div className="space-y-3">
          {/* Row buttons + bulk upload + save draft */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => addRow()}><Plus className="h-3.5 w-3.5 me-1" /> Add Row</Button>
            <Button size="sm" variant="outline" onClick={() => addRows(10)}>+10</Button>
            <Button size="sm" variant="outline" onClick={() => addRows(50)}>+50</Button>
            <Button size="sm" variant="outline" onClick={() => addRows(100)}>+100</Button>
            <input ref={bulkFileInputRef} type="file" multiple accept="image/*,application/pdf,.zip" className="hidden" onChange={(e) => void handleBulkUpload(e)} />
            <Button size="sm" variant="outline" onClick={() => bulkFileInputRef.current?.click()} disabled={trainees.length === 0}>
              <FileArchive className="h-3.5 w-3.5 me-1" /> Bulk Upload IDs
            </Button>
            {selectedRows.size > 0 && (
              <Button size="sm" variant="destructive" onClick={deleteSelected} className="ms-auto">
                <Trash2 className="h-3.5 w-3.5 me-1" /> Delete ({selectedRows.size})
              </Button>
            )}
            {onSaveDraft && (
              <Button size="sm" variant="outline" onClick={onSaveDraft} className={selectedRows.size === 0 ? "ms-auto" : ""}>
                <Save className="h-3.5 w-3.5 me-1" /> Save Draft
              </Button>
            )}
          </div>

          {/* Enhancement 6: Bulk upload progress */}
          {bulkUploadProgress?.visible && (
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                {bulkUploadProgress.phase === "uploading" && <><Loader2 className="h-4 w-4 animate-spin" /> Uploading files...</>}
                {bulkUploadProgress.phase === "matching" && <><Loader2 className="h-4 w-4 animate-spin" /> Matching files to trainees...</>}
                {bulkUploadProgress.phase === "completed" && <><CheckCircle2 className="h-4 w-4 text-green-600" /> Completed</>}
                <span className="ms-auto text-xs text-muted-foreground">
                  {bulkUploadProgress.current} / {bulkUploadProgress.total}
                  {bulkUploadProgress.phase === "uploading" && ` (${Math.round((bulkUploadProgress.current / bulkUploadProgress.total) * 100)}%)`}
                </span>
              </div>
              {/* Progress bar */}
              {bulkUploadProgress.phase !== "completed" && (
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${(bulkUploadProgress.current / bulkUploadProgress.total) * 100}%` }} />
                </div>
              )}
              {/* Results */}
              {bulkUploadProgress.result && (
                <div className="space-y-1 text-xs">
                  {bulkUploadProgress.result.matched.length > 0 && (
                    <div className="text-green-600">✓ Matched: {bulkUploadProgress.result.matched.length} file(s)</div>
                  )}
                  {bulkUploadProgress.result.unmatched.length > 0 && (
                    <div className="text-orange-600">
                      ⚠ Unmatched: {bulkUploadProgress.result.unmatched.length} file(s)
                      <ul className="ms-4 mt-0.5">
                        {bulkUploadProgress.result.unmatched.slice(0, 5).map((u, i) => (
                          <li key={i}>• {u.fileName} — {u.reason}</li>
                        ))}
                        {bulkUploadProgress.result.unmatched.length > 5 && <li>... and {bulkUploadProgress.result.unmatched.length - 5} more</li>}
                      </ul>
                    </div>
                  )}
                  {bulkUploadProgress.result.missingAttachments.length > 0 && (
                    <div className="text-blue-600">⚠ Missing attachments: {bulkUploadProgress.result.missingAttachments.length} trainee(s) have no ID file</div>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 text-xs mt-1" onClick={() => setBulkUploadProgress(null)}>Dismiss</Button>
                </div>
              )}
            </div>
          )}

          {/* Enhancement 3: Search & Filter */}
          {trainees.length > 20 && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or ID..."
                  className="h-8 text-xs ps-7"
                />
              </div>
              <Button size="sm" variant={filterMissingAttachment ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFilterMissingAttachment(!filterMissingAttachment)}>
                <Filter className="h-3 w-3 me-1" /> Missing ID
              </Button>
              <Button size="sm" variant={filterInvalid ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFilterInvalid(!filterInvalid)}>
                <Filter className="h-3 w-3 me-1" /> Invalid
              </Button>
              <Button size="sm" variant={filterDuplicate ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFilterDuplicate(!filterDuplicate)}>
                <Filter className="h-3 w-3 me-1" /> Duplicates
              </Button>
              {(searchQuery || filterMissingAttachment || filterInvalid || filterDuplicate) && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setSearchQuery(""); setFilterMissingAttachment(false); setFilterInvalid(false); setFilterDuplicate(false); }}>
                  Clear
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                Showing {filteredTrainees.length} of {trainees.length}
              </span>
            </div>
          )}

          {/* Enhancement 4: Virtualized table for 500+ rows */}
          {trainees.length > 0 ? (
            <VirtualizedTable
              trainees={filteredTrainees}
              selectedRows={selectedRows}
              onToggleSelectRow={toggleSelectRow}
              onToggleSelectAll={toggleSelectAll}
              onUpdateRow={updateRow}
              onDeleteRow={deleteRow}
              onUploadId={handleIdUpload}
              uploadingIdFor={uploadingIdFor}
              highlightSet={highlightSet}
              traineesLabel={t("requests.traineeName") || "Name"}
            />
          ) : (
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
            <strong>How to use:</strong> Copy cells from Excel, Google Sheets, or any HR system (Ctrl+C / Cmd+C), then paste into the textarea below (Ctrl+V / Cmd+V). The first row can be a header or direct data. Columns should be separated by tabs (default Excel copy) or commas.
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Paste here — e.g.:\nName\tID\tNationality\tJob\nAhmed Ali\t1234567890\tSaudi\tElectrician\nKhalid Hassan\t9876543210\tEgyptian\tPlumber"}
            className="w-full min-h-[200px] p-3 border rounded-md text-xs font-mono resize-y"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handlePasteImport} disabled={!pasteText.trim()}><ClipboardPaste className="h-4 w-4 me-1.5" /> Parse & Add Trainees</Button>
            <Button size="sm" variant="outline" onClick={() => setPasteText("")}>Clear</Button>
          </div>
        </div>
      )}

      {/* Trainee count summary (auto-calculated) */}
      <div className="border-t pt-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t("requests.import.traineeCount") || "Trainees"}: <span className="font-bold text-foreground">{stats.valid}</span> valid / {stats.total} total
        </div>
        <div className="text-xs text-muted-foreground">{t("requests.import.traineeCount") || "Trainee count"} is auto-calculated</div>
      </div>
    </div>
  );
}

// ─── Tab button ──────────────────────────────────────────────────────────

function ModeTab({
  active, onClick, icon: Icon, label,
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
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
