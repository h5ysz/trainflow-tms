// ─────────────────────────────────────────────────────────────────────────────
// Google Gemini Provider — production-ready, native fetch, no SDK dependency
// ─────────────────────────────────────────────────────────────────────────────
// Talks to the Google Gemini API (generativelanguage.googleapis.com) using
// the v1beta generateContent endpoint.
//
// Configuration (env vars):
//   GEMINI_API_KEY   — required
//   GEMINI_MODEL     — optional (default: gemini-2.5-flash)
//
// The provider is selected automatically by the factory (index.ts) when
// GEMINI_API_KEY is present in the environment.

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ChatUsage,
  ProviderCapabilities,
} from "./types";
import { AIProviderError } from "./types";

const GEMINI_CAPABILITIES: ProviderCapabilities = {
  streaming: true, // supported by the API, but chatStream() not implemented in this phase
  toolCalling: true,
  structuredOutput: true,
  imageUnderstanding: true,
  fileAnalysis: true,
  conversationMemory: false,
  tokenCounting: false,
};

// ─── Gemini API types (mirrors of the Gemini REST API shapes) ───────────────

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content: {
    role: "model";
    parts: GeminiPart[];
  };
  finishReason: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly capabilities = GEMINI_CAPABILITIES;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AIProviderError(
        "GEMINI_API_KEY is not set",
        "CONFIG_MISSING",
        500,
        "gemini",
      );
    }
    this.apiKey = apiKey;
    this.model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Map our ChatMessage[] → Gemini's expected shape.
    // Gemini uses "user" and "model" roles (not "assistant").
    // System messages are mapped to the systemInstruction field.
    const systemMessages: string[] = [];
    const contents: GeminiContent[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemMessages.push(msg.content);
      } else if (msg.role === "user") {
        contents.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (msg.role === "assistant") {
        contents.push({ role: "model", parts: [{ text: msg.content }] });
      }
      // "tool" role messages are ignored for now (future capability)
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.5,
        maxOutputTokens: request.maxTokens ?? 2000,
        ...(request.topP !== undefined && { topP: request.topP }),
        ...(request.stop !== undefined && { stopSequences: Array.isArray(request.stop) ? request.stop : [request.stop] }),
      },
    };

    // System instruction (Gemini's equivalent of system messages)
    if (systemMessages.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemMessages.join("\n\n") }],
      };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AIProviderError(
        `Network error contacting Gemini API: ${(err as Error).message}`,
        "TIMEOUT",
        503,
        "gemini",
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no response body)");

      if (response.status === 400 || response.status === 403) {
        throw new AIProviderError(
          `Gemini API authentication/permission failed (${response.status}): ${errorBody}`,
          "AUTH_FAILED",
          response.status,
          "gemini",
        );
      }

      if (response.status === 429) {
        throw new AIProviderError(
          `Gemini API rate limit exceeded: ${errorBody}`,
          "RATE_LIMITED",
          response.status,
          "gemini",
        );
      }

      throw new AIProviderError(
        `Gemini API error (${response.status}): ${errorBody}`,
        "API_ERROR",
        response.status,
        "gemini",
      );
    }

    let data: GeminiResponse;
    try {
      data = (await response.json()) as GeminiResponse;
    } catch (err) {
      throw new AIProviderError(
        `Failed to parse Gemini response as JSON: ${(err as Error).message}`,
        "API_ERROR",
        502,
        "gemini",
      );
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new AIProviderError(
        "Gemini returned no candidates in the response",
        "API_ERROR",
        502,
        "gemini",
      );
    }

    const content = candidate.content?.parts?.map((p) => p.text).join("") ?? "";
    const finishReason = mapFinishReason(candidate.finishReason);

    const usage: ChatUsage | undefined = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined;

    return {
      content,
      finishReason,
      usage,
      model: this.model,
    };
  }
}

function mapFinishReason(reason: string): ChatResponse["finishReason"] {
  switch (reason?.toUpperCase()) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    default:
      return "stop";
  }
}
