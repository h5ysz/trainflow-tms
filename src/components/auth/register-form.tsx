"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ArrowRight, ArrowLeft, AlertCircle, Loader2, CheckCircle2, Languages } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { api } from "@/lib/api/client";

export function RegisterForm() {
  const { locale, setLocale } = useI18n();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!formData.companyName || !formData.contactPerson || !formData.nationalId || !formData.mobileNumber || !formData.email || !formData.password) {
      setError(locale === "en" ? "All fields are required except Commercial Registration" : "جميع الحقول مطلوبة عدا السجل التجاري");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError(locale === "en" ? "Passwords do not match" : "كلمات المرور غير متطابقة");
      return;
    }
    if (formData.password.length < 8) {
      setError(locale === "en" ? "Password must be at least 8 characters" : "كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/register", {
        companyName: formData.companyName,
        crNumber: formData.crNumber || undefined,
        contactPerson: formData.contactPerson,
        nationalId: formData.nationalId,
        mobileNumber: formData.mobileNumber,
        email: formData.email,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (k: string, v: string) => setFormData((p) => ({ ...p, [k]: v }));

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="flex justify-center mb-4">
            <Image src="/gcclab-icon.svg" alt="GCCLAB" width={56} height={56} className="rounded-xl" />
          </div>
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="h-12 w-12 text-success" />
          </div>
          <h2 className="text-xl font-bold mb-2">
            {locale === "en" ? "Registration Submitted" : "تم تقديم التسجيل"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {locale === "en"
              ? "Your account has been submitted for approval. You will receive an email once your account is approved by GCCLAB administration."
              : "تم تقديم حسابك للاعتماد. ستتلقى بريداً إلكترونياً بمجرد اعتماد حسابك من إدارة GCCLAB."}
          </p>
          <Link href="/">
            <Button className="w-full">
              {locale === "en" ? "Back to Login" : "العودة لتسجيل الدخول"}
              <ArrowRight className="h-4 w-4 rtl:rotate-180 ms-2" />
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Language toggle */}
      <div className="absolute top-5 end-5 z-20">
        <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "en" ? "ar" : "en")} className="gap-2">
          <Languages className="h-4 w-4" />
          {locale === "en" ? "العربية" : "English"}
        </Button>
      </div>

      {/* LEFT — Brand */}
      <div className="hidden lg:flex lg:flex-1 flex-col justify-between p-12 xl:p-16 bg-primary text-primary-foreground relative overflow-hidden tf-industrial-bg">
        <div className="relative z-10">
          <div className="flex items-center gap-4">
            <Image src="/gcclab-icon.svg" alt="GCCLAB" width={52} height={52} className="rounded-lg" />
            <div>
              <div className="text-xl font-bold tracking-tight">GCCLAB</div>
              <div className="text-xs text-primary-foreground/70 font-medium">
                {locale === "en" ? "Gulf Calibration Laboratory" : "المختبر الخليجي"}
              </div>
            </div>
          </div>
        </div>
        <div className="relative z-10 max-w-lg">
          <h1 className="text-4xl xl:text-5xl font-bold leading-tight mb-4">
            {locale === "en" ? "Create Your Account" : "أنشئ حسابك"}
          </h1>
          <p className="text-base text-primary-foreground/75 leading-relaxed">
            {locale === "en"
              ? "Register your company to access GCCLAB training and certification services. Your account will be reviewed and approved by our administration team."
              : "سجل شركتك للوصول إلى خدمات التدريب والشهادات في GCCLAB. سيتم مراجعة حسابك واعتماده من قبل فريق الإدارة."}
          </p>
        </div>
        <div className="relative z-10" />
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }} />
      </div>

      {/* RIGHT — Registration form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12 bg-background overflow-y-auto">
        <div className="w-full max-w-sm space-y-5 py-8">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-6">
            <Image src="/gcclab-icon.svg" alt="GCCLAB" width={44} height={44} className="rounded-lg" />
            <div>
              <div className="text-lg font-bold tracking-tight">GCCLAB</div>
              <div className="text-[10px] text-muted-foreground font-medium">
                {locale === "en" ? "Create Account" : "إنشاء حساب"}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {locale === "en" ? "Create New Account" : "إنشاء حساب جديد"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              {locale === "en" ? "Fill in your company details to register." : "أدخل بيانات شركتك للتسجيل."}
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
              <Label className="text-sm font-medium">{locale === "en" ? "Company Name" : "اسم الشركة"} *</Label>
              <Input value={formData.companyName ?? ""} onChange={(e) => setField("companyName", e.target.value)} className="h-11" placeholder={locale === "en" ? "Acme Contracting Co." : "شركة المقاولات"} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Commercial Registration (optional)" : "السجل التجاري (اختياري)"}</Label>
              <Input value={formData.crNumber ?? ""} onChange={(e) => setField("crNumber", e.target.value)} className="h-11" placeholder="CR-00000000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Contact Person" : "مسؤول التواصل"} *</Label>
              <Input value={formData.contactPerson ?? ""} onChange={(e) => setField("contactPerson", e.target.value)} className="h-11" placeholder={locale === "en" ? "Full name" : "الاسم الكامل"} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "National ID / Iqama" : "رقم الهوية / الإقامة"} *</Label>
              <Input value={formData.nationalId ?? ""} onChange={(e) => setField("nationalId", e.target.value)} className="h-11" placeholder="0000000000" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Mobile Number" : "رقم الجوال"} *</Label>
              <Input value={formData.mobileNumber ?? ""} onChange={(e) => setField("mobileNumber", e.target.value)} className="h-11" placeholder="+966 5X XXX XXXX" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Email" : "البريد الإلكتروني"} *</Label>
              <Input type="email" value={formData.email ?? ""} onChange={(e) => setField("email", e.target.value)} className="h-11" placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Password" : "كلمة المرور"} *</Label>
              <Input type="password" value={formData.password ?? ""} onChange={(e) => setField("password", e.target.value)} className="h-11" placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Confirm Password" : "تأكيد كلمة المرور"} *</Label>
              <Input type="password" value={formData.confirmPassword ?? ""} onChange={(e) => setField("confirmPassword", e.target.value)} className="h-11" placeholder="••••••••" />
            </div>
          </div>

          <Button className="w-full h-11" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                {locale === "en" ? "Submitting..." : "جاري التقديم..."}
              </>
            ) : (
              <>
                {locale === "en" ? "Register" : "تسجيل"}
                <ArrowRight className="h-4 w-4 rtl:rotate-180 ms-2" />
              </>
            )}
          </Button>

          <div className="text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
              {locale === "en" ? "Back to Login" : "العودة لتسجيل الدخول"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
