"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import Image from "next/image";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";
import { PublicShell } from "@/components/public/public-shell";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";
  const { locale } = useI18n();
  const isAr = locale !== "en";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    if (!newPassword || !confirmPassword) {
      setError(isAr ? "يرجى ملء جميع الحقول" : "Please fill in all fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(isAr ? "كلمتا المرور غير متطابقتين" : "Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError(isAr ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, email, newPassword });
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message || (isAr ? "حدث خطأ. يرجى المحاولة مرة أخرى." : "An error occurred. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-4">
          <Image
            src="/gcclab-icon.png"
            alt="GCC Lab"
            width={48}
            height={48}
            className="object-contain rounded-lg"
            priority
          />
          <div>
            <div className="text-lg font-bold tracking-tight">
              {isAr ? "المختبر الخليجي" : "GCC Lab"}
            </div>
            <div className="text-[10px] text-muted-foreground font-medium">
              {isAr ? "إدارة التدريب" : "Training Management"}
            </div>
          </div>
        </div>

        {success ? (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-success" />
            </div>
            <h2 className="text-xl font-bold">
              {isAr ? "تم إعادة تعيين كلمة المرور" : "Password Reset Complete"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? "تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة."
                : "Your password has been changed successfully. You can now sign in with your new password."}
            </p>
            <Button className="w-full h-11" asChild>
              <a href="/">
                {isAr ? "تسجيل الدخول" : "Sign In"}
                <ArrowRight className="h-4 w-4 rtl:rotate-180 ms-2" />
              </a>
            </Button>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                {isAr ? "إعادة تعيين كلمة المرور" : "Reset Password"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                {isAr
                  ? "أدخل كلمة المرور الجديدة لحسابك."
                  : "Enter your new password below."}
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {isAr ? "كلمة المرور الجديدة" : "New Password"}
                </Label>
                <PasswordInput
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleReset()}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={loading}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {isAr ? "تأكيد كلمة المرور" : "Confirm Password"}
                </Label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleReset()}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={loading}
                  className="h-11"
                />
              </div>
              <Button
                className="w-full h-11 text-sm font-semibold"
                onClick={handleReset}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    {isAr ? "جاري المعالجة..." : "Processing..."}
                  </>
                ) : (
                  <>
                    {isAr ? "إعادة تعيين كلمة المرور" : "Reset Password"}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180 ms-2" />
                  </>
                )}
              </Button>
              <div className="text-center">
                <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
                  {isAr ? "العودة لتسجيل الدخول" : "Back to login"}
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <PublicShell>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
        <ResetPasswordContent />
      </Suspense>
    </PublicShell>
  );
}
