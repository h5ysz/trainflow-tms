"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import {
  Wallet, FileText, CheckCircle2, AlertTriangle, TrendingUp,
  Receipt, Banknote, Clock, ArrowRight,
} from "lucide-react";

interface FinancialStats {
  totalOutstanding: number;
  totalPaid: number;
  totalOverdue: number;
  monthlyRevenue: number;
  vatCollected: number;
  totalInvoices: number;
  paidInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
  draftInvoices: number;
}

export function FinancialDashboardRoute() {
  const { t } = useI18n();
  const { navigate } = useAppStore();
  const [stats, setStats] = useState<FinancialStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load stats from invoices list
    api.getList<{ status: string; grandTotal: number; paidAmount: number; outstandingBalance: number; issueDate: string; vatAmount: number }>("/invoices", { pageSize: 200 })
      .then((res) => {
        const rows = res.rows;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const s: FinancialStats = {
          totalOutstanding: rows.filter(r => !["DRAFT", "CANCELLED"].includes(r.status)).reduce((sum, r) => sum + (r.outstandingBalance || 0), 0),
          totalPaid: rows.reduce((sum, r) => sum + (r.paidAmount || 0), 0),
          totalOverdue: rows.filter(r => r.status === "OVERDUE").reduce((sum, r) => sum + (r.outstandingBalance || 0), 0),
          monthlyRevenue: rows.filter(r => new Date(r.issueDate) >= monthStart).reduce((sum, r) => sum + (r.paidAmount || 0), 0),
          vatCollected: rows.reduce((sum, r) => sum + (r.vatAmount || 0), 0),
          totalInvoices: rows.length,
          paidInvoices: rows.filter(r => r.status === "PAID").length,
          pendingInvoices: rows.filter(r => ["PENDING_PAYMENT", "PARTIALLY_PAID"].includes(r.status)).length,
          overdueInvoices: rows.filter(r => r.status === "OVERDUE").length,
          draftInvoices: rows.filter(r => r.status === "DRAFT").length,
        };
        setStats(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-muted-foreground">Loading financial dashboard...</div>
      </div>
    );
  }

  const kpis = [
    { label: "Outstanding Balance", value: stats?.totalOutstanding ?? 0, icon: Wallet, color: "text-warning", bg: "bg-warning/10" },
    { label: "Total Collected", value: stats?.totalPaid ?? 0, icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
    { label: "Overdue", value: stats?.totalOverdue ?? 0, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
    { label: "Monthly Revenue", value: stats?.monthlyRevenue ?? 0, icon: TrendingUp, color: "text-primary", bg: "bg-primary/10" },
    { label: "VAT Collected", value: stats?.vatCollected ?? 0, icon: Receipt, color: "text-info", bg: "bg-info/10" },
    { label: "Total Invoices", value: stats?.totalInvoices ?? 0, icon: FileText, color: "text-muted-foreground", bg: "bg-muted", isCount: true },
  ];

  const quickActions = [
    { label: "Invoices", icon: FileText, route: "invoices" as const },
    { label: "Payments", icon: Banknote, route: "payments" as const },
    { label: "Bank Accounts", icon: Wallet, route: "bank-accounts" as const },
    { label: "Financial Settings", icon: Receipt, route: "financial-settings" as const },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Financial Dashboard" subtitle="Overview of invoices, payments, and revenue" icon={Wallet} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${kpi.bg} ${kpi.color} mb-2`}>
              <kpi.icon className="h-5 w-5" />
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {kpi.isCount ? kpi.value : `${(kpi.value / 1000).toFixed(1)}K`}
            </div>
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
          </Card>
        ))}
      </div>

      {/* Invoice Status Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Invoice Status</h3>
          <div className="space-y-3">
            {[
              { label: "Draft", count: stats?.draftInvoices ?? 0, color: "bg-muted" },
              { label: "Pending Payment", count: stats?.pendingInvoices ?? 0, color: "bg-warning" },
              { label: "Paid", count: stats?.paidInvoices ?? 0, color: "bg-success" },
              { label: "Overdue", count: stats?.overdueInvoices ?? 0, color: "bg-destructive" },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${item.color}`} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{item.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action) => (
              <Button
                key={action.route}
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                onClick={() => navigate(action.route)}
              >
                <action.icon className="h-5 w-5" />
                <span className="text-xs">{action.label}</span>
              </Button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
