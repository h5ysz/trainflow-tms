"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarDays, MapPin, CheckCircle2, CircleAlert, Loader2, UserCheck, Clock,
} from "lucide-react";
import { api, ApiError } from "@/lib/api/client";

interface SessionInfo {
  sessionTitle: string;
  courseTitle: string | null;
  startDate: string;
  endDate: string;
  city: string | null;
  venue: string | null;
  windowState: "OPEN" | "NOT_YET" | "CLOSED";
  qrActiveFrom: string;
  qrActiveTo: string;
  spotsRemaining: number;
}

interface CheckInSuccess {
  checkInAt: string;
  status: string;
  preTestAssigned: boolean;
  session: { refNumber: string; title: string; courseTitle: string | null };
}

// Declared at module scope. Defining it inside CheckInForm made React treat it as a
// new component type on every render, remounting the form and dropping input focus.
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center text-center gap-2">
          { }
          <img src="/gcclab-logo-official.png" alt="GCC Lab" className="h-14 w-auto" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export function CheckInForm() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [info, setInfo] = useState<SessionInfo | null>(null);
  // With no token there is nothing to fetch, so the page is never in a loading state.
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(null);
  const missingToken = !token;

  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [alreadyIn, setAlreadyIn] = useState(false);
  const [success, setSuccess] = useState<CheckInSuccess | null>(null);

  useEffect(() => {
    // A missing token needs no request; it is a derived state, not an effect result.
    if (!token) return;
    let cancelled = false;
    api.get<SessionInfo>("/public/check-in", { token })
      .then((res) => { if (!cancelled) setInfo(res); })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale === "ar" ? "ar-SA" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setSubmitError(t("checkin.nameRequired"));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setAlreadyIn(false);
    try {
      const res = await api.post<CheckInSuccess>("/public/check-in", {
        qrCodeToken: token,
        traineeName: fullName.trim(),
        traineeIdNational: nationalId.trim() || undefined,
        traineeEmail: email.trim() || undefined,
        traineePhone: phone.trim() || undefined,
      });
      setSuccess(res);
    } catch (err) {
      // Being checked in already is a fine outcome — say so, don't shout.
      if (err instanceof ApiError && err.code === "DUPLICATE_CHECK_IN") {
        setAlreadyIn(true);
      } else {
        setSubmitError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell title={t("checkin.title")}>
        <Card className="p-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Card>
      </Shell>
    );
  }

  if (missingToken || loadError || !info) {
    return (
      <Shell title={t("checkin.title")}>
        <Card className="p-6 text-center space-y-3 border-2 border-destructive/40 bg-destructive/5">
          <CircleAlert className="h-10 w-10 mx-auto text-destructive" />
          <p className="text-sm font-medium">{t("checkin.invalidLink")}</p>
          <p className="text-xs text-muted-foreground">{missingToken ? t("checkin.missingToken") : loadError}</p>
        </Card>
      </Shell>
    );
  }

  if (success || alreadyIn) {
    return (
      <Shell title={t("checkin.title")}>
        <Card className="p-6 text-center space-y-3 border-2 border-success/40 bg-success/5">
          <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
          <p className="text-base font-semibold">
            {alreadyIn ? t("checkin.alreadyCheckedIn") : t("checkin.success")}
          </p>
          <p className="text-sm text-muted-foreground">{info.sessionTitle}</p>
          {success?.preTestAssigned && (
            // No link: the exam UI lives inside the authenticated app, which this
            // trainee has no account for.
            <p className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
              {t("checkin.preTestAssigned")}
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  const closed = info.windowState !== "OPEN";

  return (
    <Shell title={t("checkin.title")}>
      <Card className="p-5 space-y-3">
        <div>
          <div className="text-base font-semibold">{info.sessionTitle}</div>
          {info.courseTitle && <div className="text-sm text-muted-foreground">{info.courseTitle}</div>}
        </div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {fmt(info.startDate)}
          </div>
          {(info.venue || info.city) && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {[info.venue, info.city].filter(Boolean).join(", ")}
            </div>
          )}
        </div>
      </Card>

      {closed ? (
        <Card className="p-6 text-center space-y-3 border-2 border-warning/40 bg-warning/5">
          <Clock className="h-10 w-10 mx-auto text-warning" />
          <p className="text-sm font-medium">
            {info.windowState === "NOT_YET" ? t("checkin.notYetOpen") : t("checkin.closed")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("checkin.window", { from: fmt(info.qrActiveFrom), to: fmt(info.qrActiveTo) })}
          </p>
        </Card>
      ) : (
        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">{t("checkin.fullName")} *</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nationalId">{t("checkin.nationalId")}</Label>
              <Input
                id="nationalId"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                inputMode="numeric"
              />
              <p className="text-[11px] text-muted-foreground">{t("checkin.nationalIdHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("checkin.email")}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("checkin.phone")}</Label>
              <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                <CircleAlert className="h-4 w-4 shrink-0" />
                {submitError}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <UserCheck className="h-4 w-4 me-1.5" />}
              {t("checkin.submit")}
            </Button>

            {info.spotsRemaining <= 5 && (
              <p className="text-center text-[11px] text-muted-foreground">
                {t("checkin.spotsRemaining", { count: info.spotsRemaining })}
              </p>
            )}
          </form>
        </Card>
      )}
    </Shell>
  );
}
