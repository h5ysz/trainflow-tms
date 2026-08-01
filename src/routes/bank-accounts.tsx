"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Wallet, Plus, Landmark, CheckCircle2 } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { useToast } from "@/hooks/use-toast";
import { canPerformAction } from "@/lib/auth/permissions";

interface BankAccount {
  id: string;
  bankName: string;
  beneficiary: string;
  accountNumber: string;
  iban: string | null;
  swift: string | null;
  isActive: boolean;
  isDefault: boolean;
}

export function BankAccountsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();

  const canCreate = user ? canPerformAction(user.permissions, "bank-accounts", "create") : false;
  const canEdit = user ? canPerformAction(user.permissions, "bank-accounts", "edit") : false;
  const canDelete = user ? canPerformAction(user.permissions, "bank-accounts", "delete") : false;

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<BankAccount>("/bank-accounts");

  const {
    dialogOpen, formData, setField, submitting, submit, openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<BankAccount>({ resource: "/bank-accounts", module: "bank-accounts", refetch, toForm: (r) => ({ ...r }) });

  const columns: Column<BankAccount>[] = [
    { key: "bank", header: "Bank", cell: (r) => <div className="flex items-center gap-2 text-sm"><Landmark className="h-3.5 w-3.5 text-muted-foreground" />{r.bankName}</div> },
    { key: "beneficiary", header: "Beneficiary", cell: (r) => <div className="text-sm">{r.beneficiary}</div> },
    { key: "account", header: "Account #", cell: (r) => <div className="font-mono text-xs">{r.accountNumber}</div> },
    { key: "iban", header: "IBAN", cell: (r) => <div className="font-mono text-xs">{r.iban || "—"}</div> },
    { key: "swift", header: "SWIFT", cell: (r) => <div className="font-mono text-xs">{r.swift || "—"}</div> },
    {
      key: "status", header: "Status",
      cell: (r) => (
        <div className="flex items-center gap-2">
          {r.isDefault && <Badge className="bg-primary/15 text-primary">Default</Badge>}
          <Badge className={r.isActive ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>
            {r.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      ),
    },
    {
      key: "actions", header: "Actions", headerClassName: "text-end", className: "text-end",
      cell: (row) => canEdit ? (
        <Button variant="ghost" size="sm" onClick={() => void openEdit(row)}>Edit</Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bank Accounts"
        subtitle="Manage bank accounts displayed on invoices"
        icon={Wallet}
        actions={canCreate ? <Button onClick={() => openCreate({ isActive: true, isDefault: false })}><Plus className="h-4 w-4 me-1.5" />Add Bank</Button> : undefined}
      />
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
        emptyIcon={Wallet}
        emptyTitle="No bank accounts"
        emptySubtitle="Add a bank account to display on invoices"
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={formData.id ? "Edit Bank Account" : "Add Bank Account"}
        icon={Landmark}
        size="md"
        onSubmit={() => void submit()}
        isSubmitting={submitting}
      >
        <FormGrid>
          <Field label="Bank Name" required>
            <Input value={(formData.bankName as string) ?? ""} onChange={(e) => setField("bankName", e.target.value)} placeholder="Alinma Bank" />
          </Field>
          <Field label="Beneficiary" required>
            <Input value={(formData.beneficiary as string) ?? ""} onChange={(e) => setField("beneficiary", e.target.value)} placeholder="GCC ELECTRICAL TESTING LABORATORY" />
          </Field>
          <Field label="Account Number" required>
            <Input value={(formData.accountNumber as string) ?? ""} onChange={(e) => setField("accountNumber", e.target.value)} placeholder="68200000390004" />
          </Field>
          <Field label="IBAN">
            <Input value={(formData.iban as string) ?? ""} onChange={(e) => setField("iban", e.target.value)} placeholder="SA2405000068200000390004" />
          </Field>
          <Field label="SWIFT">
            <Input value={(formData.swift as string) ?? ""} onChange={(e) => setField("swift", e.target.value)} placeholder="INMASARI" />
          </Field>
          <Field label="Default Account">
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={(formData.isDefault as boolean) ?? false} onCheckedChange={(v) => setField("isDefault", v)} />
              <span className="text-xs text-muted-foreground">Show on invoices by default</span>
            </div>
          </Field>
          <Field label="Active">
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={(formData.isActive as boolean) ?? true} onCheckedChange={(v) => setField("isActive", v)} />
              <span className="text-xs text-muted-foreground">Available for selection</span>
            </div>
          </Field>
        </FormGrid>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.bankName}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
