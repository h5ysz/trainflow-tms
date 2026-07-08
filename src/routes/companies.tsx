"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Building2, Plus, Mail, Phone, Globe, MapPin } from "lucide-react";

interface Company {
  id: string;
  name: string;
  industry: string;
  country: string;
  city: string;
  email: string;
  phone: string;
  status: string;
  contactsCount: number;
  requestsCount: number;
}

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export function CompaniesRoute() {
  const { t } = useI18n();
  const { user } = useAppStore();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  // No fake data — empty state by design
  const data: Company[] = [];

  const columns: Column<Company>[] = [
    {
      key: "name",
      header: t("companies.name"),
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{row.name}</div>
            <div className="text-xs text-muted-foreground truncate">{row.industry || "—"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "location",
      header: t("companies.country"),
      cell: (row) => (
        <div className="text-sm text-muted-foreground flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          {[row.city, row.country].filter(Boolean).join(", ") || "—"}
        </div>
      ),
    },
    {
      key: "contact",
      header: t("companies.email"),
      cell: (row) => (
        <div className="space-y-0.5">
          {row.email && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3 w-3" /> {row.email}
            </div>
          )}
          {row.phone && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> {row.phone}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "stats",
      header: t("companies.contacts"),
      cell: (row) => (
        <div className="flex gap-3 text-xs">
          <div>
            <div className="font-semibold tabular-nums">{row.contactsCount}</div>
            <div className="text-muted-foreground">{t("companies.contacts")}</div>
          </div>
          <div>
            <div className="font-semibold tabular-nums">{row.requestsCount}</div>
            <div className="text-muted-foreground">{t("companies.requests")}</div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: t("companies.status"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => (
        <Button variant="ghost" size="sm" className="h-8">
          {t("action.details")}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("companies.title")}
        subtitle={t("companies.subtitle")}
        icon={Building2}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 me-1.5" />
            {t("companies.new")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("action.search")}
        emptyIcon={Building2}
        emptyTitle={t("companies.empty.title")}
        emptySubtitle={t("companies.empty.subtitle")}
        emptyAction={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 me-1.5" />
            {t("companies.new")}
          </Button>
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("companies.new")}
        description={t("companies.subtitle")}
        icon={Building2}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("companies.name")} required>
              <Input placeholder="Acme Contracting Co." />
            </Field>
            <Field label={t("companies.nameAr")}>
              <Input placeholder="أكمة للمقاولات" dir="rtl" />
            </Field>
            <Field label={t("companies.legalName")}>
              <Input placeholder="Acme Contracting Co. Ltd." />
            </Field>
            <Field label={t("companies.crNumber")}>
              <Input placeholder="CR-00000000" />
            </Field>
            <Field label={t("companies.vatNumber")}>
              <Input placeholder="VAT-000000000" />
            </Field>
            <Field label={t("companies.industry")}>
              <Input placeholder="Construction / Oil & Gas / Manufacturing" />
            </Field>
          </FormGrid>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("companies.country")}>
                <Input placeholder="Saudi Arabia" />
              </Field>
              <Field label={t("companies.city")}>
                <Input placeholder="Riyadh" />
              </Field>
              <Field label={t("companies.address")}>
                <Input placeholder="King Fahd Rd, District" />
              </Field>
              <Field label={t("companies.postalCode")}>
                <Input placeholder="11564" />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("companies.phone")}>
                <Input placeholder="+966 11 000 0000" />
              </Field>
              <Field label={t("companies.email")} required>
                <Input type="email" placeholder="info@company.com" />
              </Field>
              <Field label={t("companies.website")}>
                <Input placeholder="https://company.com" />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("companies.contactPerson")}>
                <Input placeholder="Full name" />
              </Field>
              <Field label={t("companies.contactPhone")}>
                <Input placeholder="+966 5X XXX XXXX" />
              </Field>
              <Field label={t("companies.contactEmail")}>
                <Input type="email" placeholder="contact@company.com" />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4">
            <Field label={t("companies.status")}>
              <Select defaultValue="ACTIVE">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
