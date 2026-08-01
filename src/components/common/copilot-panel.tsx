"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GCCLAB AI Copilot — Floating Side Panel (Phase 2: action-aware)
// ─────────────────────────────────────────────────────────────────────────────
// A floating button (bottom-right) that opens a professional AI chat panel.
// Available on every page. Respects the user's language (RTL/LTR) and theme.
// Conversation history is stored in localStorage.
//
// Phase 2 additions:
//   - Detects ACTION_PLAN responses from the chat endpoint and renders an
//     inline ActionPreviewCard. The user confirms/cancels before execution.
//   - The "Preparing Action..." → "Action Preview Card" → "Execution
//     progress" → "Completed"/"Failed" flow lives entirely inside the
//     chat thread.
//
// Uses dynamic import to avoid SSR issues with the I18nProvider — the panel
// only renders client-side after hydration.

import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, X, Send, Loader2, Trash2, Lightbulb } from "lucide-react";
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

const SUGGESTED_PROMPTS = [
  "Show today's sessions",
  "Which trainees failed?",
  "Show overdue invoices",
  "Revenue this month",
  "Show expiring certificates",
  "Upcoming sessions this week",
  // Phase 2 — action-oriented prompts
  "Show me schedule conflicts",
  "Find over-capacity sessions this week",
  "Suggest the best trainer for Electrical Safety next Sunday",
];

const STORAGE_KEY = "gcclab-copilot-history";

export function CopilotPanel() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
        content: locale === "ar" ? "عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى." : "Sorry, I couldn't process your request. Please try again.",
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

  return (
    <>
      {/* Floating Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 end-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105"
          aria-label="Open AI Copilot"
        >
          <Sparkles className="h-6 w-6" />
          <span className="absolute -top-1 -end-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/30 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-primary border-2 border-background" />
          </span>
        </button>
      )}

      {/* Side Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="relative flex h-full w-full max-w-md flex-col bg-background border-s shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">
                    {locale === "ar" ? "مساعد GCCLAB الذكي" : "GCCLAB AI Copilot"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {locale === "ar" ? "مساعدك الذكي للنظام" : "Your intelligent system assistant"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearHistory} title="Clear history">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && showSuggestions && (
                <div className="space-y-4">
                  {/* Welcome message */}
                  <div className="rounded-lg bg-muted/50 p-4 text-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="h-4 w-4 text-primary" />
                      <span className="font-medium">
                        {locale === "ar" ? "مرحباً! كيف يمكنني مساعدتك اليوم؟" : "Hello! How can I help you today?"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === "ar"
                        ? "اسألني عن الجلسات، المتدرِّبين، الفواتير، الشهادات، وأكثر."
                        : "Ask me about sessions, trainees, invoices, certificates, and more."}
                    </p>
                  </div>

                  {/* Suggested prompts */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {locale === "ar" ? "اقتراحات:" : "Suggested prompts:"}
                    </div>
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => void send(prompt)}
                        className="w-full rounded-lg border p-3 text-start text-sm hover:bg-muted/50 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx} className="space-y-2">
                  <div
                    className={cn(
                      "flex gap-2",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Sparkles className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
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
                        <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {locale === "ar" ? "جاري تحضير معاينة الإجراء..." : "Preparing action preview..."}
                        </div>
                      </div>
                    )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="border-t p-3 shrink-0">
              <div className="flex gap-2">
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
                  placeholder={locale === "ar" ? "اكتب رسالتك..." : "Type your message..."}
                  disabled={loading}
                  className="flex-1"
                />
                <Button
                  size="icon"
                  onClick={() => void send()}
                  disabled={loading || !input.trim()}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground text-center">
                {locale === "ar" ? "مدعوم بالذكاء الاصطناعي • يحترم صلاحياتك" : "AI-powered • Respects your permissions"}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
