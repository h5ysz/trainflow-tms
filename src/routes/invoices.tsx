"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Download, Eye, Ban, CreditCard, Building2, Send, Printer } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { useToast } from "@/hooks/use-toast";
import { canPerformAction } from "@/lib/auth/permissions";

interface Invoice {
  id: string;
  refNumber: string;
  companyId: string;
  companyName?: string | null;
  requestId?: string | null;
  requestRef?: string | null;
  sessionId?: string | null;
  sessionRef?: string | null;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  grandTotal: number;
  paidAmount: number;
  outstandingBalance: number;
  currency: string;
  vatRate: number;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  bankAccountId?: string | null;
  bankName?: string | null;
  coordinatorNotes?: string | null;
  paymentNotes?: string | null;
  lineItems?: string;
  _count?: { payments: number; receipts: number };
}

interface CompanyOption { id: string; name: string; refNumber: string; }
interface BankOption { id: string; bankName: string; iban: string | null; isActive?: boolean; }
interface RequestOption { id: string; refNumber: string; companyName?: string | null; }

const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PENDING_PAYMENT", "PARTIALLY_PAID", "PAID", "CANCELLED", "REFUNDED", "OVERDUE"];

export function InvoicesRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user, navigate } = useAppStore();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [requests, setRequests] = useState<RequestOption[]>([]);
  const [payDialog, setPayDialog] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("BANK_TRANSFER");
  const [payRef, setPayRef] = useState("");
  const [payBy, setPayBy] = useState("");
  const [paying, setPaying] = useState(false);

  const canCreate = user ? canPerformAction(user.permissions, "invoices", "create") : false;
  const canEdit = user ? canPerformAction(user.permissions, "invoices", "edit") : false;

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Invoice>("/invoices");

  const { dialogOpen, formData, setField, submitting, submit, openCreate, openEdit, closeDialog, deleteTarget, setDeleteTarget, deleting, confirmDelete } =
    useEntityActions<Invoice>({ resource: "/invoices", module: "invoices", refetch, toForm: (r) => ({ ...r }) });

  useEffect(() => {
    if (dialogOpen) {
      if (companies.length === 0) api.getList<CompanyOption>("/companies", { pageSize: 100 }).then(r => setCompanies(r.rows.map(c => ({ id: c.id, name: c.name, refNumber: c.refNumber })))).catch(() => {});
      if (banks.length === 0) api.getList<BankOption>("/bank-accounts", { pageSize: 50 }).then(r => setBanks(r.rows.filter((b: BankOption) => b.isActive !== false).map(b => ({ id: b.id, bankName: b.bankName, iban: b.iban })))).catch(() => {});
      if (requests.length === 0) api.getList<RequestOption>("/requests", { pageSize: 50 }).then(r => setRequests(r.rows)).catch(() => {});
    }
  }, [dialogOpen, companies.length, banks.length, requests.length]);

  const fmtMoney = (v: number, cur = "SAR") => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  const columns: Column<Invoice>[] = [
    { key: "ref", header: "Invoice #", cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.refNumber}</div> },
    { key: "company", header: "Contractor", cell: (r) => <div className="text-sm flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.companyName || "—"}</div> },
    { key: "issueDate", header: "Issue Date", cell: (r) => <div className="text-xs text-muted-foreground">{new Date(r.issueDate).toLocaleDateString()}</div> },
    { key: "dueDate", header: "Due Date", cell: (r) => <div className="text-xs text-muted-foreground">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</div> },
    { key: "total", header: "Grand Total", cell: (r) => <div className="text-sm font-semibold tabular-nums">{fmtMoney(r.grandTotal, r.currency)}</div> },
    { key: "paid", header: "Paid", cell: (r) => <div className="text-sm tabular-nums text-success">{r.paidAmount > 0 ? fmtMoney(r.paidAmount, r.currency) : "—"}</div> },
    { key: "outstanding", header: "Outstanding", cell: (r) => <div className={`text-sm tabular-nums ${r.outstandingBalance > 0 ? "text-warning" : "text-muted-foreground"}`}>{r.outstandingBalance > 0 ? fmtMoney(r.outstandingBalance, r.currency) : "—"}</div> },
    { key: "status", header: "Status", cell: (r) => <Badge className={r.status === "PAID" ? "bg-success/15 text-success" : r.status === "OVERDUE" ? "bg-destructive/15 text-destructive" : r.status === "PARTIALLY_PAID" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}>{r.status.replace(/_/g, " ")}</Badge> },
    {
      key: "actions", header: "Actions", headerClassName: "text-end", className: "text-end",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canEdit && r.outstandingBalance > 0 && r.status !== "CANCELLED" && (
            <Button variant="ghost" size="sm" className="h-8 text-success" onClick={() => { setPayDialog(r); setPayAmount(r.outstandingBalance.toString()); }}>
              <CreditCard className="h-3.5 w-3.5 me-1" /> Payment
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8" title="Download PDF" onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}>
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8" title="Print" onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}>
            <Printer className="h-3.5 w-3.5" />
          </Button>
          {canEdit && r.status !== "DRAFT" && (
            <Button variant="ghost" size="icon" className="h-8" title="Send to Contractor"
              onClick={async () => {
                try {
                  await api.post(`/invoices/${r.id}/send`, {});
                  toast({ title: t("misc.success"), description: "Invoice sent to contractor" });
                } catch (e) {
                  toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
                }
              }}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-8" onClick={() => void openEdit(r)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          {canEdit && r.status === "DRAFT" && (
            <Button variant="ghost" size="icon" className="h-8 text-destructive" onClick={() => setDeleteTarget(r)}>
              <Ban className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const handleSubmit = () => {
    // Build line items from form data
    const lineItems = formData.lineItems ? (typeof formData.lineItems === "string" ? formData.lineItems : JSON.stringify(formData.lineItems)) : JSON.stringify([{ description: "Training Services", quantity: 1, unitPrice: parseFloat(formData.subtotal as string) || 0, lineTotal: parseFloat(formData.subtotal as string) || 0 }]);
    void submit();
  };

  const handlePayment = async () => {
    if (!payDialog || !payAmount) return;
    setPaying(true);
    try {
      await api.post("/payments", {
        invoiceId: payDialog.id,
        companyId: payDialog.companyId,
        amount: parseFloat(payAmount),
        method: payMethod,
        referenceNumber: payRef || undefined,
        paidBy: payBy || undefined,
        status: "PAID",
      });
      toast({ title: t("misc.success"), description: "Payment registered successfully. Receipt auto-generated." });
      setPayDialog(null);
      setPayAmount("");
      setPayRef("");
      setPayBy("");
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        subtitle="Manage invoices, track payments, and generate receipts"
        icon={FileText}
        actions={canCreate ? <Button onClick={() => openCreate({ status: "DRAFT", currency: "SAR", vatRate: 15, subtotal: 0, discountAmount: 0, lineItems: [{ description: "Training Services", quantity: 1, unitPrice: 0, lineTotal: 0 }] })}><Plus className="h-4 w-4 me-1.5" />New Invoice</Button> : undefined}
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
        emptyIcon={FileText}
        emptyTitle="No invoices yet"
        emptySubtitle="Create your first invoice to start billing contractors"
      />

      {/* Create/Edit Invoice Dialog */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={formData.id ? "Edit Invoice" : "New Invoice"}
        icon={FileText}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label="Contractor" required>
              <Select value={(formData.companyId as string) ?? ""} onValueChange={(v) => setField("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Request (optional)">
              <Select value={(formData.requestId as string) ?? "__none__"} onValueChange={(v) => setField("requestId", v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No request linked</SelectItem>
                  {requests.map((r) => <SelectItem key={r.id} value={r.id}>{r.refNumber} — {r.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Subtotal (excl. VAT)" required>
              <Input type="number" step="0.01" value={(formData.subtotal as string) ?? ""} onChange={(e) => setField("subtotal", e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Discount Amount">
              <Input type="number" step="0.01" value={(formData.discountAmount as string) ?? "0"} onChange={(e) => setField("discountAmount", e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="VAT Rate (%)">
              <Input type="number" step="0.01" value={(formData.vatRate as string) ?? "15"} onChange={(e) => setField("vatRate", e.target.value)} />
            </Field>
            <Field label="Due Date">
              <Input type="date" value={(formData.dueDate as string) ?? ""} onChange={(e) => setField("dueDate", e.target.value)} />
            </Field>
            <Field label="Bank Account">
              <Select value={(formData.bankAccountId as string) ?? "__none__"} onValueChange={(v) => setField("bankAccountId", v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No bank selected</SelectItem>
                  {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.bankName} — {b.iban}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={(formData.status as string) ?? "DRAFT"} onValueChange={(v) => setField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVOICE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>

          {/* Auto-calculated totals preview */}
          {(() => {
            const sub = parseFloat(formData.subtotal as string) || 0;
            const disc = parseFloat(formData.discountAmount as string) || 0;
            const vat = parseFloat(formData.vatRate as string) || 0;
            const afterDisc = sub - disc;
            const vatAmt = afterDisc * (vat / 100);
            const grand = afterDisc + vatAmt;
            return (
              <div className="rounded-md border p-3 bg-muted/30 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span className="font-medium tabular-nums">{sub.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount:</span><span className="font-medium tabular-nums text-destructive">-{disc.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">VAT ({vat}%):</span><span className="font-medium tabular-nums">{vatAmt.toFixed(2)}</span></div>
                <div className="flex justify-between border-t pt-1"><span className="font-semibold">Grand Total:</span><span className="font-bold tabular-nums">{grand.toFixed(2)}</span></div>
              </div>
            );
          })()}

          <Field label="Coordinator Notes">
            <Textarea rows={2} value={(formData.coordinatorNotes as string) ?? ""} onChange={(e) => setField("coordinatorNotes", e.target.value)} />
          </Field>
        </div>
      </FormDialog>

      {/* Payment Dialog */}
      <FormDialog
        open={payDialog !== null}
        onOpenChange={(o) => !o && setPayDialog(null)}
        title={`Register Payment — ${payDialog?.refNumber ?? ""}`}
        icon={CreditCard}
        size="sm"
        onSubmit={() => void handlePayment()}
        isSubmitting={paying}
      >
        <div className="space-y-4">
          <div className="rounded-md border p-3 bg-muted/30 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Grand Total:</span><span className="font-medium">{payDialog ? fmtMoney(payDialog.grandTotal, payDialog.currency) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Already Paid:</span><span className="font-medium text-success">{payDialog ? fmtMoney(payDialog.paidAmount, payDialog.currency) : "—"}</span></div>
            <div className="flex justify-between border-t pt-1"><span className="font-semibold">Outstanding:</span><span className="font-bold text-warning">{payDialog ? fmtMoney(payDialog.outstandingBalance, payDialog.currency) : "—"}</span></div>
          </div>
          <FormGrid>
            <Field label="Payment Amount" required>
              <Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </Field>
            <Field label="Payment Method" required>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["BANK_TRANSFER", "SADAD", "MADA", "VISA", "MASTERCARD", "APPLE_PAY", "CASH", "CHEQUE", "MANUAL"].map(m => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reference Number">
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Cheque #, Transaction ID..." />
            </Field>
            <Field label="Paid By">
              <Input value={payBy} onChange={(e) => setPayBy(e.target.value)} placeholder="Payer name" />
            </Field>
          </FormGrid>
          <p className="text-xs text-muted-foreground">A receipt will be automatically generated when the payment is registered.</p>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.refNumber}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
