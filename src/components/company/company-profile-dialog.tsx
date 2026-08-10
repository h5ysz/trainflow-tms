"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { RowActions } from "@/components/common/row-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ContactTypeBadge } from "@/components/company/contact-type-badge";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS } from "@/lib/contact-types";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { Building2, Contact as ContactIcon, Mail, MapPin, Phone, Plus, Star, Users, Globe, AlertCircle, ArrowUpRight } from "lucide-react";

interface Contact {
  id: string;
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
}

interface CompanyProfile {
  id: string;
  refNumber: string;
  name: string;
  nameAr?: string | null;
  legalName?: string | null;
  crNumber?: string | null;
  vatNumber?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status: string;
  contacts?: Contact[];
  users?: Array<{ id: string; fullName: string; email: string; role: string }>;
}

interface Props {
  companyId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Called after any contact add/edit/delete so the parent list can refresh counts. */
  onChanged?: () => void;
}

export function CompanyProfileDialog({ companyId, onOpenChange, onChanged }: Props) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user, navigate } = useAppStore();

  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contact create/edit state
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState<Record<string, unknown>>({});
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState(false);

  const permissions = user?.permissions ?? [];
  const canCreate = canPerformAction(permissions, "company-contacts", "create");
  const canEdit = canPerformAction(permissions, "company-contacts", "edit");
  const canDelete = canPerformAction(permissions, "company-contacts", "delete");

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.get<CompanyProfile>(`/companies/${id}`);
      setProfile(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (companyId) void load(companyId);
  }, [companyId, load]);

  const refresh = () => {
    if (companyId) void load(companyId);
    onChanged?.();
  };

  const openCreateContact = () => {
    setEditingContactId(null);
    setContactForm({ isActive: true, isPrimary: false });
    setContactDialogOpen(true);
  };

  const openEditContact = (c: Contact) => {
    setEditingContactId(c.id);
    setContactForm({ ...c });
    setContactDialogOpen(true);
  };

  const setContactField = (k: string, v: unknown) => setContactForm((p) => ({ ...p, [k]: v }));

  const submitContact = async () => {
    const fullName = contactForm.fullName as string | undefined;
    if (!fullName || !String(fullName).trim()) {
      toast({ title: t("misc.error"), description: `${t("contacts.fullName")} — ${t("misc.required")}`, variant: "destructive" });
      return;
    }
    setContactSubmitting(true);
    try {
      const body = { ...contactForm, companyId };
      if (editingContactId) await api.put(`/company-contacts/${editingContactId}`, body);
      else await api.post("/company-contacts", body);
      toast({ title: t("misc.success"), description: editingContactId ? t("misc.updateSuccess") : t("misc.createSuccess") });
      setContactDialogOpen(false);
      setEditingContactId(null);
      setContactForm({});
      refresh();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setContactSubmitting(false);
    }
  };

  const confirmDeleteContact = async () => {
    if (!deleteContact) return;
    setDeletingContact(true);
    try {
      await api.delete(`/company-contacts/${deleteContact.id}`);
      toast({ title: t("misc.success"), description: t("misc.deleteSuccess") });
      setDeleteContact(null);
      refresh();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeletingContact(false);
    }
  };

  const contactName = (c: Contact) => (locale === "ar" && c.fullNameAr ? c.fullNameAr : c.fullName);

  return (
    <Dialog open={companyId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            {t("companies.profile")}
          </DialogTitle>
          <DialogDescription>{t("companies.subtitle")}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {!error && profile && (
          <div className="space-y-5">
            {/* Company header */}
            <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <div className="text-base font-semibold flex items-center gap-2 flex-wrap">
                  <span className="truncate">{profile.name}</span>
                  {profile.nameAr && <span dir="rtl" className="text-sm text-muted-foreground">({profile.nameAr})</span>}
                  <StatusBadge status={profile.status} />
                </div>
                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                  <div className="font-mono">{profile.refNumber}</div>
                  {(profile.industry || profile.crNumber || profile.vatNumber) && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {profile.industry && <span>{profile.industry}</span>}
                      {profile.crNumber && <span className="font-mono">CR: {profile.crNumber}</span>}
                      {profile.vatNumber && <span className="font-mono">VAT: {profile.vatNumber}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {profile.city && (
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{[profile.city, profile.country].filter(Boolean).join(", ")}</span>
                    )}
                    {profile.email && (
                      <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{profile.email}</span>
                    )}
                    {profile.phone && (
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{profile.phone}</span>
                    )}
                    {profile.website && (
                      <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{profile.website}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Contacts */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold flex items-center gap-1.5">
                  <ContactIcon className="h-4 w-4 text-muted-foreground" />
                  {t("companies.contacts")}
                  <span className="text-[10px] text-muted-foreground">({profile.contacts?.length ?? 0})</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { onOpenChange(false); if (companyId) navigate("company-contacts", companyId); }}>
                    {t("companies.viewAllContacts")} <ArrowUpRight className="h-3.5 w-3.5 ms-1" />
                  </Button>
                  {canCreate && (
                    <Button size="sm" variant="outline" onClick={openCreateContact}>
                      <Plus className="h-3.5 w-3.5 me-1.5" />{t("companies.addContact")}
                    </Button>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="rounded-md border p-4 text-center text-xs text-muted-foreground">Loading…</div>
              ) : (profile.contacts ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  {t("companies.noContacts")}
                </div>
              ) : (
                <div className="space-y-2">
                  {(profile.contacts ?? []).map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          <span className="truncate">{contactName(c)}</span>
                          {c.isPrimary && <Star className="h-3 w-3 text-warning fill-warning shrink-0" />}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          {c.jobTitle && <span className="truncate">{c.jobTitle}</span>}
                          {locale !== "ar" && c.fullNameAr && <span dir="rtl" className="text-muted-foreground/80">({c.fullNameAr})</span>}
                          <ContactTypeBadge value={c.contactType} />
                          {!c.isActive && <span className="text-[10px] text-muted-foreground">({t("status.INACTIVE")})</span>}
                        </div>
                        {(c.email || c.phone || c.mobile) && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                            {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                            {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                            {c.mobile && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.mobile}</span>}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        <RowActions
                          canEdit={canEdit}
                          canDelete={canDelete}
                          onEdit={() => openEditContact(c)}
                          onDelete={() => setDeleteContact(c)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Company users */}
            {(profile.users ?? []).length > 0 && (
              <div>
                <div className="mb-2 text-sm font-semibold flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {t("companies.users")}
                  <span className="text-[10px] text-muted-foreground">({profile.users?.length})</span>
                </div>
                <div className="space-y-1.5">
                  {profile.users?.map((u) => (
                    <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                      <span className="font-medium">{u.fullName}</span>
                      <span className="text-muted-foreground font-mono">{u.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nested contact form */}
        <FormDialog
          open={contactDialogOpen}
          onOpenChange={(o) => !o && setContactDialogOpen(false)}
          title={editingContactId ? t("contacts.edit") : t("contacts.new")}
          description={profile?.name}
          icon={ContactIcon}
          size="lg"
          onSubmit={() => void submitContact()}
          isSubmitting={contactSubmitting}
        >
          <div className="space-y-5">
            <FormGrid>
              <Field label={t("contacts.fullName")} required>
                <Input placeholder="Full name" value={(contactForm.fullName as string) ?? ""} onChange={(e) => setContactField("fullName", e.target.value)} />
              </Field>
              <Field label={t("contacts.fullNameAr")}>
                <Input dir="rtl" placeholder="الاسم بالعربية" value={(contactForm.fullNameAr as string) ?? ""} onChange={(e) => setContactField("fullNameAr", e.target.value)} />
              </Field>
              <Field label={t("contacts.jobTitle")}>
                <Input placeholder="HSE Manager" value={(contactForm.jobTitle as string) ?? ""} onChange={(e) => setContactField("jobTitle", e.target.value)} />
              </Field>
              <Field label={t("contacts.contactType")} hint={t("contacts.contactTypeHint")}>
                <Select value={(contactForm.contactType as string) ?? ""} onValueChange={(v) => setContactField("contactType", v === "__none__" ? null : v)}>
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
                <Input type="email" placeholder="name@company.com" value={(contactForm.email as string) ?? ""} onChange={(e) => setContactField("email", e.target.value)} />
              </Field>
              <Field label={t("contacts.phone")}>
                <Input placeholder="+966 11 000 0000" value={(contactForm.phone as string) ?? ""} onChange={(e) => setContactField("phone", e.target.value)} />
              </Field>
              <Field label={t("contacts.mobile")}>
                <Input placeholder="+966 5X XXX XXXX" value={(contactForm.mobile as string) ?? ""} onChange={(e) => setContactField("mobile", e.target.value)} />
              </Field>
              <Field label="Preferred Contact">
                <Select value={(contactForm.preferredContact as string) ?? ""} onValueChange={(v) => setContactField("preferredContact", v)}>
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
              <Textarea placeholder={t("contacts.notes")} rows={3} value={(contactForm.notes as string) ?? ""} onChange={(e) => setContactField("notes", e.target.value)} />
            </Field>
            <div className="flex items-center gap-6 border-t pt-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={(contactForm.isPrimary as boolean) ?? false} onCheckedChange={(v) => setContactField("isPrimary", v)} /> {t("contacts.isPrimary")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={(contactForm.isActive as boolean) ?? true} onCheckedChange={(v) => setContactField("isActive", v)} /> {t("contacts.isActive")}
              </label>
            </div>
          </div>
        </FormDialog>

        <ConfirmDialog
          open={deleteContact !== null}
          onOpenChange={(o) => !o && setDeleteContact(null)}
          description={deleteContact?.fullName}
          destructive
          loading={deletingContact}
          onConfirm={() => void confirmDeleteContact()}
        />
      </DialogContent>
    </Dialog>
  );
}
