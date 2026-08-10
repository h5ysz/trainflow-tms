"use client";

// GCCLAB TMS — CompanyTraineePicker
// =====================================================================
// Company-first trainee selection used by dialogs that need to pick a
// trainee (Register Trainee, Replace Trainee, ...).
//
//   Field 1 — Company:  options come from GET /api/trainees/companies
//                       (region-scoped for coordinators).
//   Field 2 — Trainee:  options come from GET /api/trainees?companyId=X,
//                       loaded whenever the selected company changes.
//
// `excludeTraineeId` hides a trainee from the list (e.g. the currently
// enrolled trainee when replacing). Controlled component — the caller
// owns the selected trainee id via `value` / `onChange`.

import * as React from "react";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { Field } from "@/components/common/form-dialog";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";

interface CompanyOption {
  id: string;
  name: string;
  refNumber: string;
  region: string | null;
  traineeCount: number;
}

interface TraineeOption {
  id: string;
  fullName: string;
  refNumber: string;
  nationalId: string;
}

export interface CompanyTraineePickerProps {
  /** Currently selected trainee id. */
  value: string;
  onChange: (traineeId: string) => void;
  /** Trainee to hide from the list (e.g. the trainee being replaced). */
  excludeTraineeId?: string;
  companyLabel?: string;
  traineeLabel?: string;
  required?: boolean;
}

export function CompanyTraineePicker({
  value,
  onChange,
  excludeTraineeId,
  companyLabel,
  traineeLabel,
  required = true,
}: CompanyTraineePickerProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [companies, setCompanies] = React.useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = React.useState(false);
  const [companyId, setCompanyId] = React.useState("");
  const [companyTrainees, setCompanyTrainees] = React.useState<TraineeOption[]>([]);
  const [traineesLoading, setTraineesLoading] = React.useState(false);

  // Load the company list once on mount.
  const loadCompanies = React.useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const res = await api.getList<CompanyOption>("/trainees/companies", { pageSize: 200 });
      setCompanies(res.rows);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setCompaniesLoading(false);
    }
  }, [t, toast]);

  React.useEffect(() => {
    if (companies.length === 0) void loadCompanies();
  }, [loadCompanies]);

  // Load trainees under the selected company.
  const loadTraineesForCompany = React.useCallback(async (companyIdValue: string) => {
    if (!companyIdValue) {
      setCompanyTrainees([]);
      return;
    }
    setTraineesLoading(true);
    try {
      const res = await api.getList<TraineeOption>("/trainees", {
        companyId: companyIdValue,
        pageSize: 200,
      });
      setCompanyTrainees(res.rows);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
      setCompanyTrainees([]);
    } finally {
      setTraineesLoading(false);
    }
  }, [t, toast]);

  // When the company changes, reset the selected trainee and reload.
  React.useEffect(() => {
    if (!companyId) return;
    onChange("");
    void loadTraineesForCompany(companyId);
  }, [companyId, onChange, loadTraineesForCompany]);

  const companyOptions = React.useMemo<SearchableSelectOption[]>(
    () => companies.map((c) => ({
      value: c.id,
      label: c.name,
      description: c.refNumber ? `${c.refNumber} · ${c.traineeCount}` : undefined,
    })),
    [companies]
  );

  const traineeOptions = React.useMemo<SearchableSelectOption[]>(
    () => companyTrainees
      .filter((tr) => tr.id !== excludeTraineeId)
      .map((tr) => ({
        value: tr.id,
        label: tr.fullName,
        description: tr.refNumber ? `${tr.refNumber}${tr.nationalId ? " · " + tr.nationalId : ""}` : tr.nationalId,
      })),
    [companyTrainees, excludeTraineeId]
  );

  return (
    <div className="space-y-4">
      <Field label={companyLabel ?? t("session.enroll.selectCompany")} required={required}>
        <SearchableSelect
          value={companyId}
          onChange={setCompanyId}
          options={companyOptions}
          loading={companiesLoading}
          placeholder="—"
        />
      </Field>

      <Field label={traineeLabel ?? t("session.enroll.selectTrainee")} required={required}>
        <SearchableSelect
          value={companyId ? value : ""}
          onChange={onChange}
          options={companyId ? traineeOptions : []}
          loading={traineesLoading}
          placeholder="—"
          disabled={!companyId}
          emptyText={t("session.enroll.noTrainees")}
        />
      </Field>
    </div>
  );
}
