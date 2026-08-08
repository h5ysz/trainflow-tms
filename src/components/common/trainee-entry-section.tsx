"use client";

// GCCLAB TMS — TraineeEntrySection
// =====================================================================
// The trainee-entry surface embedded inside the New Training Request form.
// Replaces the old fixed `traineeCount` integer input with a real editor
// backed by a `TraineeEntry[]` array the parent owns.
//
// Three tabs:
//   • Excel Import   — drop a registration-sheet .xlsx, preview the mapping,
//                       then load the parsed rows into the live table.
//   • Manual Entry   — virtualized table with per-row editing, bulk ID
//                       attachment upload (auto-matched by filename → national
//                       ID), search, filters, validation summary, and click-
//                       to-jump-to-row navigation.
//   • Copy & Paste   — paste a TSV/CSV block; we detect the delimiter, parse
//                       the header row, and append to the trainee list.
//
// Submission safety: the parent form is expected to gate its submit on
// `canSubmit` (no rows / invalid rows / duplicate national IDs all block).
//
// Performance: the table is windowed (ROW_HEIGHT = 48px) so 500+ row sheets
// stay smooth — only the visible slice is in the DOM.

import * as React from "react";
import { useI18n, type DictKey } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Upload, FileSpreadsheet, Copy, ClipboardPaste, Plus, Trash2, Search,
  AlertCircle, CheckCircle2, Users, FileWarning, CopyPlus, X, Paperclip,
  Save, ArrowRight, RotateCcw, Loader2,
  Maximize2, Minimize2,
  FileText, FileImage, FileCheck, FileX, FolderUp, Eye,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TraineeDocument {
  url: string;
  filename: string;
  type: "iqama" | "id" | "passport" | "certificate" | "ohs" | "other";
  uploadedAt: string;
}

export interface TraineeEntry {
  id: string;
  fullName: string;
  nationalId: string;
  nationality: string;
  jobTitle: string;
  idAttachmentUrl: string | null;
  idAttachmentName: string | null;
  // ── Multi-document support ──
  documents: TraineeDocument[];
  valid: boolean;
  errors: string[];
}

export interface ImportPreviewColumnMatch {
  field: string;
  header: string;
}

export interface ImportPreviewRow {
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
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  traineeCount: number;
  matchedColumns: ImportPreviewColumnMatch[];
  unmatchedHeaders: string[];
  missingRequiredColumns: { field: string; canonicalAlias: string }[];
  rows: ImportPreviewRow[];
  duplicateNationalIds: { nationalId: string; rows: number[] }[];
  // 1-indexed row number where the header row was detected. When the Excel
  // file has instructional rows above the headers, this will be > 1.
  detectedHeaderRow?: number;
}

// Translate row-error codes returned by the API into the current locale.
// The API returns stable machine codes (MISSING_NAME, DUPLICATE_NATIONAL_ID,
// etc.) so the frontend can localize them — instead of returning pre-baked
// English strings that would leak into the Arabic UI.
function translateRowError(code: string, t: (k: DictKey) => string): string {
  switch (code) {
    case "MISSING_REQUIRED_COLUMNS":
      return t("requests.import.errMissingRequiredColumns");
    case "MISSING_NAME":
      return t("requests.import.errMissingName");
    case "MISSING_NATIONAL_ID":
      return t("requests.import.errMissingNationalId");
    case "DUPLICATE_NATIONAL_ID":
      return t("requests.import.errDuplicateId");
    default:
      // Unknown code — show it verbatim so the user sees something.
      return code;
  }
}

interface UploadIdResponse {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

export interface TraineeEntrySectionProps {
  trainees: TraineeEntry[];
  onChange: (next: TraineeEntry[]) => void;
  onSaveDraft?: () => void;
  /** Optional className passthrough so the parent form can size the section. */
  className?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ROW_HEIGHT = 48;
const VISIBLE_TABLE_HEIGHT = 480; // ~10 rows visible before scrolling
// In Full Screen mode we want the table to fill the viewport, not a fixed
// 600 px. The parent dialog already reserves ~120 px of chrome (header,
// buttons, stat cards). We compute the live height in a layout effect below
// using `window.innerHeight`, but keep this as a sensible initial value for
// the first paint (the layout effect overrides it once mounted).
const VISIBLE_TABLE_HEIGHT_FULLSCREEN_INITIAL = 600;
const STAT_HIGHLIGHT_MS = 3000;

// ─── Smart Column Aliases (Arabic + English) ──────────────────────────────
// Expanded aliases for smart Excel import — recognizes any column naming
// convention without depending on column order or file formatting.
const COLUMN_ALIASES = {
  fullName: [
    "name", "fullname", "full name", "trainee name", "traineename",
    "employee name", "employeename", "worker name", "workername",
    "participant name", "participant", "candidate name",
    "الاسم", "اسم", "اسم المتدرب", "المتدرب", "اسم الموظف", "اسم العامل",
    "الاسم الكامل", "اسم المشارك",
  ],
  nationalId: [
    "nationalid", "national id", "id", "idnumber", "id number",
    "iqama", "iqamaid", "iqama id", "iqama number",
    "resident id", "residentid", "identity", "identitynumber",
    "civil id", "civilid", "passport", "passportnumber",
    "رقم الهوية", "هوية", "الاقامة", "إقامة", "رقم الاقامة",
    "رقم الإقامة", "الهوية الوطنية", "رقم الهوية الوطنية",
  ],
  nationality: [
    "nationality", "country", "citizenship", "origin",
    "country of origin", "nationalitycode",
    "جنسية", "الجنسية", "الدولة", "بلد", "الوطن",
  ],
  jobTitle: [
    "job", "jobtitle", "job title", "position", "role", "occupation",
    "designation", "profession", "title",
    "وظيفة", "الوظيفة", "المهنة", "المنصب", "العمل", "المسمى الوظيفي",
  ],
  phone: [
    "phone", "mobile", "phonenumber", "phone number", "tel", "telephone",
    "contact", "contactnumber", "cellphone", "cell",
    "هاتف", "الجوال", "رقم الهاتف", "الجوال", "الموبايل",
  ],
  email: [
    "email", "emailaddress", "email address", "mail", "e-mail",
    "البريد", "البريد الالكتروني", "البريد الإلكتروني",
  ],
};

type StatFilter = "all" | "valid" | "invalid" | "duplicates" | "missing-attachment";

type BulkUploadPhase = "idle" | "uploading" | "matching" | "completed";

interface BulkUploadState {
  phase: BulkUploadPhase;
  total: number;
  done: number;
  matched: number;
  unmatched: { filename: string; url: string }[];
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function makeId(): string {
  // crypto.randomUUID is available in all evergreen browsers + Node 19+.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyRow(partial?: Partial<TraineeEntry>): TraineeEntry {
  return {
    id: makeId(),
    fullName: "",
    nationalId: "",
    nationality: "",
    jobTitle: "",
    idAttachmentUrl: null,
    idAttachmentName: null,
    documents: [],
    valid: false,
    errors: [],
    ...partial,
  };
}

// ── Phase 1: documents[] is the single source of truth ────────────────────
// The legacy `idAttachmentUrl` field is no longer written by any client
// callback. All ID uploads go into `documents[]` as `{type:"id"}` entries.
// These helpers locate the ID-type document within documents[] for display,
// stats, and filtering — they never read `idAttachmentUrl`.
const ID_DOC_TYPES: TraineeDocument["type"][] = ["id", "iqama"];

function getIdDocument(row: TraineeEntry): TraineeDocument | undefined {
  return row.documents.find((d) => ID_DOC_TYPES.includes(d.type));
}

function hasIdDocument(row: TraineeEntry): boolean {
  return getIdDocument(row) !== undefined;
}

// Phase 1 — normalize legacy `idAttachmentUrl` into documents[] on load.
//
// When loading existing trainee data from the API (which still returns the
// legacy column for backward compat), fold any `idAttachmentUrl` value into
// `documents[]` as a `{type:"id"}` entry IF that URL is not already
// represented. This ensures the in-memory TraineeEntry state is always
// consistent with the new single-source-of-truth model, regardless of
// whether the DB row has been backfilled yet (Phase 2).
//
// After Phase 2 backfill completes, this becomes a no-op for all rows
// (the URL will already be in documents[]).
export function normalizeIdAttachmentIntoDocuments(
  idAttachmentUrl: string | null | undefined,
  documents: TraineeDocument[],
): TraineeDocument[] {
  if (!idAttachmentUrl) return documents;
  const alreadyPresent = documents.some((d) => d.url === idAttachmentUrl);
  if (alreadyPresent) return documents;
  const syntheticDoc: TraineeDocument = {
    url: idAttachmentUrl,
    filename: idAttachmentUrl.split("/").pop() ?? "id-attachment",
    type: "id",
    uploadedAt: new Date().toISOString(),
  };
  return [...documents, syntheticDoc];
}

function validateRow(row: TraineeEntry, allIds: Map<string, number>, selfIndex: number): TraineeEntry {
  const errors: string[] = [];
  if (!row.fullName.trim()) errors.push("Missing name");
  if (!row.nationalId.trim()) errors.push("Missing national ID");
  if (row.nationalId.trim()) {
    const firstSeen = allIds.get(row.nationalId.trim());
    if (firstSeen !== undefined && firstSeen !== selfIndex) {
      errors.push(`Duplicate national ID (first at row ${firstSeen + 1})`);
    }
  }
  return { ...row, valid: errors.length === 0, errors };
}

function recomputeValidity(rows: TraineeEntry[]): TraineeEntry[] {
  // Build a nationalId → first-index map, then re-run validation per row.
  const idMap = new Map<string, number>();
  rows.forEach((r, i) => {
    const id = r.nationalId.trim();
    if (id && !idMap.has(id)) idMap.set(id, i);
  });
  return rows.map((r, i) => validateRow(r, idMap, i));
}

// ─── Component ─────────────────────────────────────────────────────────────

export function TraineeEntrySection({ trainees, onChange, onSaveDraft, className }: TraineeEntrySectionProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  // Local UI state — none of this needs to leak to the parent. The source of
  // truth for the rows themselves lives in `trainees` (props).
  const [activeTab, setActiveTab] = React.useState<"manual" | "excel" | "paste">("manual");
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<StatFilter>("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  // Maximize toggle for the Excel preview dialog. When true the dialog grows
  // to 95vw so the user can see all preview rows + matched columns without
  // scrolling inside the dialog itself.
  const [previewFullscreen, setPreviewFullscreen] = React.useState(false);
  const [bulkUpload, setBulkUpload] = React.useState<BulkUploadState>({
    phase: "idle", total: 0, done: 0, matched: 0, unmatched: [],
  });
  const [pasteText, setPasteText] = React.useState("");

  // Refs for the virtualized scroll container.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);

  // ── BUG-009/011 fix: force re-render after mount ─────────────────────
  // The virtualization calculates visibleSlice from scrollTop (0) and
  // currentTableHeight (constant). On first render inside a Dialog, the
  // TabsContent mounts lazily and the scroll container's layout isn't
  // settled until after paint. This causes the table body to appear empty
  // until the user interacts (resize, scroll, tab switch).
  //
  // Fix: use useLayoutEffect to synchronously set a "mounted" flag BEFORE
  // the browser paints. This triggers a second render with the correct
  // layout, so the rows appear immediately.
  const [mounted, setMounted] = React.useState(false);
  React.useLayoutEffect(() => {
    setMounted(true);
  }, []);

  // Also re-trigger on trainees change (e.g. after Excel import the table
  // should immediately show the new rows without requiring a scroll).
  React.useLayoutEffect(() => {
    if (mounted && scrollRef.current) {
      // Reset scroll to top when trainees change so the virtualization
      // re-calculates from scrollTop=0.
      if (scrollRef.current.scrollTop !== 0) {
        scrollRef.current.scrollTop = 0;
      }
      setScrollTop(0);
    }
  }, [trainees, mounted]);

  // ─── Derived stats (memoized) ──────────────────────────────────────────
  const stats = React.useMemo(() => {
    const idCounts = new Map<string, number>();
    for (const r of trainees) {
      const id = r.nationalId.trim();
      if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
    const total = trainees.length;
    const valid = trainees.filter((r) => r.valid).length;
    const invalid = total - valid;
    const duplicates = trainees.filter((r) => {
      const id = r.nationalId.trim();
      return id && (idCounts.get(id) ?? 0) > 1;
    }).length;
    const missingAttachment = trainees.filter(
      (r) => r.fullName.trim() && r.nationalId.trim() && !hasIdDocument(r)
    ).length;
    return { total, valid, invalid, duplicates, missingAttachment };
  }, [trainees]);

  // ─── Filtered + searched view of the table (memoized) ──────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const idCounts = new Map<string, number>();
    for (const r of trainees) {
      const id = r.nationalId.trim();
      if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
    return trainees.filter((r) => {
      if (q) {
        const hay = `${r.fullName} ${r.nationalId} ${r.jobTitle} ${r.nationality}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case "valid": return r.valid;
        case "invalid": return !r.valid;
        case "duplicates": {
          const id = r.nationalId.trim();
          return id ? (idCounts.get(id) ?? 0) > 1 : false;
        }
        case "missing-attachment":
          return r.fullName.trim() !== "" && r.nationalId.trim() !== "" && !hasIdDocument(r);
        default: return true;
      }
    });
  }, [trainees, search, filter]);

  // ─── Virtualization window ─────────────────────────────────────────────
  // In Full Screen mode the table should fill the viewport. We reserve:
  //   - ~64 px for the section padding (top + bottom of fixed inset-0)
  //   - ~48 px for the tabs row (tabs + Full Screen button)
  // ── BUG-009 fix: measure the actual scroll container height ───────────
  // The constant VISIBLE_TABLE_HEIGHT (480) is a fallback. The real height
  // might differ if the dialog hasn't been laid out yet. We measure the
  // scrollRef's clientHeight on mount and when the window resizes, then use
  // whichever is larger (the measured value or the constant). This ensures
  // visibleCount is never 0 on first render.
  const [measuredHeight, setMeasuredHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const measure = () => {
      if (scrollRef.current) {
        const h = scrollRef.current.clientHeight;
        if (h > 0) setMeasuredHeight(h);
      }
    };
    measure();
    // Re-measure after a short delay to catch post-paint layout.
    const t = setTimeout(measure, 50);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [mounted]);

  // Use the measured height if available (and larger than the constant),
  // otherwise fall back to the constant. This fixes the empty-table-on-
  // first-render bug where the virtualization calculated 0 visible rows.
  // When there are no trainees, use a small height so the Additional Documents
  // section below is visible without scrolling.
  const currentTableHeight = filtered.length === 0
    ? Math.min(120, VISIBLE_TABLE_HEIGHT)
    : Math.max(VISIBLE_TABLE_HEIGHT, measuredHeight);
  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const visibleCount = Math.ceil(currentTableHeight / ROW_HEIGHT) + 4;
  const endIndex = Math.min(filtered.length, startIndex + visibleCount);
  const visibleSlice = filtered.slice(startIndex, endIndex);

  // ─── Mutators (all useCallback — stable identities) ────────────────────
  const updateTrainees = React.useCallback((next: TraineeEntry[]) => {
    onChange(recomputeValidity(next));
  }, [onChange]);

  const updateField = React.useCallback((id: string, field: keyof TraineeEntry, value: string) => {
    const next = trainees.map((r) => (r.id === id ? { ...r, [field]: value } : r));
    updateTrainees(next);
  }, [trainees, updateTrainees]);

  const addRows = React.useCallback((count: number) => {
    const additions: TraineeEntry[] = Array.from({ length: count }, () => emptyRow());
    updateTrainees([...trainees, ...additions]);
    setActiveTab("manual");
  }, [trainees, updateTrainees]);

  const deleteRow = React.useCallback((id: string) => {
    updateTrainees(trainees.filter((r) => r.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [trainees, updateTrainees]);

  const deleteSelected = React.useCallback(() => {
    if (selected.size === 0) return;
    updateTrainees(trainees.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    toast({ title: t("misc.success"), description: t("requests.rowsRemoved", { count: selected.size }) });
  }, [selected, trainees, updateTrainees, toast, t]);

  const toggleSelect = React.useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectAll = React.useCallback((checked: boolean) => {
    if (checked) {
      setSelected(new Set(filtered.map((r) => r.id)));
    } else {
      setSelected(new Set());
    }
  }, [filtered]);

  const jumpToRow = React.useCallback((id: string) => {
    const idxInFiltered = filtered.findIndex((r) => r.id === id);
    if (idxInFiltered === -1) return;
    // Reset filter so the row is actually visible in the full list.
    setFilter("all");
    setSearch("");
    // Defer the scroll until after the filter clears and filtered is recomputed.
    queueMicrotask(() => {
      const targetTop = idxInFiltered * ROW_HEIGHT;
      scrollRef.current?.scrollTo({ top: targetTop, behavior: "smooth" });
      setHighlightedId(id);
      window.setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), STAT_HIGHLIGHT_MS);
    });
  }, [filtered]);

  // ─── Per-row ID upload ────────────────────────────────────────────────
  // Phase 1: writes ONLY to documents[] as a `{type:"id"}` entry. The
  // legacy `idAttachmentUrl` field is never touched. Uploading a new ID
  // replaces any existing "id"/"iqama" document in documents[] so the
  // per-type uniqueness rule is preserved on the client side (the server
  // endpoint /api/trainees/[id]/documents enforces the same rule).
  const uploadIdForRow = React.useCallback(async (rowId: string, file: File) => {
    try {
      const res = await api.postFile<UploadIdResponse>("/trainees/upload-id", file);
      const newDoc: TraineeDocument = {
        url: res.url,
        filename: file.name,
        type: "id",
        uploadedAt: new Date().toISOString(),
      };
      updateTrainees(trainees.map((r) => {
        if (r.id !== rowId) return r;
        const others = r.documents.filter((d) => !ID_DOC_TYPES.includes(d.type));
        return { ...r, documents: [...others, newDoc] };
      }));
      toast({ title: t("misc.success"), description: t("requests.idAttached", { name: file.name }) });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  }, [trainees, updateTrainees, toast, t]);

  // ─── Multi-document upload per row ──────────────────────────────────
  const uploadDocumentForRow = React.useCallback(async (rowId: string, file: File, docType: TraineeDocument["type"]) => {
    try {
      const res = await api.postFile<UploadIdResponse>("/trainees/upload-id", file);
      const newDoc: TraineeDocument = {
        url: res.url,
        filename: file.name,
        type: docType,
        uploadedAt: new Date().toISOString(),
      };
      updateTrainees(trainees.map((r) => (
        r.id === rowId
          ? { ...r, documents: [...r.documents, newDoc] }
          : r
      )));
      toast({ title: t("misc.success"), description: t("requests.documentUploaded", { name: file.name }) });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  }, [trainees, updateTrainees, toast, t]);

  const removeDocumentForRow = React.useCallback((rowId: string, docIndex: number) => {
    updateTrainees(trainees.map((r) => (
      r.id === rowId
        ? { ...r, documents: r.documents.filter((_, i) => i !== docIndex) }
        : r
    )));
  }, [trainees, updateTrainees]);

  // ─── Document status helper ─────────────────────────────────────────
  const getDocStatus = React.useCallback((row: TraineeEntry): "uploaded" | "missing" | "needs_update" => {
    // Phase 1: documents[] is the only source — any document (ID or other
    // type) counts as "uploaded".
    if (row.documents.length > 0) return "uploaded";
    if (row.fullName.trim() && row.nationalId.trim()) return "missing";
    return "needs_update";
  }, []);

  const replaceIdForRow = React.useCallback(async (rowId: string, file: File) => {
    // Same endpoint — server overwrites with a new random hex name. The old
    // file is orphaned on disk; that's acceptable for an internal TMS.
    return uploadIdForRow(rowId, file);
  }, [uploadIdForRow]);

  const removeIdForRow = React.useCallback((rowId: string) => {
    // Phase 1: remove any ID-type document from documents[]. Do NOT touch
    // the legacy `idAttachmentUrl` field (it's no longer the source of truth).
    updateTrainees(trainees.map((r) => (
      r.id === rowId
        ? { ...r, documents: r.documents.filter((d) => !ID_DOC_TYPES.includes(d.type)) }
        : r
    )));
  }, [trainees, updateTrainees]);

  // ─── Bulk ID upload (auto-match by filename → national ID) ────────────
  const onBulkIdFiles = React.useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBulkUpload({ phase: "uploading", total: list.length, done: 0, matched: 0, unmatched: [] });

    const uploaded: { file: File; url: string; filename: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        const res = await api.postFile<UploadIdResponse>("/trainees/upload-id", file);
        uploaded.push({ file, url: res.url, filename: res.filename });
      } catch (e) {
        // Keep going — partial success is better than bailing. Track the
        // failed file as "unmatched" with no URL so the summary shows it.
        uploaded.push({ file, url: "", filename: "" });
        console.error("[bulk-id] upload failed", file.name, e);
      }
      setBulkUpload((s) => ({ ...s, done: i + 1 }));
    }

    setBulkUpload((s) => ({ ...s, phase: "matching" }));

    // Match: strip the extension and any non-alphanumeric chars from the
    // filename, then compare to each trainee's nationalId (also normalized).
    const normalizeForMatch = (s: string) => s.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const next = trainees.map((r) => ({ ...r }));
    let matched = 0;
    const unmatched: { filename: string; url: string }[] = [];

    for (const u of uploaded) {
      if (!u.url) { unmatched.push({ filename: u.file.name, url: "" }); continue; }
      const needle = normalizeForMatch(u.file.name);
      if (!needle) { unmatched.push({ filename: u.file.name, url: u.url }); continue; }
      const idx = next.findIndex((r) => {
        const id = normalizeForMatch(r.nationalId);
        return id && (id === needle || needle.includes(id) || id.includes(needle));
      });
      if (idx >= 0) {
        // Phase 1: store the matched ID file in documents[] as `{type:"id"}`.
        // Replace any existing ID-type doc on that row.
        const newDoc: TraineeDocument = {
          url: u.url,
          filename: u.file.name,
          type: "id",
          uploadedAt: new Date().toISOString(),
        };
        const others = next[idx].documents.filter((d) => !ID_DOC_TYPES.includes(d.type));
        next[idx] = { ...next[idx], documents: [...others, newDoc] };
        matched++;
      } else {
        unmatched.push({ filename: u.file.name, url: u.url });
      }
    }

    updateTrainees(next);
    setBulkUpload({ phase: "completed", total: list.length, done: list.length, matched, unmatched });
    toast({
      title: t("misc.success"),
      description: `Bulk upload complete: ${matched}/${list.length} matched to trainees`,
      variant: unmatched.length > 0 ? "destructive" : "default",
    });
  }, [trainees, updateTrainees, toast, t]);

  // ─── Excel Import tab ────────────────────────────────────────────────
  const excelInputRef = React.useRef<HTMLInputElement | null>(null);
  const [excelPendingFile, setExcelPendingFile] = React.useState<File | null>(null);

  const onExcelFile = React.useCallback(async (file: File) => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    setExcelPendingFile(file);
    try {
      const result = await api.postFile<ImportPreview>("/requests/import/preview", file);
      setPreview(result);
    } catch (e) {
      setPreviewOpen(false);
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }, [toast, t, setExcelPendingFile]);

  const confirmExcelImport = React.useCallback(() => {
    if (!preview || !excelPendingFile) return;
    // Translate preview rows → TraineeEntry rows. companyName / courseTitle /
    // region etc. live on the parent request, not the trainee, so we only
    // carry the trainee-relevant fields forward.
    //
    // IMPORTANT: we do NOT filter by (r.name && r.nationalId) here. The
    // preview might have rows where the columns didn't map (e.g. the user's
    // Excel file uses unusual headers we didn't recognize). Those rows still
    // represent real trainees the user wants to import — they just need to
    // fill the missing fields manually in the editable table afterwards.
    // Dropping them silently would lose data the user explicitly uploaded.
    //
    // We DO skip rows that are completely empty (no name AND no nationalId
    // AND no jobTitle AND no nationality — clearly a blank row in the sheet).
    const additions: TraineeEntry[] = preview.rows
      .filter((r) => r.name || r.nationalId || r.jobTitle || r.nationality)
      .map((r) => ({
        id: makeId(),
        fullName: r.name || "",
        nationalId: r.nationalId || "",
        nationality: r.nationality ?? "",
        jobTitle: r.jobTitle ?? "",
        idAttachmentUrl: null,
        idAttachmentName: null,
        documents: [],
        valid: false, // will be recomputed by the table's validation
        errors: [],
      }));
    if (additions.length === 0) {
      toast({
        title: t("misc.error"),
        description: t("requests.import.noValidRows") || "No rows to import — check the column mapping.",
        variant: "destructive",
      });
      return;
    }
    updateTrainees([...trainees, ...additions]);
    setPreviewOpen(false);
    setPreview(null);
    setExcelPendingFile(null);
    setPreviewFullscreen(false);
    setActiveTab("manual");
    toast({
      title: t("misc.success"),
      description: t("requests.import.success", { requests: 1, trainees: additions.length }),
    });
  }, [preview, excelPendingFile, trainees, updateTrainees, toast, t, setPreviewOpen, setPreview, setExcelPendingFile, setPreviewFullscreen, setActiveTab]);

  // ─── Copy & Paste tab ────────────────────────────────────────────────
  const parsePasted = React.useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;
    // Detect delimiter: tab wins if there's any tab, otherwise comma.
    const delimiter = text.includes("\t") ? "\t" : ",";
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;

    // Header auto-mapping — normalize each header (lowercase, strip symbols)
    // and check known aliases using the expanded COLUMN_ALIASES.
    const headerCells = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/gi, ""));
    const findCol = (field: keyof typeof COLUMN_ALIASES): number => {
      const aliases = COLUMN_ALIASES[field];
      return headerCells.findIndex((h) => aliases.some((a) => {
        const normalizedAlias = a.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/gi, "");
        return h === normalizedAlias || h.includes(normalizedAlias) || normalizedAlias.includes(h);
      }));
    };

    const nameCol = findCol("fullName");
    const idCol = findCol("nationalId");
    const natCol = findCol("nationality");
    const jobCol = findCol("jobTitle");
    const phoneCol = findCol("phone");
    const emailCol = findCol("email");

    // If no recognizable header, treat as name,id pairs.
    const hasHeader = nameCol !== -1 || idCol !== -1;
    const dataStart = hasHeader ? 1 : 0;
    const nameIdx = hasHeader && nameCol !== -1 ? nameCol : 0;
    const idIdx = hasHeader && idCol !== -1 ? idCol : 1;

    const additions: TraineeEntry[] = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cells = lines[i].split(delimiter).map((c) => c.trim());
      const fullName = cells[nameIdx] ?? "";
      const nationalId = cells[idIdx] ?? "";
      if (!fullName && !nationalId) continue;
      additions.push({
        id: makeId(),
        fullName,
        nationalId,
        nationality: hasHeader && natCol !== -1 ? (cells[natCol] ?? "") : "",
        jobTitle: hasHeader && jobCol !== -1 ? (cells[jobCol] ?? "") : "",
        idAttachmentUrl: null,
        idAttachmentName: null,
        documents: [],
        valid: false,
        errors: [],
      });
    }
    if (additions.length === 0) {
      toast({ title: t("misc.error"), description: "No rows detected", variant: "destructive" });
      return;
    }
    updateTrainees([...trainees, ...additions]);
    setPasteText("");
    setActiveTab("manual");
    toast({ title: t("misc.success"), description: t("requests.rowsImported", { count: additions.length }) });
  }, [pasteText, trainees, updateTrainees, toast, t]);

  // ─── Submission safety ───────────────────────────────────────────────
  const canSubmit = stats.total > 0 && stats.invalid === 0 && stats.duplicates === 0;

  // ─── Scroll handler (throttled via rAF) ───────────────────────────────
  const onScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // ─── Bulk-upload file input (hidden) ──────────────────────────────────
  const bulkIdInputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <div className="flex items-center justify-between gap-2">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="manual" className="flex-1 sm:flex-initial"><Users className="h-4 w-4 me-1.5" />{t("requests.trainees")}</TabsTrigger>
            <TabsTrigger value="excel" className="flex-1 sm:flex-initial"><FileSpreadsheet className="h-4 w-4 me-1.5" />{t("requests.excelImport")}</TabsTrigger>
            <TabsTrigger value="paste" className="flex-1 sm:flex-initial"><ClipboardPaste className="h-4 w-4 me-1.5" />{t("requests.copyPaste")}</TabsTrigger>
          </TabsList>
        </div>

        {/* ─── Manual Entry ─────────────────────────────────────────────── */}
        <TabsContent value="manual" className="space-y-4 mt-4">
          {/* Stat cards (click to filter) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label={t("requests.stats.total")}
              value={stats.total}
              active={filter === "all"}
              onClick={() => setFilter("all")}
              onJump={null}
            />
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              label={t("requests.stats.valid")}
              value={stats.valid}
              active={filter === "valid"}
              tone="success"
              onClick={() => setFilter("valid")}
              onJump={null}
            />
            <StatCard
              icon={<AlertCircle className="h-4 w-4 text-destructive" />}
              label={t("requests.stats.invalid")}
              value={stats.invalid}
              active={filter === "invalid"}
              tone="destructive"
              onClick={() => setFilter("invalid")}
              onJump={stats.invalid > 0 ? () => {
                const firstInvalid = trainees.find((r) => !r.valid);
                if (firstInvalid) jumpToRow(firstInvalid.id);
              } : null}
            />
            <StatCard
              icon={<Copy className="h-4 w-4 text-amber-600" />}
              label={t("requests.stats.duplicates")}
              value={stats.duplicates}
              active={filter === "duplicates"}
              tone="warning"
              onClick={() => setFilter("duplicates")}
              onJump={stats.duplicates > 0 ? () => {
                const idCounts = new Map<string, number>();
                for (const r of trainees) {
                  const id = r.nationalId.trim();
                  if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
                }
                const firstDup = trainees.find((r) => (idCounts.get(r.nationalId.trim()) ?? 0) > 1);
                if (firstDup) jumpToRow(firstDup.id);
              } : null}
            />
            <StatCard
              icon={<Paperclip className="h-4 w-4 text-muted-foreground" />}
              label={t("requests.stats.missingAttachments")}
              value={stats.missingAttachment}
              active={filter === "missing-attachment"}
              onClick={() => setFilter("missing-attachment")}
              onJump={stats.missingAttachment > 0 ? () => {
                const first = trainees.find((r) => r.fullName.trim() && r.nationalId.trim() && !hasIdDocument(r));
                if (first) jumpToRow(first.id);
              } : null}
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" onClick={() => addRows(1)}>
                <Plus className="h-3.5 w-3.5 me-1" />{t("requests.addRow")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addRows(10)} title={t("requests.addRow10")}>+10</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addRows(50)} title={t("requests.addRow50")}>+50</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addRows(100)} title={t("requests.addRow100")}>+100</Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => bulkIdInputRef.current?.click()}
                disabled={trainees.length === 0}
              >
                <Upload className="h-3.5 w-3.5 me-1" />{t("requests.bulkUploadIds")}
              </Button>
              <input
                ref={bulkIdInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void onBulkIdFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute top-1/2 -translate-y-1/2 start-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder={t("requests.searchTrainees")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ps-7 h-8 w-44 sm:w-56"
                />
              </div>
              {selected.size > 0 && (
                <Button type="button" variant="destructive" size="sm" onClick={deleteSelected}>
                  <Trash2 className="h-3.5 w-3.5 me-1" />{t("requests.deleteSelected")} ({selected.size})
                </Button>
              )}
            </div>
          </div>

          {/* Bulk upload progress */}
          {bulkUpload.phase !== "idle" && (
            <BulkUploadPanel state={bulkUpload} onDismiss={() => setBulkUpload({ phase: "idle", total: 0, done: 0, matched: 0, unmatched: [] })} />
          )}

          {/* Table — virtualized, with horizontal + vertical scroll inside the table */}
          <div
            className="rounded-md border"
            style={{
              overflowX: "auto",
              overflowY: "auto",
            }}
          >
            <div style={{ minWidth: 1300, width: "max-content" }}>
            {/* Header row — sticky at top */}
            <div className="flex items-center bg-muted/80 backdrop-blur-sm border-b text-xs font-medium text-muted-foreground sticky top-0 z-20" style={{ height: ROW_HEIGHT }}>
              <div className="w-10 shrink-0 flex items-center justify-center">
                <Checkbox
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onCheckedChange={(v) => toggleSelectAll(Boolean(v))}
                  aria-label={t("requests.selectAllVisible")}
                />
              </div>
              <div className="w-10 shrink-0 text-center">#</div>
              <div className="flex-1 min-w-[160px] px-2">{t("requests.traineeName")}</div>
              <div className="w-40 shrink-0 px-2">{t("requests.nationalId")}</div>
              <div className="w-32 shrink-0 px-2">{t("requests.nationality")}</div>
              <div className="w-32 shrink-0 px-2">{t("requests.jobTitle")}</div>
              <div className="w-56 shrink-0 px-2">{t("requests.idAndDocuments")}</div>
              <div className="w-12 shrink-0" />
            </div>

            {/* Body — virtualized */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="overflow-y-auto"
              style={{ height: currentTableHeight, maxHeight: currentTableHeight }}
            >
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-12 gap-2">
                  <Users className="h-8 w-8 opacity-40" />
                  <div>{trainees.length === 0 ? t("requests.noTraineesYet") : t("requests.noRowsMatchFilters")}</div>
                </div>
              ) : (
                <div style={{ height: totalHeight, position: "relative" }}>
                  {visibleSlice.map((row, i) => {
                    const absoluteIndex = startIndex + i;
                    const isHighlighted = highlightedId === row.id;
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          "flex items-center border-b last:border-b-0 transition-colors",
                          row.valid ? "" : "bg-destructive/5",
                          isHighlighted && "ring-2 ring-inset ring-primary"
                        )}
                        style={{ height: ROW_HEIGHT, position: "absolute", top: absoluteIndex * ROW_HEIGHT, left: 0, right: 0, minWidth: 1300 }}
                      >
                        <div className="w-10 shrink-0 flex items-center justify-center">
                          <Checkbox
                            checked={selected.has(row.id)}
                            onCheckedChange={(v) => toggleSelect(row.id, Boolean(v))}
                            aria-label={`Select row ${absoluteIndex + 1}`}
                          />
                        </div>
                        <div className="w-10 shrink-0 text-center text-xs text-muted-foreground">{absoluteIndex + 1}</div>
                        <div className="flex-1 min-w-[160px] px-1">
                          <input
                            type="text"
                            value={row.fullName}
                            onChange={(e) => updateField(row.id, "fullName", e.target.value)}
                            placeholder={t("requests.placeholderFullName")}
                            className="w-full h-7 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none focus:border-input focus:bg-background"
                            aria-invalid={!row.valid && !row.fullName.trim()}
                          />
                        </div>
                        <div className="w-40 shrink-0 px-1">
                          <input
                            type="text"
                            value={row.nationalId}
                            onChange={(e) => updateField(row.id, "nationalId", e.target.value)}
                            placeholder={t("requests.placeholderNationalId")}
                            className="w-full h-7 rounded border border-transparent bg-transparent px-1.5 text-sm font-mono outline-none focus:border-input focus:bg-background"
                            aria-invalid={!row.valid && !row.nationalId.trim()}
                          />
                        </div>
                        <div className="w-32 shrink-0 px-1">
                          <input
                            type="text"
                            value={row.nationality}
                            onChange={(e) => updateField(row.id, "nationality", e.target.value)}
                            placeholder="—"
                            className="w-full h-7 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none focus:border-input focus:bg-background"
                          />
                        </div>
                        <div className="w-32 shrink-0 px-1">
                          <input
                            type="text"
                            value={row.jobTitle}
                            onChange={(e) => updateField(row.id, "jobTitle", e.target.value)}
                            placeholder="—"
                            className="w-full h-7 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none focus:border-input focus:bg-background"
                          />
                        </div>
                        <div className="w-56 shrink-0 px-2 flex items-center gap-1">
                          {/* ID/Iqama attachment — Phase 1: read from documents[] */}
                          {(() => {
                            const idDoc = getIdDocument(row);
                            if (idDoc) {
                              return (
                                <>
                                  <a
                                    href={idDoc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-primary truncate max-w-[80px]"
                                    title={idDoc.filename ?? "View ID attachment"}
                                  >
                                    <FileCheck className="h-3 w-3 shrink-0 text-emerald-600" />
                                    <span className="truncate">{idDoc.filename ?? "ID"}</span>
                                  </a>
                                  <RowIdReplace onPick={(f) => void replaceIdForRow(row.id, f)} />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => removeIdForRow(row.id)}
                                    aria-label={t("requests.removeIdAttachment")}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </>
                              );
                            }
                            return <RowIdUpload onPick={(f) => void uploadIdForRow(row.id, f)} />;
                          })()}
                        </div>
                        <div className="w-12 shrink-0 flex items-center justify-center">
                          {!row.valid && (
                            <span
                              title={row.errors.join(", ")}
                              className="text-destructive"
                              aria-label={`Row ${absoluteIndex + 1} has errors: ${row.errors.join(", ")}`}
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>{t("requests.showingOf", { shown: filtered.length, total: trainees.length })}</span>
              {filtered.length > 0 && (
                <span>{t("requests.windowedRange", { start: startIndex + 1, end: endIndex, total: filtered.length })}</span>
              )}
            </div>
            </div>
          </div>

          {/* Submission safety + actions */}
          <SubmissionSafetyBar
            canSubmit={canSubmit}
            total={stats.total}
            invalid={stats.invalid}
            duplicates={stats.duplicates}
            onSaveDraft={onSaveDraft}
          />
        </TabsContent>

        {/* ─── Excel Import ────────────────────────────────────────────── */}
        <TabsContent value="excel" className="space-y-4 mt-4">
          <Alert variant="default">
            <FileSpreadsheet className="h-4 w-4" />
            <AlertTitle>{t("requests.excelImport")}</AlertTitle>
            <AlertDescription>
              {t("requests.excelImportDesc")}
            </AlertDescription>
          </Alert>
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-muted-foreground/30 p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
            onClick={() => excelInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void onExcelFile(file);
            }}
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">{t("requests.dropExcelOrBrowse")}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("requests.excelFormatHint")}</div>
              <div className="text-xs text-muted-foreground mt-2">
                {t("requests.recognizedColumns")}
              </div>
            </div>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onExcelFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {trainees.length > 0 && (
            <Alert variant="default">
              <FileWarning className="h-4 w-4" />
              <AlertTitle>{trainees.length} trainee(s) already in the list</AlertTitle>
              <AlertDescription>
                Importing from Excel will <strong>append</strong> to the existing list, not replace it.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* ─── Copy & Paste ────────────────────────────────────────────── */}
        <TabsContent value="paste" className="space-y-4 mt-4">
          <Alert variant="default">
            <ClipboardPaste className="h-4 w-4" />
            <AlertTitle>{t("requests.copyPaste")}</AlertTitle>
            <AlertDescription>
              {t("requests.copyPasteDesc")}
            </AlertDescription>
          </Alert>
          <Textarea
            rows={10}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={t("requests.copyPastePlaceholder")}
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPasteText("")} disabled={!pasteText}>
              <RotateCcw className="h-3.5 w-3.5 me-1" />{t("requests.clear")}
            </Button>
            <Button type="button" size="sm" onClick={parsePasted} disabled={!pasteText.trim()}>
              <CopyPlus className="h-3.5 w-3.5 me-1" />{t("requests.importRows")}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Preview Dialog ───────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={(o) => { setPreviewOpen(o); if (!o) { setPreview(null); setExcelPendingFile(null); setPreviewFullscreen(false); } }}>
        <DialogContent
          className={cn(
            "p-0 gap-0",
            previewFullscreen
              ? "max-w-[98vw] w-[98vw] max-h-[96vh] h-[96vh]"
              : "max-w-4xl max-h-[90vh]"
          )}
        >
          <DialogHeader className="p-5 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              {t("requests.import.preview")}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ms-auto h-7 px-2"
                onClick={() => setPreviewFullscreen((v) => !v)}
                title={previewFullscreen ? t("requests.fullscreenExit") : t("requests.fullscreen")}
              >
                {previewFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                {previewFullscreen ? t("requests.fullscreenExit") : t("requests.fullscreen")}
              </Button>
            </DialogTitle>
            <DialogDescription>
              {excelPendingFile?.name ?? t("requests.import.spreadsheet")} — {t("requests.import.reviewMapping")}
            </DialogDescription>
          </DialogHeader>

          <div className={cn(
            "p-5 space-y-4 overflow-y-auto",
            previewFullscreen ? "flex-1 min-h-0" : "max-h-[60vh]"
          )}>
            {previewLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">{t("requests.import.previewing")}</div>
              </div>
            ) : preview ? (
              <>
                {/* Missing required */}
                {preview.missingRequiredColumns.length > 0 ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{t("requests.import.missingColumns")}</AlertTitle>
                    <AlertDescription>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {preview.missingRequiredColumns.map((f, i) => (
                          <Badge key={i} variant="destructive">{f.canonicalAlias}</Badge>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="default">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <AlertTitle>{t("requests.import.allColumnsMatched")}</AlertTitle>
                    <AlertDescription>
                      {t("requests.import.columnsRecognized", {
                        matched: preview.matchedColumns.length,
                        total: preview.matchedColumns.length + preview.unmatchedHeaders.length,
                      })}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Detected header row notice */}
                {preview.detectedHeaderRow && preview.detectedHeaderRow > 1 && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <AlertTitle>{t("requests.import.headerDetected")}</AlertTitle>
                    <AlertDescription>
                      {t("requests.import.headerDetectedDesc", { row: preview.detectedHeaderRow })}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <PreviewStat label={t("requests.import.totalRows")} value={preview.totalRows} />
                  <PreviewStat label={t("requests.import.validRows")} value={preview.validRows} tone="success" />
                  <PreviewStat label={t("requests.import.invalidRows")} value={preview.invalidRows} tone={preview.invalidRows > 0 ? "destructive" : undefined} />
                  <PreviewStat label={t("requests.import.traineeCount")} value={preview.traineeCount} />
                </div>

                {/* Matched columns */}
                <div>
                  <div className="text-xs font-semibold mb-2">{t("requests.import.matchedColumns")}</div>
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("requests.import.field")}</TableHead>
                          <TableHead>{t("requests.import.columnHeader")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.matchedColumns.map((c) => (
                          <TableRow key={c.field + "-" + c.header}>
                            <TableCell className="font-mono text-xs">{t(`requests.import.fields.${c.field}` as never) || c.field}</TableCell>
                            <TableCell className="text-xs whitespace-pre-line">{c.header}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Unmatched headers */}
                {preview.unmatchedHeaders.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-2">{t("requests.import.unmatchedHeaders")}</div>
                    <div className="flex flex-wrap gap-1">
                      {preview.unmatchedHeaders.map((h, i) => (
                        <Badge key={`${h}-${i}`} variant="outline" className="text-xs whitespace-pre-line">{h}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Duplicate IDs */}
                {preview.duplicateNationalIds.length > 0 && (
                  <Alert variant="destructive">
                    <FileWarning className="h-4 w-4" />
                    <AlertTitle>{t("requests.import.duplicateIds")}</AlertTitle>
                    <AlertDescription>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {preview.duplicateNationalIds.map((d, i) => (
                          <Badge key={i} variant="destructive" className="font-mono text-xs">{d.nationalId}</Badge>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Sample rows */}
                <div className={cn(previewFullscreen && "flex flex-col min-h-0 flex-1")}>
                  <div className="text-xs font-semibold mb-2">{t("requests.import.rowPreview")}</div>
                  <div className={cn(
                    "rounded-md border overflow-x-auto overflow-y-auto",
                    previewFullscreen ? "flex-1 min-h-0" : "max-h-72"
                  )}>
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead className="w-16">{t("requests.import.rowNum")}</TableHead>
                          <TableHead>{t("requests.traineeName")}</TableHead>
                          <TableHead>{t("requests.nationalId")}</TableHead>
                          <TableHead>{t("requests.import.status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((r) => (
                          <TableRow key={r.rowNumber} className={r.valid ? "" : "bg-destructive/5"}>
                            <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                            <TableCell className="text-sm">{r.name || "—"}</TableCell>
                            <TableCell className="text-xs font-mono">{r.nationalId || "—"}</TableCell>
                            <TableCell>
                              {r.valid
                                ? <Badge className="text-emerald-600 border-emerald-200 bg-emerald-50" variant="outline">{t("requests.import.ok")}</Badge>
                                : <Badge variant="destructive" className="text-xs">{r.errors.map((e) => translateRowError(e, t)).join(" · ")}</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter className="p-4 border-t bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
            {/* Status hint on the left — explains WHY the button is disabled
                when it is. If columns are missing we still allow Confirm so
                the user can import whatever fields WERE matched and fill the
                rest manually in the editable table. */}
            <div className="text-xs text-muted-foreground">
              {previewLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("requests.import.previewing")}
                </span>
              ) : preview ? (
                <span>
                  {preview.validRows > 0 ? (
                    <>{preview.validRows} {t("requests.import.validRows")} · {preview.totalRows} {t("requests.import.totalRows")}</>
                  ) : preview.totalRows > 0 ? (
                    <span className="text-amber-600 inline-flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {t("requests.import.noValidRows") || "No valid rows — check column mapping."}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 ms-auto">
              <Button variant="outline" onClick={() => { setPreviewOpen(false); setPreview(null); setExcelPendingFile(null); setPreviewFullscreen(false); }}>
                {t("misc.cancel")}
              </Button>
              <Button
                onClick={confirmExcelImport}
                disabled={
                  !preview ||
                  previewLoading ||
                  preview?.totalRows === 0 ||
                  // Allow import even with missing required columns — the user
                  // can fill the missing fields manually in the editable table.
                  // We only block when literally no rows were parsed.
                  (preview?.rows?.length ?? 0) === 0
                }
              >
                <ArrowRight className="h-4 w-4 me-1.5" />{t("requests.import.confirm")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, active, tone, onClick, onJump,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  active: boolean;
  tone?: "success" | "destructive" | "warning";
  onClick: () => void;
  onJump: (() => void) | null;
}) {
  const { t } = useI18n();
  const toneClass =
    tone === "success" ? "border-emerald-200 bg-emerald-50/50"
    : tone === "destructive" ? "border-destructive/30 bg-destructive/5"
    : tone === "warning" ? "border-amber-200 bg-amber-50/50"
    : "";

  return (
    <div
      className={cn(
        "rounded-md border p-3 cursor-pointer transition-all flex flex-col gap-1",
        active ? "ring-2 ring-primary border-primary" : "hover:bg-muted/30",
        toneClass
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {onJump && value > 0 && (
        <button
          type="button"
          className="text-[10px] text-primary hover:underline self-start"
          onClick={(e) => { e.stopPropagation(); onJump(); }}
        >
          {t("requests.jumpToFirst")}
        </button>
      )}
    </div>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "destructive" }) {
  const cls = tone === "success" ? "text-emerald-600" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function BulkUploadPanel({ state, onDismiss }: { state: BulkUploadState; onDismiss: () => void }) {
  const { t } = useI18n();
  const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
  const label =
    state.phase === "uploading" ? t("requests.bulkUploading", { done: state.done, total: state.total })
    : state.phase === "matching" ? t("requests.bulkMatching")
    : state.phase === "completed" ? t("requests.bulkDone", { matched: state.matched, unmatched: state.unmatched.length })
    : "";
  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {state.phase === "completed"
            ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            : <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <span>{label}</span>
        </div>
        {state.phase === "completed" && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <Progress value={state.phase === "matching" ? 100 : pct} />
      {state.phase === "completed" && state.unmatched.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <div className="font-medium mb-1">{t("requests.bulkUnmatchedFiles")}</div>
          <ul className="list-disc ms-4 space-y-0.5 max-h-24 overflow-y-auto">
            {state.unmatched.map((u) => (
              <li key={u.filename} className="font-mono truncate">{u.filename}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SubmissionSafetyBar({
  canSubmit, total, invalid, duplicates, onSaveDraft,
}: {
  canSubmit: boolean;
  total: number;
  invalid: number;
  duplicates: number;
  onSaveDraft?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border bg-muted/20 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
        {total === 0 ? (
          <><AlertCircle className="h-3.5 w-3.5" />{t("requests.addAtLeastOneTrainee")}</>
        ) : !canSubmit ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            <span>{t("requests.submissionBlocked")}</span>
            {invalid > 0 && <Badge variant="destructive" className="text-xs">{t("requests.invalidRowsCount", { count: invalid })}</Badge>}
            {duplicates > 0 && <Badge variant="destructive" className="text-xs">{t("requests.duplicateIdsCount", { count: duplicates })}</Badge>}
          </>
        ) : (
          <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{t("requests.readyToSubmit", { count: total })}</>
        )}
      </div>
      {onSaveDraft && (
        <Button type="button" variant="outline" size="sm" onClick={onSaveDraft}>
          <Save className="h-3.5 w-3.5 me-1" />{t("requests.saveDraft")}
        </Button>
      )}
    </div>
  );
}

// Per-row ID upload buttons — kept tiny so the 44px row height is respected.

function RowIdUpload({ onPick }: { onPick: (file: File) => void }) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => ref.current?.click()}>
        <Upload className="h-3 w-3 me-1" />Upload
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

function RowIdReplace({ onPick }: { onPick: (file: File) => void }) {
  const { t } = useI18n();
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => ref.current?.click()}
        aria-label={t("requests.replaceAttachment")}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

// Local re-exports to keep the JSX above free of long import lines.
// (Table + Alert imports moved to the top of the file.)

// Re-export so callers can build submission payloads without re-declaring
// the type. Both the parent route and the API client can import this.
export type { UploadIdResponse };

// ─── Multi-document row component ─────────────────────────────────────────
// Allows uploading additional documents (PDF, JPG, PNG) per trainee row.
// Supports document types: Iqama, ID, Passport, Certificate, OHS, Other.
function RowDocUpload({
  rowId,
  documents,
  onUpload,
  onRemove,
}: {
  rowId: string;
  documents: TraineeDocument[];
  onUpload: (file: File, docType: TraineeDocument["type"]) => void;
  onRemove: (docIndex: number) => void;
}) {
  const { t } = useI18n();
  const [showMenu, setShowMenu] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [pendingType, setPendingType] = React.useState<TraineeDocument["type"]>("other");

  const handleFilePick = (docType: TraineeDocument["type"]) => {
    setPendingType(docType);
    fileRef.current?.click();
    setShowMenu(false);
  };

  return (
    <div className="relative flex items-center gap-1">
      {/* Show document count badge */}
      {documents.length > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-0.5 rounded bg-blue-50 text-blue-700" title={t("requests.documentsCount", { count: documents.length })}>
          <FileText className="h-2.5 w-2.5" />
          {documents.length}
        </span>
      )}

      {/* Upload button with dropdown */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setShowMenu(!showMenu)}
        title={t("requests.uploadAdditionalDocuments")}
      >
        <FolderUp className="h-3 w-3" />
      </Button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
          <div className="absolute top-full mt-1 end-0 z-40 w-44 rounded-md border bg-background shadow-lg p-1 text-xs">
            <div className="px-2 py-1 font-medium text-muted-foreground">{t("requests.uploadDocument")}</div>
            {([
              { type: "iqama" as const, label: t("requests.docTypes.iqama") },
              { type: "id" as const, label: t("requests.docTypes.id") },
              { type: "passport" as const, label: t("requests.docTypes.passport") },
              { type: "certificate" as const, label: t("requests.docTypes.certificate") },
              { type: "ohs" as const, label: t("requests.docTypes.ohs") },
              { type: "other" as const, label: t("requests.docTypes.other") },
            ]).map((opt) => (
              <button
                key={opt.type}
                type="button"
                className="w-full text-start px-2 py-1.5 rounded hover:bg-muted transition-colors"
                onClick={() => handleFilePick(opt.type)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f, pendingType);
          e.target.value = "";
        }}
      />

      {/* Document list popover (shown on hover of count badge) */}
      {documents.length > 0 && (
        <div className="group relative">
          <div className="hidden group-hover:block absolute top-full mt-1 end-0 z-40 w-56 rounded-md border bg-background shadow-lg p-2 text-xs max-h-48 overflow-y-auto">
            <div className="font-medium mb-1 text-muted-foreground">Documents ({documents.length})</div>
            {documents.map((doc, idx) => (
              <div key={idx} className="flex items-center gap-1 py-1 border-b last:border-b-0">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary truncate flex-1"
                  title={doc.filename}
                >
                  {doc.type === "iqama" || doc.type === "id" ? <FileCheck className="h-3 w-3 shrink-0 text-emerald-600" /> :
                   doc.filename.endsWith(".pdf") ? <FileText className="h-3 w-3 shrink-0" /> :
                   <FileImage className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{doc.filename}</span>
                </a>
                <span className="text-[9px] text-muted-foreground uppercase">{doc.type}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => onRemove(idx)}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
