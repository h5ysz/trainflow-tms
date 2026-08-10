"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { ContactTypeBadge } from "@/components/company/contact-type-badge";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS } from "@/lib/contact-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import {
  Building2, Contact as ContactIcon, Folder, FolderOpen, Mail, Phone, Plus,
  Search, Star, AlertCircle, UserRoundPlus, ChevronLeft,
} from "lucide-react";

interface CompanyOption {
  id: string;
  name: string;
  nameAr?: string | null;
  refNumber: string;
}

interface Contact {
  id: string;
  companyId: string;
  fullName: string;
  fullNameAr?: string | null;
  jobTitle?: string | null;
  contactType?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  preferredContact?: string | null;
  isPrimary: boolean;
  isActive: boolean;
  notes?: string | null;
  createdAt: string;
}

export function CompanyContactsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user, routeParam, navigate } = useAppStore();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [contactsByCompany, setContactsByCompany] = useState<Record<string, Contact[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // When reached from a company row ("company-contacts?company=<id>"), the page
  // is scoped to that company's folder only, and it opens expanded.
  const scopedCompanyId = routeParam ?? null;
  const [expanded, setExpanded] = useState<string[]>(scopedCompanyId ? [scopedCompanyId] : []);

  // Contact create/edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folderCompany, setFolderCompany] = useState<CompanyOption | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; fullName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const permissions = user?.permissions ?? [];
  const canCreate = canPerformAction(permissions, "company-contacts", "create");
  const canEdit = canPerformAction(permissions, "company-contacts", "edit");
  const canDelete = canPerformAction(permissions, "company-contacts", "delete");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [comps, conts] = await Promise.all([
        api.getList<CompanyOption>("/companies", { pageSize: 100 }),
        api.getList<Contact>("/company-contacts", { pageSize: 100 }),
      ]);
      setCompanies(comps.rows);
      const grouped: Record<string, Contact[]> = {};
      for (const c of conts.rows) {
        (grouped[c.companyId] ??= []).push(c);
      }
      // Primary contact first, then most recent.
      for (const key of Object.keys(grouped)) {
        grouped[key].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || +new Date(b.createdAt) - +new Date(a.createdAt));
      }
      setContactsByCompany(grouped);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCompanies = useMemo(() => {
    let list = companies;
    if (scopedCompanyId) list = companies.filter((c) => c.id === scopedCompanyId);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const nameMatch =
        c.name.toLowerCase().includes(q) ||
        (c.nameAr ?? "").toLowerCase().includes(q) ||
        c.refNumber.toLowerCase().includes(q);
      const contactMatch = (contactsByCompany[c.id] ?? []).some((ct) =>
        ct.fullName.toLowerCase().includes(q) || (ct.fullNameAr ?? "").toLowerCase().includes(q)
      );
      return nameMatch || contactMatch;
    });
  }, [companies, contactsByCompany, search, scopedCompanyId]);

  const folderName = (c: CompanyOption) => (locale === "ar" && c.nameAr ? c.nameAr : c.name);

  const scopedCompany = scopedCompanyId ? companies.find((c) => c.id === scopedCompanyId) ?? null : null;

  const setField = (k: string, v: unknown) => setFormData((p) => ({ ...p, [k]: v }));

  const openCreate = (company: CompanyOption) => {
    setEditingId(null);
    setFolderCompany(company);
    setFormData({ isActive: true, isPrimary: false });
    setDialogOpen(true);
  };

  const openEdit = (company: CompanyOption, contact: Contact) => {
    setEditingId(contact.id);
    setFolderCompany(company);
    setFormData({ ...contact });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setFolderCompany(null);
    setFormData({});
  };

  const submit = async () => {
    const fullName = formData.fullName as string | undefined;
    if (!fullName || !String(fullName).trim()) {
      toast({ title: t("misc.error"), description: `${t("contacts.fullName")} — ${t("misc.required")}`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body = { ...formData, companyId: folderCompany?.id };
      if (editingId) await api.put(`/company-contacts/${editingId}`, body);
      else await api.post("/company-contacts", body);
      toast({ title: t("misc.success"), description: editingId ? t("misc.updateSuccess") : t("misc.createSuccess") });
      closeDialog();
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/company-contacts/${deleteTarget.id}`);
      toast({ title: t("misc.success"), description: t("misc.deleteSuccess") });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const contactName = (c: Contact) => (locale === "ar" && c.fullNameAr ? c.fullNameAr : c.fullName);

  return (
    <div className="space-y-5">
      <PageHeader
        title={scopedCompany ? folderName(scopedCompany) : t("contacts.title")}
        subtitle={scopedCompany ? `${scopedCompany.refNumber} — ${t("contacts.subtitle")}` : t("contacts.subtitle")}
        icon={scopedCompany ? Building2 : ContactIcon}
      />

      <div className="flex items-center gap-2">
        {scopedCompanyId && (
          <Button variant="outline" size="sm" onClick={() => navigate("company-contacts")}>
            <ChevronLeft className="h-4 w-4 me-1.5" />
            {locale === "ar" ? "كل الشركات" : "All companies"}
          </Button>
        )}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t("action.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border p-10 text-center text-xs text-muted-foreground">Loading…</div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-10 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("companies.empty.title")}</p>
          <p className="text-xs text-muted-foreground">{t("companies.empty.subtitle")}</p>
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("contacts.empty.title")}
        </div>
      ) : (
        <Accordion type="multiple" value={expanded} onValueChange={setExpanded} className="rounded-lg border">
          {filteredCompanies.map((company) => {
            const folderContacts = contactsByCompany[company.id] ?? [];
            return (
              <AccordionItem key={company.id} value={company.id} className="px-2">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      {folderContacts.length > 0 ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 text-start">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        <span className="truncate">{folderName(company)}</span>
                        {company.nameAr && locale !== "ar" && (
                          <span dir="rtl" className="text-xs text-muted-foreground">({company.nameAr})</span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">{company.refNumber}</div>
                    </div>
                    <span className={`ms-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${folderContacts.length > 0 ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"}`}>
                      {folderContacts.length}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <div className="text-xs text-muted-foreground">
                      {folderContacts.length > 0
                        ? `${folderContacts.length} ${folderContacts.length === 1 ? (locale === "ar" ? "جهة اتصال" : "contact") : (locale === "ar" ? "جهات اتصال" : "contacts")}`
                        : t("companies.noContacts")}
                    </div>
                    {canCreate && (
                      <Button size="sm" variant="outline" onClick={() => openCreate(company)}>
                        <Plus className="h-3.5 w-3.5 me-1.5" />{t("companies.addContact")}
                      </Button>
                    )}
                  </div>

                  {folderContacts.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                      {t("companies.noContacts")}
                      {canCreate && (
                        <div className="mt-2">
                          <Button size="sm" variant="outline" onClick={() => openCreate(company)}>
                            <UserRoundPlus className="h-3.5 w-3.5 me-1.5" />{t("contacts.new")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {folderContacts.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium flex items-center gap-1.5">
                              <span className="truncate">{contactName(c)}</span>
                              {c.isPrimary && <Star className="h-3 w-3 text-warning fill-warning shrink-0" />}
                              <StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} />
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                              {c.jobTitle && <span className="truncate">{c.jobTitle}</span>}
                              {locale !== "ar" && c.fullNameAr && <span dir="rtl" className="text-muted-foreground/80">({c.fullNameAr})</span>}
                              <ContactTypeBadge value={c.contactType} />
                            </div>
                            {(c.email || c.phone || c.mobile) && (
                              <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                                {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                                {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                                {c.mobile && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.mobile}</span>}
                              </div>
                            )}
                          </div>
                          {(canEdit || canDelete) && (
                            <div className="flex shrink-0 items-center gap-1">
                              {canEdit && (
                                <Button size="sm" variant="ghost" onClick={() => openEdit(company, c)}>
                                  {t("action.edit") || "Edit"}
                                </Button>
                              )}
                              {canDelete && (
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: c.id, fullName: contactName(c) })}>
                                  {t("action.delete") || "Delete"}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* Contact create/edit dialog — company is fixed to the folder */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={editingId ? t("contacts.edit") : t("contacts.new")}
        description={folderCompany ? folderName(folderCompany) : undefined}
        icon={ContactIcon}
        size="lg"
        onSubmit={() => void submit()}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("contacts.fullName")} required>
              <Input placeholder="Full name" value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("contacts.fullNameAr")}>
              <Input dir="rtl" placeholder="الاسم بالعربية" value={(formData.fullNameAr as string) ?? ""} onChange={(e) => setField("fullNameAr", e.target.value)} />
            </Field>
            <Field label={t("contacts.jobTitle")}>
              <Input placeholder="HSE Manager" value={(formData.jobTitle as string) ?? ""} onChange={(e) => setField("jobTitle", e.target.value)} />
            </Field>
            <Field label={t("contacts.contactType")} hint={t("contacts.contactTypeHint")}>
              <Select value={(formData.contactType as string) ?? ""} onValueChange={(v) => setField("contactType", v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("misc.none")}</SelectItem>
                  {CONTACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>{CONTACT_TYPE_LABELS[ct][locale === "ar" ? "ar" : "en"]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
