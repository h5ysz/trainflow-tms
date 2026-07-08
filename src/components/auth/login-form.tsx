"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { ShieldCheck, UserCog, GraduationCap, Building2, ArrowRight, Languages, AlertCircle, Loader2 } from "lucide-react";
import { type UserRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

const roleCards: {
  role: UserRole;
  icon: typeof ShieldCheck;
  accent: string;
}[] = [
  { role: "SUPER_ADMIN", icon: ShieldCheck, accent: "text-primary" },
  { role: "COORDINATOR", icon: UserCog, accent: "text-info" },
  { role: "TRAINER", icon: GraduationCap, accent: "text-warning" },
  { role: "CONTRACTOR", icon: Building2, accent: "text-success" },
];

export function LoginForm() {
  const { t, locale, setLocale } = useI18n();
  const { signInByRole, signIn, authLoading, authError } = useAppStore();
  const [selectedRole, setSelectedRole] = useState<UserRole>("COORDINATOR");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSignIn = async () => {
    try {
      if (email && password) {
        await signIn(email, password);
      } else {
        await signInByRole(selectedRole);
      }
    } catch {
      // error is stored in store
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* Language toggle */}
      <div className="absolute top-4 end-4 z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          className="gap-2"
        >
          <Languages className="h-4 w-4" />
          {locale === "en" ? "العربية" : "English"}
        </Button>
      </div>

      {/* Left brand panel */}
      <div className="flex-1 flex flex-col justify-between p-8 lg:p-12 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }} />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-foreground/15 backdrop-blur font-bold text-sm">
            GC
          </div>
          <div>
            <div className="text-lg font-bold leading-tight tracking-tight">GCCLAB</div>
            <div className="text-xs text-primary-foreground/80">{t("app.tagline")}</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight mb-3">
            {t("auth.welcomeBack")}
          </h1>
          <p className="text-primary-foreground/80 leading-relaxed">
            {t("auth.signInSubtitle")}. {locale === "en"
              ? "Enterprise-grade training management — from request to certificate."
              : "إدارة تدريب بمستوى المؤسسات — من الطلب حتى الشهادة."}
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-4 text-primary-foreground/80 text-xs">
          <div>
            <div className="text-2xl font-bold text-primary-foreground">18</div>
            <div>{locale === "en" ? "Modules" : "وحدة"}</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary-foreground">4</div>
            <div>{locale === "en" ? "Roles" : "أدوار"}</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary-foreground">2</div>
            <div>{locale === "en" ? "Languages" : "لغات"}</div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t("auth.signIn")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t("auth.demoTitle")}</p>
          </div>

          {/* Role selector */}
          <div className="grid grid-cols-2 gap-3">
            {roleCards.map(({ role, icon: Icon, accent }) => {
              const active = role === selectedRole;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRole(role)}
                  className={cn(
                    "flex flex-col items-start gap-2 p-3 rounded-lg border-2 text-start transition-all",
                    active
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/40 hover:bg-muted/50"
                  )}
                >
                  <Icon className={cn("h-5 w-5", active ? accent : "text-muted-foreground")} />
                  <div className="text-sm font-semibold">{t(`role.${role}` as const)}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 leading-tight">
                    {t(`role.${role}.desc` as const)}
                  </div>
                </button>
              );
            })}
          </div>

          <Card className="p-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`${selectedRole.toLowerCase()}@gcclab.com`}
                autoComplete="email"
                disabled={authLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="gcclab123"
                autoComplete="current-password"
                disabled={authLoading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" defaultChecked />
                <Label htmlFor="remember" className="text-sm text-muted-foreground font-normal cursor-pointer">
                  {t("auth.rememberMe")}
                </Label>
              </div>
              <Button variant="link" size="sm" className="px-0 text-primary">
                {t("auth.forgotPassword")}
              </Button>
            </div>

            {authError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <Button className="w-full" size="lg" onClick={handleSignIn} disabled={authLoading}>
              {authLoading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {t("misc.loading")}
                </>
              ) : (
                <>
                  {t("auth.signInWithRole", { role: t(`role.${selectedRole}` as const) })}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180 ms-2" />
                </>
              )}
            </Button>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            {locale === "en"
              ? "Demo: pick a role and click Sign in, or use email + password \"gcclab123\"."
              : "تجريبي: اختر دوراً واضغط تسجيل الدخول، أو استخدم البريد وكلمة المرور \"gcclab123\"."}
          </p>
        </div>
      </div>
    </div>
  );
}
