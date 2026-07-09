"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Contact as ContactIcon, Plus, Mail, Phone, Star, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface CompanyOption { id: string; name: string; }
interface Contact {
  id: string;
  fullName: string;
  jobTitle?: string | null;
  companyName?: string | null;
  companyRef?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  preferredContact?: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export function CompanyContactsRoute() {
  const { t } = useI18n();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Contact>("/company-contacts");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Contact>({
    resource: "/company-contacts",
    module: "company-contacts",
    refetch,
    fetchOnEdit: true,
  });

  // Load companies for the dropdown when dialog opens
  useEffect(() => {
    if (dialogOpen && companies.length === 0) {
      api.getList<CompanyOption>("/companies", { pageSize: 100 }).then((r) => {
        setCompanies(r.rows.map((c) => ({ id: c.id, name: c.name })));
      }).catch(() => {});
    }
  }, [dialogOpen, companies.length]);

  const columns: Column<Contact>[] = [
    {
      key: "name",
      header: t("contacts.fullName"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-info/10 text-info text-xs font-semibold shrink-0">
            {r.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium flex items-center gap-1.5">
              {r.fullName}
              {r.isPrimary && <Star className="h-3 w-3 text-warning fill-warning" />}
            </div>
            <div className="text-xs text-muted-foreground">{r.jobTitle || "—"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "company",
      header: t("contacts.company"),
      cell: (r) => <span className="text-sm">{r.companyName || "—"}</span>,
    },
    {
      key: "email",
      header: t("contacts.email"),
      cell: (r) => r.email ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{r.email}</div>
      ) : "—",
    },
    {
      key: "phone",
      header: t("contacts.phone"),
      cell: (r) => (
        <div className="space-y-0.5">
          {r.phone && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{r.phone}</div>}
          {r.mobile && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{r.mobile}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: t("contacts.isActive"),
      cell: (r) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${r.isActive ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground border-border"}`}>
          {r.isActive ? t("status.ACTIVE") : t("status.INACTIVE")}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
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

  const handleSubmit = () =>
    void submit(requireFields({
      [t("contacts.company")]: "companyId",
      [t("contacts.fullName")]: "fullName",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("contacts.title")}
        subtitle={t("contacts.subtitle")}
        icon={ContactIcon}
        actions={canCreate && <Button onClick={() => openCreate({ isActive: true })}><Plus className="h-4 w-4 me-1.5" />{t("contacts.new")}</Button>}
      />
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        page={page}
        total={pagination?.total ?? 0}
        pageSize={pagination?.pageSize ?? 10}
        onPageChange={setPage}
        emptyIcon={ContactIcon}
        emptyTitle={t("contacts.empty.title")}
        emptySubtitle={t("contacts.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => openCreate({ isActive: true })}><Plus className="h-4 w-4 me-1.5" />{t("contacts.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("contacts.edit") : t("contacts.new")}
        description={t("contacts.subtitle")}
        icon={ContactIcon}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("contacts.company")} required>
              <Select value={(formData.companyId as string) ?? ""} onValueChange={(v) => setField("companyId", v)}>
                <SelectTrigger><SelectValue placeholder={t("contacts.company")} /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("contacts.fullName")} required>
              <Input placeholder="Full name" value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("contacts.jobTitle")}>
              <Input placeholder="HSE Manager" value={(formData.jobTitle as string) ?? ""} onChange={(e) => setField("jobTitle", e.target.value)} />
            </Field>
            <Field label={t("contacts.email")}>
              <Input type="email" placeholder="name@company.com" value={(formData.email as string) ?? ""} onChange={(e) => setField("email", e.target.value)} />
            </Field>
            <Field label={t("contacts.phone")}>
              <Input placeholder="+966 11 000 0000" value={(formData.phone as string) ?? ""} onChange={(e) => setField("phone", e.target.value)} />
            </Field>
            <Field label={t("contacts.mobile")}>
              <Input placeholder="+966 5X XXX XXXX" value={(formData.mobile as string) ?? ""} onChange={(e) => setField("mobile", e.target.value)} />
            </Field>
            <Field label="Preferred Contact">
              <Select value={(formData.preferredContact as string) ?? ""} onValueChange={(v) => setField("preferredContact", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PHONE">Phone</SelectItem>
                  <SelectItem value="MOBILE">Mobile</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
          <Field label={t("contacts.notes")}>
            <Textarea placeholder={t("contacts.notes")} rows={3} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>
          <div className="flex items-center gap-6 border-t pt-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={(formData.isPrimary as boolean) ?? false} onCheckedChange={(v) => setField("isPrimary", v)} /> {t("contacts.isPrimary")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={(formData.isActive as boolean) ?? true} onCheckedChange={(v) => setField("isActive", v)} /> {t("contacts.isActive")}
            </label>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.fullName}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
