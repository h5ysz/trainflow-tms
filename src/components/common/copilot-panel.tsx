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
import { api } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import {
  X, Send, Loader2, Trash2, Lightbulb,
  ClipboardList, FileText, BarChart3, HelpCircle, MessageSquare,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionPreviewCard, type PreviewResult, type ExecuteResult } from "./copilot/action-preview-card";

// ─── Locale detection — Arabic-first ────────────────────────────────────────
// Default is "ar" (Arabic). The stored locale is read from localStorage after
// mount; if it's explicitly "en", we switch to English. Otherwise Arabic stays.
function useLocale(): string {
  const [locale, setLocale] = useState("ar");
  useEffect(() => {
    const handle = setTimeout(() => {
      const stored = localStorage.getItem("gcclab-tms-store");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.state?.locale === "en") setLocale("en");
        } catch { /* ignore */ }
      }
    }, 0);
    return () => clearTimeout(handle);
  }, []);
  return locale;
}

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
  prompt: string;
  accent: string; // tailwind gradient classes for the icon chip
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "create-request",
    icon: ClipboardList,
    titleAr: "إنشاء طلب دورة",
    titleEn: "Create Course Request",
    descAr: "ابدأ طلب تدريب جديد للشركة",
    descEn: "Start a new training request",
    prompt: "Help me create a new training course request",
    accent: "from-blue-500 to-blue-600",
  },
  {
    id: "track-requests",
    icon: MessageSquare,
    titleAr: "متابعة الطلبات",
    titleEn: "Track Requests",
    descAr: "عرض حالة الطلبات الحالية",
    descEn: "View current request statuses",
    prompt: "Show me the status of my recent training requests",
    accent: "from-emerald-500 to-emerald-600",
  },
  {
    id: "create-report",
    icon: FileText,
    titleAr: "إنشاء تقرير",
    titleEn: "Generate Report",
    descAr: "إنشاء تقرير تفصيلي للنشاط",
    descEn: "Generate a detailed activity report",
    prompt: "Generate a summary report of training activities",
    accent: "from-amber-500 to-amber-600",
  },
  {
    id: "analyze-data",
    icon: BarChart3,
    titleAr: "تحليل البيانات",
    titleEn: "Analyze Data",
    descAr: "رؤى وإحصائيات الأداء",
    descEn: "Performance insights and statistics",
    prompt: "Analyze training data and show key insights",
    accent: "from-purple-500 to-purple-600",
  },
  {
    id: "help",
    icon: HelpCircle,
    titleAr: "المساعدة",
    titleEn: "Help",
    descAr: "دليل استخدام النظام",
    descEn: "System usage guide",
    prompt: "How do I use the GCC LAB training management system?",
    accent: "from-primary to-primary-hover",
  },
];

// ─── Suggested Questions — 4 FAQ-style prompts (Arabic-first) ────────────────
interface SuggestedQuestion {
  id: string;
  labelAr: string;
  labelEn: string;
  prompt: string;
}

const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  {
    id: "add-trainee",
    labelAr: "كيف أضيف متدرب؟",
    labelEn: "How do I add a trainee?",
    prompt: "How do I add a trainee?",
  },
  {
    id: "upload-attachments",
    labelAr: "كيف أرفع المرفقات؟",
    labelEn: "How do I upload attachments?",
    prompt: "How do I upload attachments?",
  },
  {
    id: "review-request",
    labelAr: "كيف أراجع الطلب؟",
    labelEn: "How do I review a request?",
    prompt: "How do I review a request?",
  },
  {
    id: "generate-report",
    labelAr: "كيف أصدر تقرير؟",
    labelEn: "How do I generate a report?",
    prompt: "How do I generate a report?",
  },
];

const STORAGE_KEY = "gcclab-copilot-history";

export function CopilotPanel() {
  const locale = useLocale();
  const isAr = locale !== "en"; // Arabic by default
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
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: isAr ? "عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى." : "Sorry, I couldn't process your request. Please try again.",
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

  // ─── Localized labels (Arabic-first) ─────────────────────────────────────
  const L = {
    assistantTitle: isAr ? "مساعد GCC LAB الذكي" : "GCC LAB AI Assistant",
    assistantSubtitle: isAr ? "جاهز لمساعدتك في إدارة التدريب" : "Ready to help you manage training",
    welcome: isAr ? "مرحبًا، كيف يمكنني مساعدتك اليوم؟" : "Hello! How can I help you today?",
    welcomeDesc: isAr
      ? "اسألني عن الدورات، المتدربين، التقارير، الشهادات، أو أي شيء يخص النظام"
      : "Ask me about courses, trainees, reports, certificates, or anything about the system",
    quickActions: isAr ? "إجراءات سريعة" : "Quick Actions",
    suggestedQuestions: isAr ? "أسئلة شائعة" : "Suggested Questions",
    typeMessage: isAr ? "اكتب رسالتك..." : "Type your message...",
    aiPowered: isAr ? "مدعوم بالذكاء الاصطناعي • يحترم صلاحياتك" : "AI-powered • Respects your permissions",
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
        <div className="fixed bottom-6 right-6 z-50">
          {/* Pulse ring — only when shouldPulse */}
          {shouldPulse && (
            <>
              <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/30 animate-ping" style={{ animationDuration: "2.5s" }} />
              <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.8s" }} />
            </>
          )}

          <button
            onClick={() => setOpen(true)}
            className={cn(
              "relative flex h-14 w-14 items-center justify-center rounded-full",
              "bg-gradient-to-br from-primary to-primary-hover",
              "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3),0_4px_12px_-2px_rgba(0,0,0,0.15)]",
              "ring-1 ring-white/20",
              "transition-all duration-300 cubic-bezier(0.4,0,0.2,1)",
              "hover:scale-110 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.4),0_0_32px_rgba(59,130,246,0.3)]",
              "active:scale-95",
              "group",
            )}
            aria-label={L.openAssistant}
          >
            {/* Gradient overlay for depth */}
            <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-white/20" />

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

          {/* Panel container — always on the physical right */}
          <div
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
            <div className="relative shrink-0 overflow-hidden border-b">
              {/* Gradient background */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-primary-hover opacity-97" />
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-white/10" />

              {/* Decorative pattern */}
              <div
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 80%, white 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />

              <div className="relative flex items-center justify-between p-5">
                <div className="flex items-center gap-3.5 min-w-0">
                  {/* Large circular logo with glow */}
                  <div className="relative shrink-0">
                    <div className="absolute inset-0 rounded-full bg-white/20 blur-md" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg ring-2 ring-white/30">
                      <Image
                        src="/gcclab-icon.png"
                        alt="GCC LAB"
                        width={30}
                        height={30}
                        className="h-8 w-8 shrink-0 object-contain rounded-full"
                      />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-white leading-tight tracking-tight truncate">
                      {L.assistantTitle}
                    </h2>
                    <p className="text-xs text-white/80 leading-tight truncate mt-0.5">
                      {L.assistantSubtitle}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {messages.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                      title={L.clearHistory}
                      aria-label={L.clearHistory}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    title={L.close}
                    aria-label={L.close}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* ─── Messages Area ──────────────────────────────────────────── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto tf-scroll px-4 py-5 space-y-5 bg-muted/30">
              {messages.length === 0 && showSuggestions ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  {/* Welcome card */}
                  <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/50">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 shadow-md">
                        <Lightbulb className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <h3 className="font-bold text-sm text-foreground leading-tight">
                          {L.welcome}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
                          {L.welcomeDesc}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 px-1">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        {L.quickActions}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {QUICK_ACTIONS.map((action, idx) => {
                        const Icon = action.icon;
                        const title = isAr ? action.titleAr : action.titleEn;
                        const desc = isAr ? action.descAr : action.descEn;
                        return (
                          <button
                            key={action.id}
                            onClick={() => void send(action.prompt)}
                            className={cn(
                              "group flex items-center gap-3 rounded-xl bg-card p-3 text-start",
                              "ring-1 ring-border/50",
                              "transition-all duration-200",
                              "hover:ring-primary/30 hover:shadow-md hover:-translate-y-0.5",
                              "active:translate-y-0 active:scale-[0.98]",
                            )}
                            style={{ animationDelay: `${idx * 50}ms` }}
                          >
                            <div className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                              "bg-gradient-to-br shadow-sm",
                              action.accent,
                              "transition-transform duration-200 group-hover:scale-110",
                            )}>
                              <Icon className="h-5 w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-foreground leading-tight">{title}</div>
                              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
                                {desc}
                              </div>
                            </div>
                            <ArrowLeft className="h-4 w-4 text-muted-foreground/40 shrink-0 transition-all duration-200 group-hover:text-primary group-hover:-translate-x-1 rtl:rotate-180" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Suggested Questions */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        {L.suggestedQuestions}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => void send(q.prompt)}
                          className={cn(
                            "rounded-xl bg-card px-3 py-2.5 text-start text-xs font-medium",
                            "ring-1 ring-border/50 text-foreground/80",
                            "transition-all duration-200",
                            "hover:ring-primary/30 hover:bg-primary/5 hover:text-primary hover:shadow-sm",
                          )}
                        >
                          {isAr ? q.labelAr : q.labelEn}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* ─── Conversation messages ─────────────────────────────── */
                <div className="space-y-5">
                  {messages.map((msg, idx) => (
                    <div key={idx} className="space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                      <div
                        className={cn(
                          "flex gap-2.5 items-end",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        {/* Assistant avatar — GCC LAB logo */}
                        {msg.role === "assistant" && (
                          <div className="relative shrink-0">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover shadow-md ring-2 ring-background">
                              <Image
                                src="/gcclab-icon.png"
                                alt="GCC LAB"
                                width={20}
                                height={20}
                                className="h-5 w-5 shrink-0 object-contain rounded-full"
                              />
                            </div>
                          </div>
                        )}

                        {/* Message bubble */}
                        <div
                          className={cn(
                            "px-4 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed",
                            msg.role === "user"
                              ? "bg-gradient-to-br from-primary to-primary-hover text-primary-foreground rounded-2xl rounded-br-md shadow-md max-w-[78%] font-medium"
                              : "bg-card text-card-foreground rounded-2xl rounded-bl-md shadow-sm ring-1 ring-border/50 max-w-[78%]"
                          )}
                        >
                          {msg.content}
                        </div>

                        {/* User avatar — initials circle */}
                        {msg.role === "user" && (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground font-bold text-xs shadow-sm ring-2 ring-background">
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
                          <div className="ps-11.5" style={{ paddingLeft: "2.875rem" }}>
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
                          <div className="ps-11.5" style={{ paddingLeft: "2.875rem" }}>
                            <div className="rounded-xl bg-card p-3 text-xs text-muted-foreground flex items-center gap-2 ring-1 ring-border/50 shadow-sm">
                              <Loader2 className="h-3 w-3 animate-spin text-primary" />
                              {L.preparingAction}
                            </div>
                          </div>
                        )}
                    </div>
                  ))}

                  {/* ─── Typing indicator ─────────────────────────────────── */}
                  {loading && (
                    <div className="flex gap-2.5 items-end justify-start animate-in fade-in duration-200">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover shadow-md ring-2 ring-background">
                        <Image
                          src="/gcclab-icon.png"
                          alt="GCC LAB"
                          width={20}
                          height={20}
                          className="h-5 w-5 shrink-0 object-contain rounded-full"
                        />
                      </div>
                      <div className="bg-card rounded-2xl rounded-bl-md px-5 py-4 shadow-sm ring-1 ring-border/50">
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
            <div className="shrink-0 border-t bg-background p-3">
              <div className="flex items-end gap-2">
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
                    className="h-11 rounded-2xl pe-3 ps-4 text-sm bg-muted/50 border-border/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
                  />
                </div>
                <button
                  onClick={() => void send()}
                  disabled={loading || !input.trim()}
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                    "bg-gradient-to-br from-primary to-primary-hover text-primary-foreground",
                    "shadow-md transition-all duration-200",
                    "hover:scale-105 hover:shadow-lg",
                    "active:scale-95",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
                  )}
                  aria-label={L.send}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 rtl:-scale-x-100" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground text-center font-medium">
                {L.aiPowered}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
