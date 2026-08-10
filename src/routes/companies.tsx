"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus, Mail, Phone, MapPin, AlertCircle, Contact as ContactIcon, Star } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { useAppStore } from "@/lib/store/app-store";
import { REGIONS, REGION_LABELS } from "@/lib/regions";
import { CompanyProfileDialog } from "@/components/company/company-profile-dialog";

interface Company {
  id: string;
  refNumber: string;
  name: string;
  nameAr?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  email?: string | null;
  phone?: string | null;
  status: string;
  contacts?: Array<{
    id: string;
    fullName: string;
    fullNameAr?: string | null;
    jobTitle?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
    isPrimary: boolean;
  }>;
  contactsCount: number;
  requestsCount: number;
  usersCount: number;
  createdAt: string;
}

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export function CompaniesRoute() {
  const { t, locale } = useI18n();
  const { navigate } = useAppStore();

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Company>("/companies", { pageSize: 10 });

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Company>({
    resource: "/companies",
    module: "companies",
    refetch,
    fetchOnEdit: true,
  });

  const [profileCompany, setProfileCompany] = useState<Company | null>(null);

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
            <div className="text-[10px] text-muted-foreground font-mono">{row.refNumber}</div>
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
      key: "region",
      header: t("companies.region"),
      cell: (row) =>
        row.region ? (
          <Badge variant="outline" className="text-xs font-mono">
            {REGION_LABELS[row.region as keyof typeof REGION_LABELS]?.[locale === "ar" ? "ar" : "en"] ?? row.region}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "contact",
      header: t("companies.contacts"),
      cell: (row) => {
        const contacts = row.contacts ?? [];
        const fallback = !contacts.length && (row.email || row.phone);
        return (
          <div className="space-y-1.5 max-w-[260px]">
            {contacts.length > 0 ? (
              contacts.map((ct) => (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => navigate("company-contacts", row.id)}
                  className="block w-full text-start rounded-md px-1.5 -mx-1.5 py-1 hover:bg-muted/60 transition-colors"
                  title={t("companies.openProfile")}
                >
                  <div className="text-xs font-medium flex items-center gap-1">
                    <span className="truncate">{ct.fullName}</span>
                    {ct.isPrimary && <Star className="h-3 w-3 text-warning fill-warning shrink-0" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {ct.mobile && (
                      <a
                        href={`tel:${ct.mobile}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        <Phone className="h-3 w-3" />{ct.mobile}
                      </a>
                    )}
                    {ct.phone && !ct.mobile && (
                      <a
                        href={`tel:${ct.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        <Phone className="h-3 w-3" />{ct.phone}
                      </a>
                    )}
                    {ct.email && (
                      <a
                        href={`mailto:${ct.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        <Mail className="h-3 w-3" />{ct.email}
                      </a>
                    )}
                  </div>
                </button>
              ))
            ) : (
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
                {!fallback && (
                  <div className="text-xs text-muted-foreground">—</div>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "stats",
      header: t("companies.contacts"),
      cell: (row) => (
        <div className="flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => navigate("company-contacts", row.id)}
            className="text-start rounded-md px-1 -mx-1 hover:bg-muted/60 transition-colors"
            title={t("companies.openProfile")}
          >
            <div className="font-semibold tabular-nums">{row.contactsCount}</div>
            <div className="text-muted-foreground underline decoration-dotted underline-offset-2">{t("companies.contacts")}</div>
          </button>
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
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={t("companies.contacts")}
            onClick={() => navigate("company-contacts", row.id)}
          >
            <ContactIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={t("companies.profile")}
            onClick={() => setProfileCompany(row)}
          >
            <Building2 className="h-4 w-4" />
          </Button>
          <RowActions
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={() => void openEdit(row)}
            onDelete={() => setDeleteTarget(row)}
          />
        </div>
      ),
    },
  ];

  const handleSubmit = () =>
    void submit(requireFields({
      [t("companies.name")]: "name",
      [t("companies.email")]: "email",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("companies.title")}
        subtitle={t("companies.subtitle")}
        icon={Building2}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("company-contacts")}>
              <ContactIcon className="h-4 w-4 me-1.5" />
              {t("contacts.title")}
            </Button>
            {canCreate && (
              <Button onClick={() => openCreate({ status: "ACTIVE" })}>
                <Plus className="h-4 w-4 me-1.5" />
                {t("companies.new")}
              </Button>
            )}
          </>
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
            <Button onClick={() => openCreate({ status: "ACTIVE" })}>
              <Plus className="h-4 w-4 me-1.5" />
              {t("companies.new")}
            </Button>
          )
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("companies.edit") : t("companies.new")}
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
              <Field label={t("companies.region")} hint={t("companies.regionHint")}>
                <Select
                  value={(formData.region as string) ?? ""}
                  onValueChange={(v) => setField("region", v === "__none__" ? null : v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("misc.none")}</SelectItem>
                    {REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>{REGION_LABELS[r][locale === "ar" ? "ar" : "en"]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <Select
                value={(formData.status as string) ?? "ACTIVE"}
                onValueChange={(v) => setField("status", v)}
              >
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

      <CompanyProfileDialog
        companyId={profileCompany?.id ?? null}
        onOpenChange={(o) => !o && setProfileCompany(null)}
        onChanged={refetch}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.name}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
