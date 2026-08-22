// ─────────────────────────────────────────────────────────────────────────────
// NoOp Provider — graceful fallback when no AI provider is configured
// ─────────────────────────────────────────────────────────────────────────────
// Returns a localized "not configured" message instead of crashing.
// The chat route still returns HTTP 200 with this message — the frontend
// displays it in the chat bubble, so the user understands why the AI
// isn't responding.
//
// This provider has no capabilities and makes no network calls. It's the
// safest default — the app never crashes due to missing AI configuration.

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ProviderCapabilities,
} from "./types";

const NOOP_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  toolCalling: false,
  structuredOutput: false,
  imageUnderstanding: false,
  fileAnalysis: false,
  conversationMemory: false,
  tokenCounting: false,
};

export class NoOpProvider implements AIProvider {
  readonly name = "noop";
  readonly capabilities = NOOP_CAPABILITIES;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    let hint: string;
    if (!hasGemini && !hasOpenAI) {
      hint = "No AI API keys found. Set GEMINI_API_KEY (preferred) or OPENAI_API_KEY in your environment (Render Dashboard → Environment).";
    } else if (!hasGemini && hasOpenAI) {
      hint = "GEMINI_API_KEY is not set. The OpenAI fallback also failed. Set GEMINI_API_KEY in your environment.";
    } else {
      hint = "AI provider initialization failed. Check server logs for details.";
    }
    return {
      content: hint,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "noop",
    };
  }
}
