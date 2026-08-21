"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GCC LAB AI Assistant — Premium Enterprise Redesign (v2, Arabic-first)
// ─────────────────────────────────────────────────────────────────────────────
// Floating button is ALWAYS bottom-right (physical right-6, not logical end-6)
// so it stays in the correct position in both RTL and LTR layouts.
//
// Arabic is the default language. English is a fallback only when the user's
// locale is explicitly "en".
//
// Phase 2 (action-aware) functionality is fully preserved:
//   - ACTION_PLAN detection → ActionPreviewCard → confirm/cancel → execute
//   - "Preparing Action..." → preview → execution → completed/failed flow
//
// NO logic changes from the original — only JSX, styling, and copy.
// Uses dynamic import to avoid SSR issues with the I18nProvider.

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/context";
import {
  X, Send, Loader2, Trash2, Lightbulb,
  ClipboardList, FileText, BarChart3, HelpCircle, MessageSquare,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionPreviewCard, type PreviewResult, type ExecuteResult } from "./copilot/action-preview-card";

// Locale is now sourced from the I18nContext (the same context the rest of the
// app uses). This is reactive — when the user switches language, the panel
// updates instantly. The old useLocale() fallback read localStorage directly
// and didn't react to locale changes, which caused the panel to stay in
// English even after the user switched to Arabic.

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actionPlan?: {
    actionType: string;
    params: Record<string, unknown>;
    rationale: string;
  };
  preview?: PreviewResult;
  previewToken?: string;
  actionResolved?: boolean;
}

// ─── Quick Actions — 5 enterprise shortcuts (Arabic-first) ──────────────────
interface QuickAction {
  id: string;
  icon: LucideIcon;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  promptAr: string;
  promptEn: string;
  accent: string; // tailwind gradient classes for the icon chip
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "track-requests",
    icon: MessageSquare,
    titleAr: "عرض حالة الطلبات",
    titleEn: "Show Request Status",
    descAr: "اعرض حالة طلبات التدريب الأخيرة",
    descEn: "Show recent training request statuses",
    promptAr: "اعرض حالة طلبات التدريب الأخيرة",
    promptEn: "Show me the status of my recent training requests",
    accent: "from-blue-500 to-blue-600",
  },
  {
    id: "upcoming-courses",
    icon: ClipboardList,
    titleAr: "الدورات القادمة",
    titleEn: "Upcoming Courses",
    descAr: "ما هي الدورات القادمة؟",
    descEn: "What are the upcoming courses?",
    promptAr: "ما هي الدورات القادمة؟",
    promptEn: "What are the upcoming courses?",
    accent: "from-emerald-500 to-emerald-600",
  },
  {
    id: "registered-trainees",
    icon: FileText,
    titleAr: "المتدربون المسجلون",
    titleEn: "Registered Trainees",
    descAr: "اعرض المتدربين المسجلين",
    descEn: "Show registered trainees",
    promptAr: "اعرض المتدربين المسجلين",
    promptEn: "Show registered trainees",
    accent: "from-amber-500 to-amber-600",
  },
  {
    id: "analyze-data",
    icon: BarChart3,
    titleAr: "إحصائيات التدريب",
    titleEn: "Training Statistics",
    descAr: "اعرض إحصائيات التدريب",
    descEn: "Show training statistics",
    promptAr: "اعرض إحصائيات التدريب",
    promptEn: "Show training statistics",
    accent: "from-purple-500 to-purple-600",
  },
  {
    id: "pending-review",
    icon: HelpCircle,
    titleAr: "الطلبات قيد المراجعة",
    titleEn: "Pending Review",
    descAr: "ما هي الطلبات قيد المراجعة؟",
    descEn: "Which requests are pending review?",
    promptAr: "ما هي الطلبات قيد المراجعة؟",
    promptEn: "Which requests are pending review?",
    accent: "from-primary to-primary-hover",
  },
];

// ─── Suggested Questions — 4 FAQ-style prompts (Arabic-first) ────────────────
interface SuggestedQuestion {
  id: string;
  labelAr: string;
  labelEn: string;
  promptAr: string;
  promptEn: string;
}

const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  {
    id: "add-trainee",
    labelAr: "كيف أضيف متدربًا؟",
    labelEn: "How do I add a trainee?",
    promptAr: "كيف أضيف متدربًا؟",
    promptEn: "How do I add a trainee?",
  },
  {
    id: "upload-attachments",
    labelAr: "كيف أرفع المرفقات؟",
    labelEn: "How do I upload attachments?",
    promptAr: "كيف أرفع المرفقات؟",
    promptEn: "How do I upload attachments?",
  },
  {
    id: "review-request",
    labelAr: "كيف أراجع طلبًا؟",
    labelEn: "How do I review a request?",
    promptAr: "كيف أراجع طلبًا؟",
    promptEn: "How do I review a request?",
  },
  {
    id: "generate-report",
    labelAr: "كيف أصدر تقريرًا؟",
    labelEn: "How do I generate a report?",
    promptAr: "كيف أصدر تقريرًا؟",
    promptEn: "How do I generate a report?",
  },
];

const STORAGE_KEY = "gcclab-copilot-history";

export function CopilotPanel() {
  // Use the real I18nContext — reactive locale + dir from the app store.
  // This is the same context AppShell, Sidebar, Topbar, etc. use.
  const { locale, dir } = useI18n();
  const isAr = locale === "ar";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pulse only when closed + has suggestions to show + no messages yet
  const shouldPulse = !open && showSuggestions && messages.length === 0;

  // Load history from localStorage — deferred to avoid set-state-in-effect
  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as ChatMessage[];
          setMessages(parsed);
          setShowSuggestions(parsed.length === 0);
        }
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(handle);
  }, []);

  // Save history to localStorage
  const saveHistory = useCallback((msgs: ChatMessage[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-50)));
    } catch { /* ignore */ }
  }, []);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setShowSuggestions(false);
    setLoading(true);

    try {
      const res = await api.post<{
        kind: "TEXT" | "ACTION_PLAN";
        reply: string;
        timestamp: string;
        action?: { actionType: string; params: Record<string, unknown>; rationale: string };
      }>("/copilot/chat", {
        message: msg,
        history: messages.map(m => ({ role: m.role, content: m.content })),
        // Pass the active UI locale so the backend can inject a language-
        // specific system prompt. This is the root-cause fix for the AI
        // responding in English even when the UI is Arabic.
        locale,
      });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.reply,
        timestamp: res.timestamp,
        actionPlan: res.kind === "ACTION_PLAN" ? res.action : undefined,
      };
      const updated = [...newMessages, assistantMsg];
      setMessages(updated);
      saveHistory(updated);

      if (res.kind === "ACTION_PLAN" && res.action) {
        try {
          const previewRes = await api.post<{ preview: PreviewResult; previewToken: string }>(
            "/copilot/actions/preview",
            { actionType: res.action.actionType, params: res.action.params }
          );
          let updatedWithPreview: ChatMessage[] = [];
          setMessages((prev) => {
            const next = [...prev];
            const lastAssistant = next[next.length - 1];
            if (lastAssistant && lastAssistant.role === "assistant") {
              next[next.length - 1] = {
                ...lastAssistant,
                preview: previewRes.preview,
                previewToken: previewRes.previewToken,
              };
            }
            updatedWithPreview = next;
            return next;
          });
          saveHistory(updatedWithPreview);
        } catch (e) {
          const errMsg = (e as Error).message || "Failed to prepare action preview.";
          let updatedWithError: ChatMessage[] = [];
          setMessages((prev) => {
            const next = [...prev];
            const lastAssistant = next[next.length - 1];
            if (lastAssistant && lastAssistant.role === "assistant") {
              next[next.length - 1] = {
                ...lastAssistant,
                content: `${lastAssistant.content}\n\n⚠️ ${errMsg}`,
                actionPlan: undefined,
              };
            }
            updatedWithError = next;
            return next;
          });
          saveHistory(updatedWithError);
        }
      }
    } catch (e) {
      const isRateLimit = e instanceof Error && /429|rate.?limit|quota/i.test(e.message);
      const isServiceDown = e instanceof Error && /503|unavailable|AI_ERROR/i.test(e.message);
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: isAr
          ? (isRateLimit ? "عذراً، تم تجاوز حد الاستخدام المسموح للمساعد الذكي. يرجى المحاولة لاحقاً." :
             isServiceDown ? "عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة مرة أخرى." :
             "عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.")
          : (isRateLimit ? "Sorry, the AI assistant quota has been exceeded. Please try again later." :
             isServiceDown ? "Sorry, the AI service is currently unavailable. Please try again." :
             "Sorry, I couldn't process your request. Please try again."),
        timestamp: new Date().toISOString(),
      };
      const updated = [...newMessages, errorMsg];
      setMessages(updated);
      saveHistory(updated);
    } finally {
      setLoading(false);
    }
  };

  const handleActionResolved = (idx: number, result: ExecuteResult | null) => {
    setMessages((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = {
          ...next[idx],
          actionResolved: true,
          content: result
            ? `${next[idx].content}\n\n✅ ${result.message}`
            : next[idx].content,
        };
      }
      return next;
    });
    saveHistory(messages);
  };

  const clearHistory = () => {
    setMessages([]);
    setShowSuggestions(true);
    localStorage.removeItem(STORAGE_KEY);
  };

  // ─── Localized labels (bilingual, reactive to locale) ───────────────────
  const L = {
    assistantTitle: isAr ? "مساعد GCC LAB الذكي" : "GCC LAB AI Assistant",
    assistantSubtitle: isAr ? "جاهز لمساعدتك في إدارة التدريب" : "Ready to help you manage training",
    welcome: isAr ? "مرحبًا، كيف يمكنني مساعدتك اليوم؟" : "Hello! How can I help you today?",
    welcomeDesc: isAr
      ? "اسألني عن الدورات التدريبية، المتدربين، الطلبات، التقارير، الشهادات، أو أي شيء داخل النظام."
      : "Ask me about courses, trainees, requests, reports, certificates, or anything in the system.",
    quickActions: isAr ? "الإجراءات السريعة" : "Quick Actions",
    suggestedQuestions: isAr ? "أسئلة مقترحة" : "Suggested Questions",
    typeMessage: isAr ? "اكتب رسالتك..." : "Type your message...",
    aiPowered: isAr ? "يعمل بالذكاء الاصطناعي • يحترم صلاحياتك" : "AI-powered • Respects your permissions",
    clearHistory: isAr ? "مسح المحادثة" : "Clear history",
    close: isAr ? "إغلاق" : "Close",
    openAssistant: isAr ? "افتح مساعد GCC LAB" : "Open GCC LAB Assistant",
    preparingAction: isAr ? "جاري تحضير معاينة الإجراء..." : "Preparing action preview...",
    send: isAr ? "إرسال" : "Send",
    you: isAr ? "أنت" : "You",
  };

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════
          Floating Button — ALWAYS bottom-right (physical right-6)
          Perfect circle, GCC LAB logo, soft pulse, hover glow, modern shadow
          ════════════════════════════════════════════════════════════════════ */}
      {!open && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-in fade-in zoom-in-50 duration-500"
          style={{ animationFillMode: "both" }}
        >
          {/* Breathing glow — soft, slow opacity pulse separate from float anim.
              This gives the button a "living" premium feel without being flashy. */}
          <div
            className="pointer-events-none absolute -inset-4 rounded-full bg-primary/25 blur-2xl"
            aria-hidden
            style={{
              animationName: "breathe",
              animationDuration: "4s",
              animationIterationCount: "infinite",
              animationTimingFunction: "ease-in-out",
            }}
          />

          {/* Pulse ring — only when shouldPulse (attention cue for new users) */}
          {shouldPulse && (
            <>
              <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/30 animate-ping" style={{ animationDuration: "2.8s" }} />
              <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: "2.8s", animationDelay: "1s" }} />
            </>
          )}

          <button
            onClick={() => setOpen(true)}
            className={cn(
              "relative flex h-14 w-14 items-center justify-center rounded-full",
              "bg-gradient-to-br from-primary to-primary-hover",
              "shadow-[0_8px_24px_-6px_rgba(0,0,0,0.3),0_3px_8px_-2px_rgba(0,0,0,0.1)]",
              "ring-1 ring-white/25",
              "transition-all duration-300 ease-out",
              "hover:scale-105 hover:shadow-[0_12px_32px_-6px_rgba(0,0,0,0.35),0_0_24px_rgba(59,130,246,0.2)]",
              "active:scale-95",
              "group",
            )}
            style={{
              animationName: "float",
              animationDuration: "3.5s",
              animationIterationCount: "infinite",
              animationTimingFunction: "ease-in-out",
            }}
            aria-label={L.openAssistant}
          >
            {/* Inline keyframes: float (gentle up/down) + breathe (glow opacity) */}
            <style>{`
              @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
              @keyframes breathe{0%,100%{opacity:0.4}50%{opacity:0.7}}
            `}</style>

            {/* Gradient overlay for depth */}
            <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-white/25" />

            {/* GCC LAB official logo */}
            <Image
              src="/gcclab-icon.png"
              alt="GCC LAB"
              width={36}
              height={36}
              className="relative h-9 w-9 shrink-0 object-contain rounded-full transition-transform duration-300 group-hover:scale-110"
              priority
            />
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Assistant Panel — slides in from physical right
          ════════════════════════════════════════════════════════════════════ */}
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-md animate-in fade-in duration-300"
            onClick={() => setOpen(false)}
          />

          {/* Panel container — always on the physical right, but dir follows
              locale so Arabic text/bubbles/avatars align correctly. */}
          <div
            dir={dir}
            className={cn(
              "absolute right-0 top-0 h-full",
              "w-full sm:w-[440px] md:w-[480px]",
              "bg-background",
              "shadow-[0_0_60px_-12px_rgba(0,0,0,0.4)]",
              "flex flex-col",
              "animate-in slide-in-from-right duration-400",
            )}
            style={{ animationFillMode: "both" }}
          >
            {/* ─── Premium Header Card ─────────────────────────────────────
                Large circular logo, Arabic title, subtitle, gradient bg */}
            <div className="relative shrink-0 overflow-hidden border-b border-primary/20">
              {/* Gradient background — primary → primary-hover, full opacity */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-primary-hover" />
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-white/12" />

              {/* Decorative dot pattern — subtle premium texture */}
              <div
                className="absolute inset-0 opacity-[0.08]"
                style={{
                  backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 80%, white 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />

              <div className="relative flex items-center justify-between px-5 py-5">
                <div className="flex items-center gap-4 min-w-0">
                  {/* Large circular logo with soft glow + premium ring */}
                  <div className="relative shrink-0">
                    {/* Soft glow halo */}
                    <div className="absolute -inset-1 rounded-full bg-white/25 blur-md" aria-hidden />
                    {/* Logo container */}
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.18)] ring-2 ring-white/40">
                      <Image
                        src="/gcclab-icon.png"
                        alt="GCC LAB"
                        width={34}
                        height={34}
                        className="h-9 w-9 shrink-0 object-contain rounded-full"
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <h2 className="text-[17px] font-bold text-white leading-tight tracking-tight truncate">
                      {L.assistantTitle}
                    </h2>
                    <p className="text-[12.5px] text-white/85 leading-tight truncate font-medium">
                      {L.assistantSubtitle}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {messages.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-all duration-200 active:scale-90"
                      title={L.clearHistory}
                      aria-label={L.clearHistory}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-all duration-200 active:scale-90"
                    title={L.close}
                    aria-label={L.close}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* ─── Messages Area ──────────────────────────────────────────── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto tf-scroll px-4 py-5 space-y-5 bg-muted/30">
              {messages.length === 0 && showSuggestions ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  {/* Welcome card — softer shadow, better padding, premium typography */}
                  <div className="rounded-2xl bg-card p-5 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.06)] ring-1 ring-border/40">
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 shadow-[0_4px_12px_-2px_rgba(245,158,11,0.4)]">
                        <Lightbulb className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1 pt-1">
                        <h3 className="font-bold text-[15px] text-foreground leading-snug">
                          {L.welcome}
                        </h3>
                        <p className="text-[12.5px] text-muted-foreground leading-relaxed mt-1.5">
                          {L.welcomeDesc}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border/70 rtl:bg-gradient-to-r" />
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                        {L.quickActions}
                      </span>
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border/70 rtl:bg-gradient-to-l" />
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {QUICK_ACTIONS.map((action, idx) => {
                        const Icon = action.icon;
                        const title = isAr ? action.titleAr : action.titleEn;
                        const desc = isAr ? action.descAr : action.descEn;
                        const prompt = isAr ? action.promptAr : action.promptEn;
                        return (
                          <button
                            key={action.id}
                            onClick={() => void send(prompt)}
                            className={cn(
                              "group flex items-center gap-3.5 rounded-2xl bg-card p-3.5 text-start",
                              "ring-1 ring-border/40",
                              "transition-all duration-300 ease-out",
                              "hover:ring-primary/20 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.1)] hover:-translate-y-0.5",
                              "active:translate-y-0 active:scale-[0.98] active:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)]",
                            )}
                            style={{
                              animationDelay: `${idx * 60}ms`,
                              animationFillMode: "both",
                            }}
                          >
                            <div className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                              "bg-gradient-to-br shadow-[0_3px_10px_-2px_rgba(0,0,0,0.15)]",
                              action.accent,
                              "transition-transform duration-300 ease-out group-hover:scale-105 group-active:scale-95",
                            )}>
                              <Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px] font-semibold text-foreground leading-tight transition-colors duration-300 group-hover:text-primary">{title}</div>
                              <div className="text-[11.5px] text-muted-foreground leading-tight mt-0.5 truncate">
                                {desc}
                              </div>
                            </div>
                            <ArrowLeft className="h-4 w-4 text-muted-foreground/25 shrink-0 transition-all duration-300 ease-out group-hover:text-primary group-hover:-translate-x-1.5 rtl:rotate-180" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Suggested Questions */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border/70 rtl:bg-gradient-to-r" />
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                        {L.suggestedQuestions}
                      </span>
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border/70 rtl:bg-gradient-to-l" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => void send(isAr ? q.promptAr : q.promptEn)}
                          className={cn(
                            "rounded-xl bg-card px-3.5 py-3 text-start text-[12.5px] font-medium",
                            "ring-1 ring-border/40 text-foreground/80",
                            "transition-all duration-200 ease-out",
                            "hover:ring-primary/25 hover:bg-primary/5 hover:text-primary hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)]",
                            "active:scale-[0.97]",
                          )}
                        >
                          {isAr ? q.labelAr : q.labelEn}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* ─── Conversation messages ───────────────────────────────
                    dir="ltr" on the messages container keeps the physical
                    layout consistent (user right, assistant left) in both
                    RTL and LTR. Each bubble uses dir="auto" so the text
                    inside flows according to its own script (Arabic RTL,
                    English LTR) — same behavior as WhatsApp/Telegram. */
                <div className="space-y-6" dir="ltr">
                  {messages.map((msg, idx) => (
                    <div key={idx} className="space-y-2.5 animate-in fade-in slide-in-from-bottom-1.5 duration-300">
                      <div
                        className={cn(
                          "flex gap-3 items-end",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        {/* Assistant avatar — GCC LAB logo */}
                        {msg.role === "assistant" && (
                          <div className="relative shrink-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover shadow-[0_3px_10px_-2px_rgba(0,0,0,0.2)] ring-2 ring-background">
                              <Image
                                src="/gcclab-icon.png"
                                alt="GCC LAB"
                                width={22}
                                height={22}
                                className="h-[22px] w-[22px] shrink-0 object-contain rounded-full"
                              />
                            </div>
                          </div>
                        )}

                        {/* Message bubble — assistant uses Markdown rendering,
                            user messages stay plain text */}
                        <div
                          dir="auto"
                          className={cn(
                            "px-4 py-3 text-[13.5px] break-words leading-relaxed",
                            msg.role === "user"
                              ? "bg-gradient-to-br from-primary to-primary-hover text-primary-foreground rounded-[1.25rem] rounded-br-md shadow-[0_3px_12px_-3px_rgba(0,0,0,0.2)] max-w-[75%] font-medium whitespace-pre-wrap"
                              : "bg-card text-card-foreground rounded-[1.25rem] rounded-bl-md shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)] ring-1 ring-border/40 max-w-[75%]"
                          )}
                        >
                          {msg.role === "assistant" ? (
                            <div className="copilot-markdown">
                              <ReactMarkdown
                                components={{
                                  // Render bold, lists, tables, etc. with proper styling
                                  strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
                                  ul: ({ children }) => <ul className="list-disc ps-5 my-1.5 space-y-0.5">{children}</ul>,
                                  ol: ({ children }) => <ol className="list-decimal ps-5 my-1.5 space-y-0.5">{children}</ol>,
                                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
                                  code: ({ children }) => <code className="rounded bg-muted/60 px-1 py-0.5 text-[12px] font-mono">{children}</code>,
                                  pre: ({ children }) => <pre className="my-2 rounded-lg bg-muted/60 p-3 overflow-x-auto text-[12px]">{children}</pre>,
                                  table: ({ children }) => <table className="my-2 w-full border-collapse text-[12px]">{children}</table>,
                                  th: ({ children }) => <th className="border border-border/50 px-2 py-1 text-start font-semibold bg-muted/30">{children}</th>,
                                  td: ({ children }) => <td className="border border-border/50 px-2 py-1">{children}</td>,
                                  h1: ({ children }) => <h3 className="text-[15px] font-bold my-1.5">{children}</h3>,
                                  h2: ({ children }) => <h4 className="text-[14px] font-bold my-1.5">{children}</h4>,
                                  h3: ({ children }) => <h5 className="text-[13.5px] font-bold my-1">{children}</h5>,
                                  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{children}</a>,
                                  blockquote: ({ children }) => <blockquote className="border-s-2 border-primary/30 ps-3 my-1.5 text-muted-foreground">{children}</blockquote>,
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            msg.content
                          )}
                        </div>

                        {/* User avatar */}
                        {msg.role === "user" && (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground font-bold text-[13px] shadow-sm ring-2 ring-background">
                            {L.you.charAt(0)}
                          </div>
                        )}
                      </div>

                      {/* Phase 2: Action Preview Card */}
                      {msg.role === "assistant"
                        && msg.preview
                        && msg.previewToken
                        && !msg.actionResolved
                        && (
                          <div className="ps-12" style={{ paddingLeft: "3rem" }}>
                            <ActionPreviewCard
                              preview={msg.preview}
                              previewToken={msg.previewToken}
                              locale={locale as "en" | "ar"}
                              onDismiss={() => handleActionResolved(idx, null)}
                              onExecuted={(result) => handleActionResolved(idx, result)}
                            />
                          </div>
                        )}

                      {/* Phase 2: preparing action hint */}
                      {msg.role === "assistant"
                        && msg.actionPlan
                        && !msg.preview
                        && !msg.actionResolved
                        && (
                          <div className="ps-12" style={{ paddingLeft: "3rem" }}>
                            <div className="rounded-xl bg-card p-3 text-[12px] text-muted-foreground flex items-center gap-2 ring-1 ring-border/40 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)]">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                              {L.preparingAction}
                            </div>
                          </div>
                        )}
                    </div>
                  ))}

                  {/* ─── Typing indicator ─────────────────────────────────── */}
                  {loading && (
                    <div className="flex gap-3 items-end justify-start animate-in fade-in slide-in-from-bottom-1 duration-200">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover shadow-[0_3px_10px_-2px_rgba(0,0,0,0.2)] ring-2 ring-background">
                        <Image
                          src="/gcclab-icon.png"
                          alt="GCC LAB"
                          width={22}
                          height={22}
                          className="h-[22px] w-[22px] shrink-0 object-contain rounded-full"
                        />
                      </div>
                      <div className="bg-card rounded-[1.25rem] rounded-bl-md px-5 py-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)] ring-1 ring-border/40">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
                          <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1s" }} />
                          <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1s" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ─── Input Area ─────────────────────────────────────────────── */}
            <div className="shrink-0 border-t border-border/40 bg-background px-4 py-3.5">
              <div className="flex items-end gap-2.5">
                <div className="relative flex-1">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={L.typeMessage}
                    disabled={loading}
                    className="h-12 rounded-2xl pe-4 ps-4 text-[13.5px] bg-muted/40 border-border/40 placeholder:text-muted-foreground/70 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary/30 transition-all duration-200"
                  />
                </div>
                <button
                  onClick={() => void send()}
                  disabled={loading || !input.trim()}
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                    "bg-gradient-to-br from-primary to-primary-hover text-primary-foreground",
                    "shadow-[0_4px_14px_-3px_rgba(0,0,0,0.2)] transition-all duration-200 ease-out",
                    "hover:scale-105 hover:shadow-[0_6px_18px_-3px_rgba(0,0,0,0.25)]",
                    "active:scale-95 active:shadow-sm",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-[0_4px_14px_-3px_rgba(0,0,0,0.2)]",
                  )}
                  aria-label={L.send}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-[18px] w-[18px] rtl:-scale-x-100" strokeWidth={2.2} />
                  )}
                </button>
              </div>
              <p className="mt-2.5 text-[10.5px] text-muted-foreground/80 text-center font-medium leading-tight">
                {L.aiPowered}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
