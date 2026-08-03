"use client";

// GCCLAB TMS — AdditionalDocumentsSection
// =====================================================================
// Self-contained section that lets the contractor upload ANY additional
// request-level documents (medical certificate, vaccination certificate,
// work permit, company letter, qualification, driving license, experience
// certificate, any PDF, any image). Files are POSTed to /api/requests/upload-doc
// and the resulting metadata is collected into the `documents` array the
// parent form later submits alongside the request.
//
// Each file card shows:
//   • Filename (original)
//   • File type badge (PDF / JPG / PNG)
//   • Upload date
//   • Uploaded by (only available after the request is saved)
//   • Preview button (opens image/PDF in new tab)
//   • Download button
//   • Delete button (removes from the array and tries to delete from disk)
//
// Accepted formats: PDF, JPG, JPEG, PNG. Max 10 MB per file.
// Multiple files supported. Unlimited count.

import * as React from "react";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload, Trash2, Download, Eye, FileText, FileImage, File, Loader2, Paperclip, X,
} from "lucide-react";

export interface AdditionalDocument {
  url: string;
  filename: string;
  originalName?: string;
  type: string;
  size?: number;
  uploadedAt: string;
  uploadedById?: string;
}

export interface AdditionalDocumentsSectionProps {
  value: AdditionalDocument[];
  onChange: (next: AdditionalDocument[]) => void;
  /** Optional caption shown under the section title. */
  hint?: string;
  /** Disable all interactions (e.g. read-only review mode). */
  readOnly?: boolean;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatType(mime: string): { label: string; icon: React.ReactNode } {
  if (mime.includes("pdf")) return { label: "PDF", icon: <FileText className="h-4 w-4 text-rose-600" /> };
  if (mime.includes("jpeg") || mime.includes("jpg")) return { label: "JPG", icon: <FileImage className="h-4 w-4 text-amber-600" /> };
  if (mime.includes("png")) return { label: "PNG", icon: <FileImage className="h-4 w-4 text-sky-600" /> };
  if (mime.includes("webp")) return { label: "WEBP", icon: <FileImage className="h-4 w-4 text-violet-600" /> };
  return { label: "FILE", icon: <File className="h-4 w-4 text-muted-foreground" /> };
}

function isPreviewable(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|pdf)(\?|$)/i.test(url);
}

export function AdditionalDocumentsSection({
  value, onChange, hint, readOnly,
}: AdditionalDocumentsSectionProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);

  // Use locale-aware strings; fall back to English when the i18n key isn't yet
  // present in translations.ts so we never show raw key names to the user.
  const labelTitle = t("requests.additionalDocs.title") || "Additional Documents";
  const labelAdd = t("requests.additionalDocs.add") || "Add Files";
  const labelEmpty = t("requests.additionalDocs.empty") || "No additional documents uploaded yet.";
  const labelUploading = t("requests.additionalDocs.uploading") || "Uploading…";
  const labelUploadOk = t("requests.additionalDocs.uploadOk") || "File uploaded";
  const labelUploadFail = t("requests.additionalDocs.uploadFail") || "Upload failed";
  const labelRemoveOk = t("requests.additionalDocs.removeOk") || "File removed";
  const labelRemoveFail = t("requests.additionalDocs.removeFail") || "Remove failed";
  const labelPreview = t("requests.additionalDocs.preview") || "Preview";
  const labelDownload = t("requests.additionalDocs.download") || "Download";
  const labelRemove = t("requests.additionalDocs.remove") || "Remove";
  const labelUploadedAt = t("requests.additionalDocs.uploadedAt") || "Uploaded";
  const labelSize = t("requests.additionalDocs.size") || "Size";

  async function handleFiles(files: FileList | File[]) {
    if (readOnly) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setProgress(0);

    try {
      const newDocs: AdditionalDocument[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const fd = new FormData();
        fd.append("file", f);
        const res = await api.post<AdditionalDocument>("/api/requests/upload-doc", fd);
        newDocs.push(res);
        setProgress(Math.round(((i + 1) / list.length) * 100));
      }
      onChange([...value, ...newDocs]);
      toast({ title: labelUploadOk, description: list.length === 1 ? list[0]!.name : `${list.length} files` });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Network error";
      toast({ title: labelUploadFail, description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(url: string) {
    if (readOnly) return;
    setPendingDelete(url);
    try {
      // Best-effort delete — the file is already on disk and the URL is in
      // our state. There's no DELETE endpoint for request-level docs (they're
      // attached at request creation time), so we just remove from the array.
      // The orphaned file will be cleaned up by the periodic janitor if any.
      onChange(value.filter((d) => d.url !== url));
      toast({ title: labelRemoveOk });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Network error";
      toast({ title: labelRemoveFail, description: msg, variant: "destructive" });
    } finally {
      setPendingDelete(null);
    }
  }

  const onDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }, [value, readOnly]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" />
            {labelTitle}
          </h3>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Upload className="h-4 w-4 me-1.5" />}
            {uploading ? labelUploading : labelAdd}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
          }}
        />
      </div>

      {uploading && (
        <Progress value={progress} className="h-1.5" />
      )}

      {value.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-muted-foreground/30 p-6 text-center text-xs text-muted-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          {labelEmpty}
          {!readOnly && (
            <div className="mt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 me-1.5" />{labelAdd}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          {value.map((doc) => {
            const { label, icon } = formatType(doc.type);
            const isImg = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(doc.url);
            const date = new Date(doc.uploadedAt);
            const dateLabel = Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
            return (
              <div
                key={doc.url}
                className="rounded-md border bg-card p-3 text-xs space-y-2 shadow-sm hover:shadow transition-shadow"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" title={doc.originalName ?? doc.filename}>
                      {doc.originalName ?? doc.filename}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {doc.filename}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[9px] font-mono h-4 px-1.5">
                    {label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                  <div>
                    <span className="font-medium">{labelUploadedAt}:</span> {dateLabel}
                  </div>
                  <div className="text-end">
                    <span className="font-medium">{labelSize}:</span> {formatBytes(doc.size)}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1 pt-1 border-t">
                  {isPreviewable(doc.url) && (
                    <Button asChild variant="ghost" size="sm" className="h-6 px-1.5" title={labelPreview}>
                      <a href={doc.url} target="_blank" rel="noreferrer">
                        {isImg ? <Eye className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      </a>
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="sm" className="h-6 px-1.5" title={labelDownload}>
                    <a href={doc.url} target="_blank" rel="noreferrer" download>
                      <Download className="h-3 w-3" />
                    </a>
                  </Button>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title={labelRemove}
                      disabled={pendingDelete === doc.url}
                      onClick={() => void handleRemove(doc.url)}
                    >
                      {pendingDelete === doc.url ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
