"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Building2, Plus, Mail, Phone, MapPin, Loader2, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface Company {
  id: string;
  name: string;
  nameAr?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  status: string;
  contactsCount: number;
  requestsCount: number;
  usersCount: number;
  createdAt: string;
}

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export function CompaniesRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Company>("/companies", { pageSize: 10 });

  const canCreate = user ? canPerformAction(user.role, "companies", "create") : false;

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

  const handleSubmit = async () => {
    if (!formData.name) {
      toast({ title: t("misc.error"), description: "Name is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/companies", formData);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({});
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("companies.title")}
        subtitle={t("companies.subtitle")}
        icon={Building2}
        actions={
          canCreate && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 me-1.5" />
              {t("companies.new")}
            </Button>
          )
        }
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
        searchPlaceholder={t("action.search")}
        page={page}
        total={pagination?.total ?? 0}
        pageSize={pagination?.pageSize ?? 10}
        onPageChange={setPage}
        emptyIcon={Building2}
        emptyTitle={t("companies.empty.title")}
        emptySubtitle={t("companies.empty.subtitle")}
        emptyAction={
          canCreate && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 me-1.5" />
              {t("companies.new")}
            </Button>
          )
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("companies.new")}
        description={t("companies.subtitle")}
        icon={Building2}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("companies.name")} required>
              <Input
                placeholder="Acme Contracting Co."
                value={(formData.name as string) ?? ""}
                onChange={(e) => setField("name", e.target.value)}
              />
            </Field>
            <Field label={t("companies.nameAr")}>
              <Input
                placeholder="أكمة للمقاولات"
                dir="rtl"
                value={(formData.nameAr as string) ?? ""}
                onChange={(e) => setField("nameAr", e.target.value)}
              />
            </Field>
            <Field label={t("companies.legalName")}>
              <Input
                placeholder="Acme Contracting Co. Ltd."
                value={(formData.legalName as string) ?? ""}
                onChange={(e) => setField("legalName", e.target.value)}
              />
            </Field>
            <Field label={t("companies.crNumber")}>
              <Input
                placeholder="CR-00000000"
                value={(formData.crNumber as string) ?? ""}
                onChange={(e) => setField("crNumber", e.target.value)}
              />
            </Field>
            <Field label={t("companies.vatNumber")}>
              <Input
                placeholder="VAT-000000000"
                value={(formData.vatNumber as string) ?? ""}
                onChange={(e) => setField("vatNumber", e.target.value)}
              />
            </Field>
            <Field label={t("companies.industry")}>
              <Input
                placeholder="Construction / Oil & Gas / Manufacturing"
                value={(formData.industry as string) ?? ""}
                onChange={(e) => setField("industry", e.target.value)}
              />
            </Field>
          </FormGrid>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("companies.country")}>
                <Input
                  placeholder="Saudi Arabia"
                  value={(formData.country as string) ?? ""}
                  onChange={(e) => setField("country", e.target.value)}
                />
              </Field>
              <Field label={t("companies.city")}>
                <Input
                  placeholder="Riyadh"
                  value={(formData.city as string) ?? ""}
                  onChange={(e) => setField("city", e.target.value)}
                />
              </Field>
              <Field label={t("companies.address")}>
                <Input
                  placeholder="King Fahd Rd, District"
                  value={(formData.address as string) ?? ""}
                  onChange={(e) => setField("address", e.target.value)}
                />
              </Field>
              <Field label={t("companies.postalCode")}>
                <Input
                  placeholder="11564"
                  value={(formData.postalCode as string) ?? ""}
                  onChange={(e) => setField("postalCode", e.target.value)}
                />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("companies.phone")}>
                <Input
                  placeholder="+966 11 000 0000"
                  value={(formData.phone as string) ?? ""}
                  onChange={(e) => setField("phone", e.target.value)}
                />
              </Field>
              <Field label={t("companies.email")} required>
                <Input
                  type="email"
                  placeholder="info@company.com"
                  value={(formData.email as string) ?? ""}
                  onChange={(e) => setField("email", e.target.value)}
                />
              </Field>
              <Field label={t("companies.website")}>
                <Input
                  placeholder="https://company.com"
                  value={(formData.website as string) ?? ""}
                  onChange={(e) => setField("website", e.target.value)}
                />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("companies.contactPerson")}>
                <Input
                  placeholder="Full name"
                  value={(formData.contactPerson as string) ?? ""}
                  onChange={(e) => setField("contactPerson", e.target.value)}
                />
              </Field>
              <Field label={t("companies.contactPhone")}>
                <Input
                  placeholder="+966 5X XXX XXXX"
                  value={(formData.contactPhone as string) ?? ""}
                  onChange={(e) => setField("contactPhone", e.target.value)}
                />
              </Field>
              <Field label={t("companies.contactEmail")}>
                <Input
                  type="email"
                  placeholder="contact@company.com"
                  value={(formData.contactEmail as string) ?? ""}
                  onChange={(e) => setField("contactEmail", e.target.value)}
                />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4">
            <Field label={t("companies.status")}>
              <Select defaultValue="ACTIVE" onValueChange={(v) => setField("status", v)}>
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
