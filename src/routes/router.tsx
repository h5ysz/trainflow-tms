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
import { TrainingRequestsRoute } from "./training-requests";
import { TrainingSessionsRoute } from "./training-sessions";
import { SchedulingRoute } from "./scheduling";
import { AttendanceRoute } from "./attendance";
import { QrCodeRoute } from "./qr-code";
import { PreTestRoute } from "./pre-test";
import { FinalTestRoute } from "./final-test";
import { CourseEvaluationRoute } from "./course-evaluation";
import { CertificatesRoute } from "./certificates";
import { ReportsRoute } from "./reports";
import { NotificationsRoute } from "./notifications";
import { AuditLogRoute } from "./audit-log";
import { SettingsRoute } from "./settings-page";
import type { RouteKey } from "@/lib/auth/permissions";

const ROUTES: Record<RouteKey, () => JSX.Element> = {
  dashboard: DashboardRoute,
  companies: CompaniesRoute,
  "company-contacts": CompanyContactsRoute,
  trainers: TrainersRoute,
  "trainer-qualifications": TrainerQualificationsRoute,
  trainees: TraineesRoute,
  courses: CoursesRoute,
  requests: TrainingRequestsRoute,
  sessions: TrainingSessionsRoute,
  scheduling: SchedulingRoute,
  attendance: AttendanceRoute,
  "qr-code": QrCodeRoute,
  "pre-test": PreTestRoute,
  "final-test": FinalTestRoute,
  evaluation: CourseEvaluationRoute,
  certificates: CertificatesRoute,
  reports: ReportsRoute,
  notifications: NotificationsRoute,
  "audit-log": AuditLogRoute,
  settings: SettingsRoute,
};

export function RouteRouter() {
  const { currentRoute, user } = useAppStore();
  const { t } = useI18n();

  if (!user) return null;

  // Permission check
  if (!canAccessModule(user.role, currentRoute)) {
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
  return <Component />;
}
