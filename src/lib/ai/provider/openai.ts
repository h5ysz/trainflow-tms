// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Provider — production-ready, native fetch, no SDK dependency
// ─────────────────────────────────────────────────────────────────────────────
// Talks to any OpenAI-compatible API (OpenAI, Azure OpenAI via direct endpoint,
// LM Studio, Ollama OpenAI compatibility, etc.) using the standard
// /v1/chat/completions endpoint.
//
// Configuration (env vars):
//   OPENAI_API_KEY    — required (sk-...)
//   OPENAI_MODEL      — optional (default: gpt-4o-mini)
//   OPENAI_BASE_URL   — optional (default: https://api.openai.com/v1)
//
// The provider is selected automatically by the factory (index.ts) when
// OPENAI_API_KEY is present in the environment.

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ChatUsage,
  ProviderCapabilities,
} from "./types";
import { AIProviderError } from "./types";

const OPENAI_CAPABILITIES: ProviderCapabilities = {
  streaming: true, // supported, but chatStream() not implemented in Phase 1
  toolCalling: true,
  structuredOutput: true,
  imageUnderstanding: true,
  fileAnalysis: true,
  conversationMemory: false,
  tokenCounting: false,
};

// ─── OpenAI API types (mirrors of the OpenAI REST API shapes) ───────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

interface OpenAIChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string | null;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly capabilities = OPENAI_CAPABILITIES;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AIProviderError(
        "OPENAI_API_KEY is not set",
        "CONFIG_MISSING",
        500,
        "openai",
      );
    }
    this.apiKey = apiKey;
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    // Strip trailing slash so we don't get double slashes in the URL
    this.baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    // Map our ChatMessage[] → OpenAI's expected shape
    const messages: OpenAIMessage[] = request.messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
      ...(m.name && { name: m.name }),
      ...(m.toolCallId && { tool_call_id: m.toolCallId }),
    }));

    // Model override per request (question generator pins a specific model),
    // falling back to the provider-wide OPENAI_MODEL when not provided.
    const model = request.model ?? this.model;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.5,
      max_tokens: request.maxTokens ?? 2000,
    };

    // Optional parameters — only send if provided
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stop !== undefined) body.stop = request.stop;

    // Structured output (future)
    if (request.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    // Tool calling (future)
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      if (request.toolChoice) {
        body.tool_choice = request.toolChoice;
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      const msg = (err as Error).message?.toLowerCase() ?? "";
      if (msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out")) {
        throw new AIProviderError(
          "OpenAI API request timed out after 90 seconds",
          "TIMEOUT",
          504,
          "openai",
        );
      }
      // Network-level failure (DNS, connection refused, timeout)
      throw new AIProviderError(
        `Network error contacting OpenAI API: ${(err as Error).message}`,
        "TIMEOUT",
        503,
        "openai",
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no response body)");

      if (response.status === 401 || response.status === 403) {
        throw new AIProviderError(
          `OpenAI API authentication failed (${response.status}): ${errorBody}`,
          "AUTH_FAILED",
          response.status,
          "openai",
        );
      }

      if (response.status === 429) {
        throw new AIProviderError(
          `OpenAI API rate limit exceeded: ${errorBody}`,
          "RATE_LIMITED",
          response.status,
          "openai",
        );
      }

      throw new AIProviderError(
        `OpenAI API error (${response.status}): ${errorBody}`,
        "API_ERROR",
        response.status,
        "openai",
      );
    }

    let data: OpenAIResponse;
    try {
      data = (await response.json()) as OpenAIResponse;
    } catch (err) {
      throw new AIProviderError(
        `Failed to parse OpenAI response as JSON: ${(err as Error).message}`,
        "API_ERROR",
        502,
        "openai",
      );
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new AIProviderError(
        "OpenAI returned no choices in the response",
        "API_ERROR",
        502,
        "openai",
      );
    }

    const content = choice.message?.content ?? "";
    const finishReason = mapFinishReason(choice.finish_reason);

    const usage: ChatUsage | undefined = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined;

    // Map tool calls if present (future)
    const toolCalls = choice.message?.tool_calls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      content,
      finishReason,
      usage,
      model: data.model,
      providerResponseId: data.id,
      ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
    };
  }
}

function mapFinishReason(
  reason: string | null,
): ChatResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}
