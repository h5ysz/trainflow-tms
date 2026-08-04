"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GCC LAB AI Assistant — Floating Side Panel (Premium Enterprise Redesign)
// ─────────────────────────────────────────────────────────────────────────────
// A floating button (bottom-right) that opens a premium AI chat panel.
// Available on every page. Respects the user's language (RTL/LTR) and theme.
// Conversation history is stored in localStorage.
//
// Phase 2 (action-aware) functionality is fully preserved:
//   - Detects ACTION_PLAN responses from the chat endpoint and renders an
//     inline ActionPreviewCard. The user confirms/cancels before execution.
//   - The "Preparing Action..." → "Action Preview Card" → "Execution
//     progress" → "Completed"/"Failed" flow lives entirely inside the
//     chat thread.
//
// UI/UX redesign (no logic changes):
//   - Floating button: perfect circle with GCC LAB logo, soft shadow,
//     subtle glow, hover scale, pulse animation only when there's a
//     suggestion (i.e. when the panel is closed and has suggestions to show)
//   - Header: GCC LAB logo + "مساعد GCC LAB الذكي" + subtitle
//   - Quick Actions: 5 clickable cards
//   - Suggested Questions: 4 questions
//   - Conversation: user messages right, assistant left, typing animation,
//     loading dots, modern rounded chat bubbles
//   - Responsive: desktop side panel, tablet/mobile full-screen sheet
//
// Uses dynamic import to avoid SSR issues with the I18nProvider — the panel
// only renders client-side after hydration.

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X, Send, Loader2, Trash2, Lightbulb,
  ClipboardList, FileText, BarChart3, HelpCircle, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionPreviewCard, type PreviewResult, type ExecuteResult } from "./copilot/action-preview-card";

// Fallback locale detection — avoids useI18n dependency at the layout level
function useLocale(): string {
  const [locale, setLocale] = useState("en");
  useEffect(() => {
    const handle = setTimeout(() => {
      const stored = localStorage.getItem("gcclab-tms-store");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.state?.locale) setLocale(parsed.state.locale);
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
  // Phase 2: when the assistant returns an ACTION_PLAN, we attach the plan
  // + (after preview fetch) the preview + token. The ActionPreviewCard
  // renders inline below the message bubble.
  actionPlan?: {
    actionType: string;
    params: Record<string, unknown>;
    rationale: string;
  };
  preview?: PreviewResult;
  previewToken?: string;
  // Once the user confirms/cancels, we hide the action card.
  actionResolved?: boolean;
}

// ─── Quick Actions (5 enterprise shortcuts) ─────────────────────────────────
// Each maps to a pre-written prompt that the existing /copilot/chat endpoint
// understands. Clicking a card calls send(prompt) — same as a suggested prompt.
interface QuickAction {
  id: string;
  icon: LucideIcon;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "create-request",
    icon: ClipboardList,
    titleAr: "إنشاء طلب دورة",
    titleEn: "Create Course Request",
    descAr: "ابدأ طلب تدريب جديد",
    descEn: "Start a new training request",
    prompt: "Help me create a new training course request",
  },
  {
    id: "track-requests",
    icon: MessageSquare,
    titleAr: "متابعة الطلبات",
    titleEn: "Track Requests",
    descAr: "عرض حالة الطلبات الحالية",
    descEn: "View current request statuses",
    prompt: "Show me the status of my recent training requests",
  },
  {
    id: "create-report",
    icon: FileText,
    titleAr: "إنشاء تقرير",
    titleEn: "Generate Report",
    descAr: "إنشاء تقرير تفصيلي",
    descEn: "Generate a detailed report",
    prompt: "Generate a summary report of training activities",
  },
  {
    id: "analyze-data",
    icon: BarChart3,
    titleAr: "تحليل البيانات",
    titleEn: "Analyze Data",
    descAr: "رؤى وإحصائيات",
    descEn: "Insights and statistics",
    prompt: "Analyze training data and show key insights",
  },
  {
    id: "help",
    icon: HelpCircle,
    titleAr: "المساعدة",
    titleEn: "Help",
    descAr: "دليل استخدام النظام",
    descEn: "System usage guide",
    prompt: "How do I use the GCC LAB training management system?",
  },
];

// ─── Suggested Questions (4 FAQ-style prompts) ──────────────────────────────
// Bilingual. The user-facing label is localized; the prompt sent to the API
// is in English (the LLM handles both languages, but the existing analytical
// prompts were English, so we keep the same convention).
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

// Legacy analytical prompts (e.g. "Show today's sessions", "Which trainees
// failed?") were previously shown in the welcome screen. They have been
// replaced by the Quick Actions + Suggested Questions above for a cleaner
// enterprise UX. The LLM still understands them if a user types them
// manually — no API change is needed.

const STORAGE_KEY = "gcclab-copilot-history";

export function CopilotPanel() {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Whether to pulse the floating button — only when closed AND there are
  // suggestions to show (i.e. no conversation yet, or history cleared).
  // This is a soft attention cue, not a notification badge.
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-50))); // keep last 50
    } catch { /* ignore */ }
  }, []);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
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

      // Phase 2: if the assistant proposed an action, fetch the preview
      // automatically so the user can review + confirm.
      if (res.kind === "ACTION_PLAN" && res.action) {
        try {
          const previewRes = await api.post<{ preview: PreviewResult; previewToken: string }>(
            "/copilot/actions/preview",
            { actionType: res.action.actionType, params: res.action.params }
          );
          // Attach the preview to the same assistant message
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
          // Persist the preview so a reload doesn't lose it
          saveHistory(updatedWithPreview);
        } catch (e) {
          // Preview failed — replace the action plan with an error message
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

  // Phase 2: handle action card dismissal / execution result
  const handleActionResolved = (idx: number, result: ExecuteResult | null) => {
    setMessages((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = {
          ...next[idx],
          actionResolved: true,
          // If execution succeeded, append the result text as part of the
          // assistant message so the user can see what happened.
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

  // ─── Localized labels ────────────────────────────────────────────────────
  const L = {
    assistantTitle: isAr ? "مساعد GCC LAB الذكي" : "GCC LAB AI Assistant",
    assistantSubtitle: isAr ? "جاهز لمساعدتك في إدارة التدريب" : "Ready to help you manage training",
    welcome: isAr ? "مرحباً! كيف يمكنني مساعدتك اليوم؟" : "Hello! How can I help you today?",
    welcomeDesc: isAr
      ? "اسألني عن الجلسات، المتدرِّبين، الفواتير، الشهادات، وأكثر."
      : "Ask me about sessions, trainees, invoices, certificates, and more.",
    quickActions: isAr ? "إجراءات سريعة" : "Quick Actions",
    suggestedQuestions: isAr ? "أسئلة مقترحة" : "Suggested Questions",
    typeMessage: isAr ? "اكتب رسالتك..." : "Type your message...",
    aiPowered: isAr ? "مدعوم بالذكاء الاصطناعي • يحترم صلاحياتك" : "AI-powered • Respects your permissions",
    clearHistory: isAr ? "مسح المحادثة" : "Clear history",
    close: isAr ? "إغلاق" : "Close",
    openAssistant: isAr ? "افتح مساعد GCC LAB" : "Open GCC LAB Assistant",
    preparingAction: isAr ? "جاري تحضير معاينة الإجراء..." : "Preparing action preview...",
  };

  return (
    <>
      {/* ─── Floating Button ────────────────────────────────────────────────
          Perfect circle (1:1) with GCC LAB logo, soft shadow, subtle glow.
          Hover: scale + glow intensify. Pulse only when shouldPulse=true. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-6 end-6 z-50 flex h-14 w-14 items-center justify-center rounded-full",
            "bg-gradient-to-br from-primary to-primary-hover text-primary-foreground",
            "shadow-[0_8px_24px_-4px_rgba(0,0,0,0.25),0_0_0_1px_rgba(255,255,255,0.08)]",
            "ring-2 ring-primary/20",
            "transition-all duration-300 ease-out",
            "hover:scale-110 hover:shadow-[0_12px_32px_-4px_rgba(0,0,0,0.35),0_0_24px_rgba(59,130,246,0.25)]",
            "hover:ring-primary/40",
            "active:scale-95",
            "group relative overflow-hidden",
          )}
          aria-label={L.openAssistant}
        >
          {/* Subtle inner glow ring on hover */}
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-white/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          {/* GCC LAB logo — replaces the generic Sparkles icon */}
          <Image
            src="/gcclab-icon.png"
            alt="GCC LAB"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 object-contain rounded-full"
            priority
          />

          {/* Pulse animation — only when there's a suggestion to show.
              Uses a softer, slower ping than the default animate-ping. */}
          {shouldPulse && (
            <span className="pointer-events-none absolute inset-0 rounded-full">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40 opacity-60" style={{ animationDuration: "2.5s" }} />
            </span>
          )}
        </button>
      )}

      {/* ─── Side Panel / Full-screen Sheet (responsive) ───────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
          />

          {/* Panel — full-width on mobile/tablet, max-w-md on desktop */}
          <div
            className={cn(
              "relative flex h-full flex-col bg-background shadow-2xl animate-in slide-in-from-right duration-300",
              "w-full max-w-md",
              // Subtle top accent bar in GCC LAB brand color
              "border-s",
            )}
          >
            {/* ─── Header — GCC LAB Logo + Title + Subtitle ─────────────────── */}
            <div className="flex items-center justify-between border-b bg-gradient-to-r from-primary/5 to-transparent p-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {/* GCC LAB Logo in a branded chip */}
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-hover shadow-md ring-1 ring-primary/20">
                  <Image
                    src="/gcclab-icon.png"
                    alt="GCC LAB"
                    width={26}
                    height={26}
                    className="h-6 w-6 shrink-0 object-contain rounded-md"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold leading-tight tracking-tight truncate">
                    {L.assistantTitle}
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight truncate">
                    {L.assistantSubtitle}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={clearHistory}
                    title={L.clearHistory}
                    aria-label={L.clearHistory}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setOpen(false)}
                  title={L.close}
                  aria-label={L.close}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* ─── Messages Area ─────────────────────────────────────────────── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto tf-scroll p-4 space-y-4">
              {messages.length === 0 && showSuggestions && (
                <div className="space-y-5">
                  {/* Welcome message */}
                  <div className="rounded-2xl bg-gradient-to-br from-muted/60 to-muted/30 p-4 ring-1 ring-border/50">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Lightbulb className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-sm">
                        {L.welcome}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed ps-9">
                      {L.welcomeDesc}
                    </p>
                  </div>

                  {/* ─── Quick Actions (5 cards) ───────────────────────────── */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {L.quickActions}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {QUICK_ACTIONS.map((action) => {
                        const Icon = action.icon;
                        const title = isAr ? action.titleAr : action.titleEn;
                        const desc = isAr ? action.descAr : action.descEn;
                        return (
                          <button
                            key={action.id}
                            onClick={() => void send(action.prompt)}
                            className={cn(
                              "group flex items-center gap-3 rounded-xl border bg-card p-3 text-start",
                              "transition-all duration-200",
                              "hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm",
                              "active:scale-[0.98]",
                            )}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium leading-tight">{title}</div>
                              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
                                {desc}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ─── Suggested Questions (4 questions) ─────────────────── */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {L.suggestedQuestions}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => void send(q.prompt)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-start text-sm",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                            "transition-colors",
                          )}
                        >
                          <span className="h-1 w-1 rounded-full bg-primary/60 shrink-0" />
                          <span className="truncate">{isAr ? q.labelAr : q.labelEn}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Conversation messages ─────────────────────────────────── */}
              {messages.map((msg, idx) => (
                <div key={idx} className="space-y-2">
                  <div
                    className={cn(
                      "flex gap-2 items-end",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {/* Assistant avatar — GCC LAB mini logo */}
                    {msg.role === "assistant" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover shadow-sm ring-1 ring-primary/20">
                        <Image
                          src="/gcclab-icon.png"
                          alt="GCC LAB"
                          width={18}
                          height={18}
                          className="h-[18px] w-[18px] shrink-0 object-contain rounded-full"
                        />
                      </div>
                    )}
                    <div
                      className={cn(
                        "px-4 py-2.5 text-sm whitespace-pre-wrap break-words",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md shadow-sm max-w-[80%]"
                          : "bg-muted rounded-2xl rounded-bl-md max-w-[80%]"
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>

                  {/* Phase 2: Action Preview Card (only when preview is ready
                      and the user hasn't yet confirmed/cancelled). */}
                  {msg.role === "assistant"
                    && msg.preview
                    && msg.previewToken
                    && !msg.actionResolved
                    && (
                      <div className="ps-10">
                        <ActionPreviewCard
                          preview={msg.preview}
                          previewToken={msg.previewToken}
                          locale={locale as "en" | "ar"}
                          onDismiss={() => handleActionResolved(idx, null)}
                          onExecuted={(result) => handleActionResolved(idx, result)}
                        />
                      </div>
                    )}

                  {/* Phase 2: while the preview is being fetched (actionPlan
                      set, but no preview yet), show a small loading hint. */}
                  {msg.role === "assistant"
                    && msg.actionPlan
                    && !msg.preview
                    && !msg.actionResolved
                    && (
                      <div className="ps-10">
                        <div className="rounded-xl border bg-card p-3 text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {L.preparingAction}
                        </div>
                      </div>
                    )}
                </div>
              ))}

              {/* ─── Loading indicator (typing animation) ───────────────────── */}
              {loading && (
                <div className="flex gap-2 items-end justify-start">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover shadow-sm ring-1 ring-primary/20">
                    <Image
                      src="/gcclab-icon.png"
                      alt="GCC LAB"
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] shrink-0 object-contain rounded-full"
                    />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    {/* Three-dot typing animation */}
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1s" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1s" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ─── Input Area ──────────────────────────────────────────────── */}
            <div className="border-t bg-background p-3 shrink-0">
              <div className="flex gap-2 items-end">
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
                  className="flex-1 rounded-xl"
                />
                <Button
                  size="icon"
                  onClick={() => void send()}
                  disabled={loading || !input.trim()}
                  className="rounded-xl shrink-0"
                  aria-label={isAr ? "إرسال" : "Send"}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground text-center">
                {L.aiPowered}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
