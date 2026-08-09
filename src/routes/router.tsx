"use client";

import { useAppStore } from "@/lib/store/app-store";
import { useI18n } from "@/lib/i18n/context";
import { canAccessModule } from "@/lib/auth/permissions";
import { Lock } from "lucide-react";

import { DashboardRoute } from "./dashboard";
import { CompaniesRoute } from "./companies";
import { CompanyContactsRoute } from "./company-contacts";
import { TrainersRoute } from "./trainers";
import { TrainerQualificationsRoute } from "./trainer-qualifications";
import { TraineesRoute } from "./trainees";
import { CoursesRoute } from "./courses";
import { WorkshopsRoute } from "./workshops";
import { TrainingRequestsRoute } from "./training-requests";
import { TrainingSessionsRoute } from "./training-sessions";
import { SessionDetailRoute } from "./session-detail";
import { SchedulingRoute } from "./scheduling";
import { AttendanceRoute } from "./attendance";
import { QrCodeRoute } from "./qr-code";
import { PreTestRoute } from "./pre-test";
import { FinalTestRoute } from "./final-test";
import { ExamAttemptRoute } from "./exam-attempt";
import { CourseEvaluationRoute } from "./course-evaluation";
import { CertificatesRoute } from "./certificates";
import { ReportsRoute } from "./reports";
import { ReportSchedulesRoute } from "./report-schedules";
import { NotificationsRoute } from "./notifications";
import { AuditLogRoute } from "./audit-log";
import { SettingsRoute } from "./settings-page";
import { UserApprovalsRoute } from "./user-approvals";
import { UserManagementRoute } from "./user-management";
import { RolesRoute } from "./roles";
import { WorkerPassportsRoute } from "./worker-passports";
import { ComplianceMatrixRoute } from "./compliance-matrix";
import { ExecutiveDashboardRoute } from "./executive-dashboard";
import { RenewalDashboardRoute } from "./renewal-dashboard";
import type { RouteKey } from "@/lib/auth/permissions";

import { FinancialDashboardRoute } from "./financial-dashboard";
import { InvoicesRoute } from "./invoices";
import { PaymentsRoute } from "./payments";
import { BankAccountsRoute } from "./bank-accounts";
import { FinancialSettingsRoute } from "./financial-settings";
import { FinancialReportsRoute } from "./financial-reports";
import { TraineeDetailRoute } from "./trainee-detail";
import { AiDashboardRoute } from "./ai-dashboard";

const ROUTES: Record<RouteKey, React.ComponentType> = {
  dashboard: DashboardRoute,
  companies: CompaniesRoute,
  "company-contacts": CompanyContactsRoute,
  trainers: TrainersRoute,
  "trainer-qualifications": TrainerQualificationsRoute,
  trainees: TraineesRoute,
  courses: CoursesRoute,
  workshops: WorkshopsRoute,
  requests: TrainingRequestsRoute,
  sessions: TrainingSessionsRoute,
  // Reached from the sessions list; intentionally absent from navItems.
  "session-detail": SessionDetailRoute,
  scheduling: SchedulingRoute,
  attendance: AttendanceRoute,
  "qr-code": QrCodeRoute,
  "pre-test": PreTestRoute,
  "final-test": FinalTestRoute,
  // Reached from the pre-test / final-test pages; intentionally absent from navItems.
  "exam-attempts": ExamAttemptRoute,
  evaluation: CourseEvaluationRoute,
  certificates: CertificatesRoute,
  reports: ReportsRoute,
  "report-schedules": ReportSchedulesRoute,
  notifications: NotificationsRoute,
  "audit-log": AuditLogRoute,
  "user-approvals": UserApprovalsRoute,
  "user-management": UserManagementRoute,
  roles: RolesRoute,
  "worker-passports": WorkerPassportsRoute,
  "compliance-matrix": ComplianceMatrixRoute,
  "executive-dashboard": ExecutiveDashboardRoute,
  "renewal-dashboard": RenewalDashboardRoute,
  "trainee-detail": TraineeDetailRoute,
  "ai-dashboard": AiDashboardRoute,
  "finance": FinancialDashboardRoute,
  "invoices": InvoicesRoute,
  "quotations": () => <div className="p-8"><h2 className="text-lg font-semibold">Quotations</h2><p className="text-sm text-muted-foreground">Create and manage price quotations for contractors.</p></div>,
  "payments": PaymentsRoute,
  "receipts": () => <div className="p-8"><h2 className="text-lg font-semibold">Receipts</h2><p className="text-sm text-muted-foreground">Receipts are auto-generated when payments are approved.</p></div>,
  "financial-reports": FinancialReportsRoute,
  "bank-accounts": BankAccountsRoute,
  "financial-settings": FinancialSettingsRoute,
  settings: SettingsRoute,
};

export function RouteRouter() {
  const { currentRoute, user } = useAppStore();
  const { t } = useI18n();

  if (!user) return null;

  // Permission check
  if (!canAccessModule(user.permissions, currentRoute)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
          <Lock className="h-6 w-6" />
        </div>
        <p className="text-sm text-muted-foreground max-w-sm">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const Component = ROUTES[currentRoute];
  if (!Component) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Route &quot;{currentRoute}&quot; is not registered.
        </p>
      </div>
    );
  }
  return <Component />;
}
