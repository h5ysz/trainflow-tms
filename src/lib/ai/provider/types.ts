// ─────────────────────────────────────────────────────────────────────────────
// AI Provider Abstraction — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────
// This module defines the provider-agnostic interface that the copilot chat
// route (and future AI features) use to talk to any LLM backend.
//
// The chat route imports ONLY from this module + index.ts — it never imports
// a specific SDK. New providers can be added by implementing AIProvider and
// registering them in index.ts, without touching any route file.
//
// Design principles:
//   - Native fetch only — no SDK dependencies
//   - Environment-variable-based configuration
//   - The response shape matches what the chat route already expects
//   - Extensible: capabilities, streaming, tool calling, multimodal are
//     designed for future use but not required for Phase 1

// ─── Chat Messages ──────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * A single message in a chat conversation.
 *
 * `content` is a string for simple text (the common case). Future multimodal
 * support can use ContentPart[] — but Phase 1 only uses strings.
 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** For tool messages: the tool name. */
  name?: string;
  /** For tool messages: the tool call ID. */
  toolCallId?: string;
}

// ─── Request / Response ─────────────────────────────────────────────────────

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];

  // ─── Future capabilities (optional, provider may ignore) ──────────────
  /** Function/tool definitions the model can call. */
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  /** Request structured JSON output instead of free text. */
  responseFormat?: "text" | "json";
  /** JSON Schema for structured output (when responseFormat="json"). */
  jsonSchema?: Record<string, unknown>;
  /** Request streaming (if true, use chatStream() instead of chat()). */
  stream?: boolean;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResponse {
  /** The assistant's reply text. */
  content: string;
  /** Tool/function calls the model wants to make (future). */
  toolCalls?: ToolCall[];
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter";
  usage?: ChatUsage;
  /** Which model was actually used (for diagnostics). */
  model?: string;
  /** Provider's response ID (for rate-limit / debugging). */
  providerResponseId?: string;
}

// ─── Tool Calling (future) ──────────────────────────────────────────────────

export interface ToolFunction {
  name: string;
  description: string;
  /** JSON Schema describing the function's parameters. */
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunction;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

// ─── Streaming (future) ─────────────────────────────────────────────────────

export interface ChatStreamChunk {
  delta: string;
  toolCalls?: ToolCall[];
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter";
  usage?: ChatUsage;
}

// ─── Capabilities ───────────────────────────────────────────────────────────

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  imageUnderstanding: boolean;
  fileAnalysis: boolean;
  conversationMemory: boolean;
  tokenCounting: boolean;
}

// ─── Model Info (future) ────────────────────────────────────────────────────

export interface ProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: Partial<ProviderCapabilities>;
}

// ─── The Provider Interface ─────────────────────────────────────────────────

/**
 * A provider-agnostic AI interface.
 *
 * The chat route calls `provider.chat()` and gets back a `ChatResponse`.
 * It never knows or cares whether OpenAI, Anthropic, Azure, or NoOp is
 * serving the request.
 *
 * Phase 1 implements only `chat()`. The other methods are declared as
 * optional so future providers can add them without breaking the interface
 * or the chat route.
 */
export interface AIProvider {
  /** Human-readable provider name for logging/diagnostics. */
  readonly name: string;
  /** Which features this provider supports. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Standard chat completion — returns the full response at once.
   * This is the ONLY method the copilot chat route uses today.
   */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /**
   * Streaming chat completion — yields chunks as they arrive.
   * Future use: real-time typing animation. Throws if !capabilities.streaming.
   */
  chatStream?(request: ChatRequest): AsyncIterable<ChatStreamChunk>;

  /** Count tokens for a prompt (future: cost estimation). */
  countTokens?(messages: ChatMessage[]): Promise<number | null>;

  /** List available models (future: model picker UI). */
  listModels?(): Promise<ProviderModel[]>;
}

// ─── Error Handling ─────────────────────────────────────────────────────────

export type AIProviderErrorCode =
  | "NO_PROVIDER"
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "API_ERROR"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CAPABILITY_NOT_SUPPORTED"
  | "CONTENT_FILTERED";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly status: number;
  readonly providerName?: string;

  constructor(
    message: string,
    code: AIProviderErrorCode,
    status: number,
    providerName?: string,
  ) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.status = status;
    this.providerName = providerName;
  }
}
