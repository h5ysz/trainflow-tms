"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, Building2, Check, X } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface Payment {
  id: string;
  refNumber: string;
  invoiceId: string | null;
  invoiceRef?: string | null;
  companyId: string;
  companyName?: string | null;
  amount: number;
  vatAmount: number;
  currency: string;
  method: string;
  status: string;
  paymentDate: string;
  referenceNumber: string | null;
  paidBy: string | null;
}

const PAYMENT_METHODS: Record<string, string> = {
  BANK_TRANSFER: "Bank Transfer", SADAD: "SADAD", MADA: "Mada",
  VISA: "Visa", MASTERCARD: "Mastercard", APPLE_PAY: "Apple Pay",
  CASH: "Cash", CHEQUE: "Cheque", MANUAL: "Manual",
};

export function PaymentsRoute() {
  const { t } = useI18n();
  const { user } = useAppStore();
  const { toast } = useToast();
  const [approving, setApproving] = useState<string | null>(null);

  const canEdit = user ? canPerformAction(user.permissions, "payments", "edit") : false;

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Payment>("/payments");

  const fmtMoney = (v: number, cur = "SAR") => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  const handleApprove = async (id: string) => {
    setApproving(id);
    try {
      await api.post(`/payments/${id}/approve`, { action: "approve" });
      toast({ title: t("misc.success"), description: "Payment approved. Receipt generated." });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (id: string) => {
    setApproving(id);
    try {
      await api.post(`/payments/${id}/approve`, { action: "reject" });
      toast({ title: t("misc.success"), description: "Payment rejected." });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  const columns: Column<Payment>[] = [
    { key: "ref", header: "Payment #", cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.refNumber}</div> },
    { key: "company", header: "Contractor", cell: (r) => <div className="text-sm flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.companyName || "—"}</div> },
    { key: "amount", header: "Amount", cell: (r) => <div className="text-sm font-semibold tabular-nums">{fmtMoney(r.amount, r.currency)}</div> },
    { key: "method", header: "Method", cell: (r) => <Badge variant="outline">{PAYMENT_METHODS[r.method] || r.method}</Badge> },
    { key: "date", header: "Payment Date", cell: (r) => <div className="text-xs text-muted-foreground">{new Date(r.paymentDate).toLocaleDateString()}</div> },
    { key: "ref2", header: "Reference", cell: (r) => <div className="font-mono text-xs">{r.referenceNumber || "—"}</div> },
    { key: "paidBy", header: "Paid By", cell: (r) => <div className="text-xs">{r.paidBy || "—"}</div> },
    {
      key: "status", header: "Status",
      cell: (r) => <Badge className={r.status === "PAID" ? "bg-success/15 text-success" : r.status === "PENDING" ? "bg-warning/15 text-warning" : r.status === "FAILED" || r.status === "CANCELLED" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}>{r.status}</Badge>,
    },
    {
      key: "actions", header: "Actions", headerClassName: "text-end", className: "text-end",
      cell: (r) => canEdit && r.status === "PENDING" ? (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-8 text-success" disabled={approving === r.id} onClick={() => void handleApprove(r.id)}>
            <Check className="h-3.5 w-3.5 me-1" /> Approve
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-destructive" disabled={approving === r.id} onClick={() => void handleReject(r.id)}>
            <X className="h-3.5 w-3.5 me-1" /> Reject
          </Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        subtitle="Track all payments and approve contractor submissions"
        icon={CreditCard}
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
        emptyIcon={CreditCard}
        emptyTitle="No payments recorded"
        emptySubtitle="Register a payment from the Invoices page or wait for contractor submissions"
      />
    </div>
  );
}
