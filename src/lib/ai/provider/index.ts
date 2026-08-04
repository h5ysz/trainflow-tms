// ─────────────────────────────────────────────────────────────────────────────
// AI Provider Factory — selects the active provider based on environment
// ─────────────────────────────────────────────────────────────────────────────
// The chat route calls getAIProvider() and gets back an AIProvider instance.
// It never knows or cares which provider is active.
//
// Selection logic (priority order):
//   1. OpenAI     — if OPENAI_API_KEY is set
//   2. NoOp       — always available as fallback
//
// Future providers (Anthropic, Azure, Gemini) will be added here in priority
// order before OpenAI. The chat route won't need to change — only this file.
//
// The provider instance is cached for the process lifetime. Env var changes
// require a restart (consistent with how JWT_SECRET and other secrets work).

import type { AIProvider } from "./types";
import { OpenAIProvider } from "./openai";
import { NoOpProvider } from "./noop";

let cachedProvider: AIProvider | null = null;

/**
 * Returns the active AI provider.
 *
 * Priority:
 *   1. OpenAI (if OPENAI_API_KEY is set)
 *   2. NoOp (fallback — returns a "not configured" message)
 *
 * The result is cached. Subsequent calls return the same instance.
 */
export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = detectProvider();
  return cachedProvider;
}

function detectProvider(): AIProvider {
  // 1. OpenAI (highest priority)
  if (process.env.OPENAI_API_KEY) {
    try {
      return new OpenAIProvider();
    } catch (err) {
      // Constructor threw (e.g. CONFIG_MISSING) — fall through to NoOp
      console.error("[ai-provider] OpenAI provider init failed, falling back to NoOp:", err);
    }
  }

  // 2. NoOp fallback (always available)
  return new NoOpProvider();
}

// ─── For testing: reset the cache ───────────────────────────────────────────
/**
 * Clears the cached provider. Only for tests that need to simulate
 * different env-var configurations.
 */
export function _resetProviderCache(): void {
  cachedProvider = null;
}

// Re-export the types so consumers can import everything from one place
export type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ChatUsage,
  ChatStreamChunk,
  ToolDefinition,
  ToolCall,
  ProviderCapabilities,
  ProviderModel,
} from "./types";
export { AIProviderError } from "./types";
