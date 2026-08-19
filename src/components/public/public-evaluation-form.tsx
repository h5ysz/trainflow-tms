"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Star, Loader2, CircleAlert, CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface SessionInfo {
  sessionTitle: string;
  courseTitle: string | null;
  courseCode: string | null;
  trainerName: string | null;
  sessionId: string;
}

function StarRating({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="p-0.5"
          >
            <Star
              className={`h-6 w-6 ${n <= value ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center text-center gap-2">
          <img src="/gcclab-logo-official.png" alt="GCC Lab" className="h-14 w-auto" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export function PublicEvaluationForm() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(null);
  const missingToken = !token;

  // Identity
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");

  // Ratings
  const [trainerRating, setTrainerRating] = useState(0);
  const [contentRating, setContentRating] = useState(0);
  const [venueRating, setVenueRating] = useState(0);
  const [materialsRating, setMaterialsRating] = useState(0);
  const [overallRating, setOverallRating] = useState(0);

  // Text
  const [comments, setComments] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get<SessionInfo>("/public/evaluation", { token })
      .then((res) => { if (!cancelled) setInfo(res); })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setSubmitError(t("publicEval.nameRequired"));
      return;
    }
    if (!trainerRating || !contentRating || !venueRating || !materialsRating || !overallRating) {
      setSubmitError(t("publicEval.ratingsRequired"));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post("/public/evaluation", {
        token,
        traineeName: fullName.trim(),
        traineeIdNational: nationalId.trim() || undefined,
        trainerRating,
        contentRating,
        venueRating,
        materialsRating,
        overallRating,
        comments: comments.trim() || undefined,
        suggestions: suggestions.trim() || undefined,
        wouldRecommend,
      });
      setSuccess(true);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell title={t("publicEval.title")}>
        <Card className="p-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </Card>
      </Shell>
    );
  }

  if (missingToken || loadError || !info) {
    return (
      <Shell title={t("publicEval.title")}>
        <Card className="p-6 text-center space-y-3 border-2 border-destructive/40 bg-destructive/5">
          <CircleAlert className="h-10 w-10 mx-auto text-destructive" />
          <p className="text-sm font-medium">{t("publicEval.invalidLink")}</p>
          <p className="text-xs text-muted-foreground">{missingToken ? t("publicEval.missingToken") : loadError}</p>
        </Card>
      </Shell>
    );
  }

  if (success) {
    return (
      <Shell title={t("publicEval.title")}>
        <Card className="p-6 text-center space-y-3 border-2 border-success/40 bg-success/5">
          <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
          <p className="text-base font-semibold">Thank you for your feedback!</p>
          <p className="text-sm text-muted-foreground">Your evaluation has been submitted successfully.</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title={t("publicEval.title")}>
      <Card className="p-5 space-y-3">
        <div>
          <div className="text-base font-semibold">{info.sessionTitle}</div>
          {info.courseTitle && <div className="text-sm text-muted-foreground">{info.courseTitle}</div>}
          {info.trainerName && <div className="text-xs text-muted-foreground mt-1">{t("publicEval.trainerLabel", { name: info.trainerName })}</div>}
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="p-5 space-y-4">
          <p className="text-sm font-medium">{t("publicEval.yourInfo")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name *</Label>
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
            <Label htmlFor="nationalId">National ID / Iqama</Label>
            <Input
              id="nationalId"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <p className="text-sm font-medium">{t("publicEval.ratings")}</p>
          <StarRating value={trainerRating} onChange={setTrainerRating} label={t("publicEval.trainer")} />
          <StarRating value={contentRating} onChange={setContentRating} label={t("publicEval.content")} />
          <StarRating value={venueRating} onChange={setVenueRating} label={t("publicEval.venue")} />
          <StarRating value={materialsRating} onChange={setMaterialsRating} label={t("publicEval.materials")} />
          <StarRating value={overallRating} onChange={setOverallRating} label={t("publicEval.overall")} />
        </Card>

        <Card className="p-5 space-y-4">
          <p className="text-sm font-medium">{t("publicEval.commentsTitle")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="comments">What did you like most?</Label>
            <Textarea
              id="comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suggestions">Suggestions for improvement</Label>
            <Textarea
              id="suggestions"
              value={suggestions}
              onChange={(e) => setSuggestions(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("publicEval.recommend")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={wouldRecommend === true ? "default" : "outline"}
                size="sm"
                onClick={() => setWouldRecommend(true)}
              >
                {t("publicEval.yes")}
              </Button>
              <Button
                type="button"
                variant={wouldRecommend === false ? "default" : "outline"}
                size="sm"
                onClick={() => setWouldRecommend(false)}
              >
                {t("publicEval.no")}
              </Button>
            </div>
          </div>
        </Card>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
            <CircleAlert className="h-4 w-4 shrink-0" />
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : null}
          {t("publicEval.submit")}
        </Button>
      </form>
    </Shell>
  );
}
