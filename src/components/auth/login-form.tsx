"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, Loader2, ArrowRight, Languages } from "lucide-react";
import Image from "next/image";
import { api } from "@/lib/api/client";

interface BrandingSettings {
  companyNameEn?: string;
  companyNameAr?: string;
  logoWhiteUrl?: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  supportEmail?: string;
  supportPhone?: string;
}

export function LoginForm() {
  const { t, locale, setLocale } = useI18n();
  const { signIn, authLoading, authError } = useAppStore();
  const [branding, setBranding] = useState<BrandingSettings>({});

  // Fetch public branding settings on mount (no auth required).
  // Falls back to hardcoded defaults if the API is unavailable.
  useEffect(() => {
    api.get<Record<string, string>>("/settings/public")
      .then((map) => setBranding({
        companyNameEn: map["branding.companyNameEn"],
        companyNameAr: map["branding.companyNameAr"],
        logoWhiteUrl: map["branding.logoWhiteUrl"],
        logoUrl: map["branding.logoUrl"],
        faviconUrl: map["branding.faviconUrl"],
        primaryColor: map["branding.primaryColor"],
        supportEmail: map["branding.supportEmail"],
        supportPhone: map["branding.supportPhone"],
      }))
      .catch(() => {
        // Silent — fall back to hardcoded defaults already in the JSX.
      });
  }, []);

  const supportEmail = branding.supportEmail || "support@gcclab.com";
  const companyNameEn = branding.companyNameEn || "GCC Lab";
  const companyNameAr = branding.companyNameAr || "المختبر الخليجي";
  const logoWhiteSrc = branding.logoWhiteUrl || "/gcclab-logo-white.png";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSignIn = async () => {
    try {
      await signIn(email, password);
    } catch {
      // error stored in store
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Language toggle */}
      <div className="absolute top-5 end-5 z-20">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <Languages className="h-4 w-4" />
          {locale === "en" ? "العربية" : "English"}
        </Button>
      </div>

      {/* LEFT — Brand panel */}
      <div className="hidden lg:flex lg:flex-1 flex-col justify-between p-12 xl:p-16 bg-primary text-primary-foreground relative overflow-hidden tf-industrial-bg">
        {/* Top — Logo */}
        <div className="relative z-10">
          <Image
            src={logoWhiteSrc}
            alt={locale === "en" ? companyNameEn : companyNameAr}
            width={260}
            height={74}
            className="object-contain"
            priority
          />
          <div className="mt-2 text-xs text-primary-foreground/70 font-medium tracking-wide">
            {locale === "en" ? "Training & Certification Management System" : "نظام إدارة التدريب والشهادات"}
          </div>
        </div>

        {/* Center — Description */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-4xl xl:text-5xl font-bold leading-tight mb-4">
            {locale === "en"
              ? "Training Management System"
              : "نظام إدارة التدريب"}
          </h1>
          <p className="text-base text-primary-foreground/75 leading-relaxed">
            {locale === "en"
              ? "Enterprise platform for managing corporate safety training, calibration certifications, and compliance — from training request to certificate issuance."
              : "منصة مؤسسية لإدارة التدريب على السلامة المهنية وشهادات المعايرة والامتثال — من طلب التدريب حتى إصدار الشهادة."}
          </p>
        </div>

        {/* Bottom — Industrial elements */}
        <div className="relative z-10 flex items-center gap-6 text-xs text-primary-foreground/50">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground/60" />
            <span>{locale === "en" ? "Electrical Safety" : "سلامة الكهرباء"}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground/60" />
            <span>{locale === "en" ? "High Voltage" : "الجهد العالي"}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground/60" />
            <span>{locale === "en" ? "Engineering Compliance" : "الامتثال الهندسي"}</span>
          </div>
        </div>

        {/* Decorative circuit pattern */}
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }} />
      </div>

      {/* RIGHT — Login form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12 bg-background">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <Image
              src="/gcclab-icon.png"
              alt="GCC Lab"
              width={44}
              height={44}
              className="object-contain rounded-lg"
            />
            <div>
              <div className="text-lg font-bold tracking-tight">
                {locale === "en" ? "GCC Lab" : "المختبر الخليجي"}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">
                {locale === "en" ? "Training Management" : "إدارة التدريب"}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">{t("auth.signIn")}</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              {locale === "en"
                ? "Sign in to access the GCCLAB training platform."
                : "سجّل الدخول للوصول إلى منصة تدريب GCCLAB."}
            </p>
          </div>

          {/* Error */}
          {authError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {/* Form */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                placeholder="name@gcclab.com"
                autoComplete="email"
                disabled={authLoading}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={authLoading}
                className="h-11"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" defaultChecked />
                <Label htmlFor="remember" className="text-sm text-muted-foreground font-normal cursor-pointer">
                  {t("auth.rememberMe")}
                </Label>
              </div>
              <Button variant="link" size="sm" className="px-0 text-primary text-sm">
                {t("auth.forgotPassword")}
              </Button>
            </div>
            <Button
              className="w-full h-11 text-sm font-semibold"
              onClick={handleSignIn}
              disabled={authLoading}
            >
              {authLoading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {t("misc.loading")}
                </>
              ) : (
                <>
                  {t("auth.signIn")}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180 ms-2" />
                </>
              )}
            </Button>

            {/* Create account link */}
            <div className="text-center pt-2">
              <span className="text-sm text-muted-foreground">
                {locale === "en" ? "Don't have an account? " : "ليس لديك حساب؟ "}
              </span>
              <a
                href="/register"
                className="text-sm font-medium text-primary hover:underline"
              >
                {locale === "en" ? "Create New Account" : "إنشاء حساب جديد"}
              </a>
            </div>

            {/* Support contact */}
            <div className="text-center pt-3 border-t">
              <p className="text-xs text-muted-foreground">
                {locale === "en"
                  ? `Need help? Contact ${supportEmail}`
                  : `تحتاج مساعدة؟ اتصل بـ ${supportEmail}`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
