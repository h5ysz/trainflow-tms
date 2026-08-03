"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save, Landmark } from "lucide-react";

interface FinSettings {
  id: string;
  companyName: string;
  crNumber: string | null;
  vatNumber: string | null;
  financeEmail: string | null;
  companyLogoUrl: string | null;
  address: string | null;
  phone: string | null;
  currency: string;
  vatRate: number;
  defaultDueDays: number;
  invoiceSeq: number;
  quotationSeq: number;
  receiptSeq: number;
}

export function FinancialSettingsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [settings, setSettings] = useState<FinSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<FinSettings>("/financial-settings")
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api.put<FinSettings>("/financial-settings", settings);
      setSettings(updated);
      toast({ title: t("misc.success"), description: "Financial settings saved" });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!settings) return <div className="p-8 text-destructive">Failed to load settings</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial Settings"
        subtitle="Company information, VAT, currency, and invoice sequences"
        icon={Settings}
        actions={<Button onClick={() => void handleSave()} disabled={saving}><Save className="h-4 w-4 me-1.5" />{saving ? "Saving..." : "Save"}</Button>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Company Information */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" />Company Information</h3>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Company Name</label>
              <Input value={settings.companyName} onChange={(e) => setSettings({ ...settings, companyName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">CR Number</label>
                <Input value={settings.crNumber ?? ""} onChange={(e) => setSettings({ ...settings, crNumber: e.target.value })} placeholder="2050108058" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">VAT Number</label>
                <Input value={settings.vatNumber ?? ""} onChange={(e) => setSettings({ ...settings, vatNumber: e.target.value })} placeholder="310085176310003" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Finance Email</label>
              <Input type="email" value={settings.financeEmail ?? ""} onChange={(e) => setSettings({ ...settings, financeEmail: e.target.value })} placeholder="training@gccelab.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Address</label>
              <Input value={settings.address ?? ""} onChange={(e) => setSettings({ ...settings, address: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Phone</label>
              <Input value={settings.phone ?? ""} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Company Logo URL</label>
              <Input value={settings.companyLogoUrl ?? ""} onChange={(e) => setSettings({ ...settings, companyLogoUrl: e.target.value })} placeholder="/logo.svg" />
            </div>
          </div>
        </Card>

        {/* Tax & Currency */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Settings className="h-4 w-4 text-primary" />Tax & Currency</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Currency</label>
                <Input value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} placeholder="SAR" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">VAT Rate (%)</label>
                <Input type="number" step="0.01" value={settings.vatRate} onChange={(e) => setSettings({ ...settings, vatRate: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Default Due Days</label>
              <Input type="number" value={settings.defaultDueDays} onChange={(e) => setSettings({ ...settings, defaultDueDays: parseInt(e.target.value) || 30 })} />
            </div>
          </div>

          {/* Invoice Sequences */}
          <h3 className="text-sm font-semibold pt-2 border-t">Invoice Sequences</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Invoice #</label>
              <Input type="number" value={settings.invoiceSeq} onChange={(e) => setSettings({ ...settings, invoiceSeq: parseInt(e.target.value) || 1 })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Quotation #</label>
              <Input type="number" value={settings.quotationSeq} onChange={(e) => setSettings({ ...settings, quotationSeq: parseInt(e.target.value) || 1 })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Receipt #</label>
              <Input type="number" value={settings.receiptSeq} onChange={(e) => setSettings({ ...settings, receiptSeq: parseInt(e.target.value) || 1 })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">These sequences control the next reference number. Modify with caution — gaps cannot be filled.</p>
        </Card>
      </div>
    </div>
  );
}
