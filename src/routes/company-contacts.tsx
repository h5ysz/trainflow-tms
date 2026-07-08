"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Contact as ContactIcon, Plus, Mail, Phone, Star } from "lucide-react";

interface Contact {
  id: string;
  fullName: string;
  jobTitle: string;
  companyName: string;
  email: string;
  phone: string;
  mobile: string;
  isPrimary: boolean;
  isActive: boolean;
}

export function CompanyContactsRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const data: Contact[] = [];

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
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.details")}</Button>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("contacts.title")}
        subtitle={t("contacts.subtitle")}
        icon={ContactIcon}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("contacts.new")}</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={ContactIcon}
        emptyTitle={t("contacts.empty.title")}
        emptySubtitle={t("contacts.empty.subtitle")}
        emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("contacts.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("contacts.new")}
        description={t("contacts.subtitle")}
        icon={ContactIcon}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("contacts.company")} required>
              <Select>
                <SelectTrigger><SelectValue placeholder={t("contacts.company")} /></SelectTrigger>
                <SelectContent><SelectItem value="—" disabled>—</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label={t("contacts.fullName")} required>
              <Input placeholder="Full name" />
            </Field>
            <Field label={t("contacts.jobTitle")}>
              <Input placeholder="HSE Manager" />
            </Field>
            <Field label={t("contacts.email")}>
              <Input type="email" placeholder="name@company.com" />
            </Field>
            <Field label={t("contacts.phone")}>
              <Input placeholder="+966 11 000 0000" />
            </Field>
            <Field label={t("contacts.mobile")}>
              <Input placeholder="+966 5X XXX XXXX" />
            </Field>
          </FormGrid>
          <Field label={t("contacts.notes")}>
            <Textarea placeholder={t("contacts.notes")} rows={3} />
          </Field>
          <div className="flex items-center gap-6 border-t pt-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch defaultChecked /> {t("contacts.isPrimary")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch defaultChecked /> {t("contacts.isActive")}
            </label>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
