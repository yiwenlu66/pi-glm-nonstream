/**
 * GLM-5.2 Non-Streaming Provider Extension
 *
 * Wraps an OpenAI-compatible Chat Completions API with stream: false,
 * converting the single-shot response into Pi's AssistantMessageEventStream.
 *
 * Configuration via environment variables (see README).
 * Defaults work with micuapi.ai out of the box.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type ImageContent,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
} from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

function sanitize(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

function convertMessages(
  messages: Context["messages"],
  systemPrompt: string | undefined,
  isReasoning: boolean,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  if (systemPrompt) {
    out.push({ role: "system", content: sanitize(systemPrompt) });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content.length > 0) {
          out.push({ role: "user", content: sanitize(msg.content) });
        }
      } else {
        const parts = msg.content
          .map((c) => {
            if (c.type === "text") return { type: "text" as const, text: sanitize(c.text) };
            if (c.type === "image")
              return {
                type: "image_url" as const,
                image_url: { url: `data:${c.mimeType};base64,${c.data}` },
              };
            return null;
          })
          .filter(Boolean);
        if (parts.length > 0) {
          out.push({ role: "user", content: parts as any });
        }
      }
    } else if (msg.role === "assistant") {
      const textParts = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .filter((t) => t.trim().length > 0);

      const thinkingBlocks = msg.content.filter(
        (c): c is ThinkingContent => c.type === "thinking" && c.thinking.trim().length > 0,
      );

      const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");

      const assistantMsg: OpenAIMessage = { role: "assistant" };

      // Text content
      if (textParts.length > 0) {
        assistantMsg.content = sanitize(textParts.join(""));
      } else {
        assistantMsg.content = null;
      }

      // Thinking → reasoning_content
      if (thinkingBlocks.length > 0 && isReasoning) {
        assistantMsg.reasoning_content = thinkingBlocks.map((t) => sanitize(t.thinking)).join("\n");
        // Some providers need reasoning_content even when empty
      } else if (isReasoning && toolCalls.length > 0) {
        assistantMsg.reasoning_content = "";
      }

      // Tool calls
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      // Skip empty assistant messages
      const hasContent =
        assistantMsg.content !== null &&
        assistantMsg.content !== undefined &&
        (typeof assistantMsg.content === "string"
          ? assistantMsg.content.length > 0
          : (assistantMsg.content as any[]).length > 0);
      if (!hasContent && !assistantMsg.tool_calls) continue;

      out.push(assistantMsg);
    } else if (msg.role === "toolResult") {
      const textResult = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      const toolMsg: OpenAIMessage = {
        role: "tool",
        content: sanitize(textResult || "(empty result)"),
        tool_call_id: msg.toolCallId,
      };

      if (msg.toolName) {
        toolMsg.name = msg.toolName;
      }

      out.push(toolMsg);

      // Handle images in tool results
      const images = msg.content.filter((c): c is ImageContent => c.type === "image");
      if (images.length > 0) {
        out.push({
          role: "user",
          content: [
            { type: "text", text: "Attached image(s) from tool result:" },
            ...images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Non-streaming provider
// ---------------------------------------------------------------------------

function streamGLMNonstreaming(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const apiKey = options?.apiKey;
      if (!apiKey) throw new Error("No API key configured");

      const messages = convertMessages(context.messages, context.systemPrompt, model.reasoning);

      // Build request body
      const body: Record<string, unknown> = {
        model: model.id,
        messages,
        stream: false,
        max_tokens: options?.maxTokens || model.maxTokens || 4096,
      };

      // Tools
      if (context.tools && context.tools.length > 0) {
        body.tools = context.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      // Temperature
      if (options?.temperature !== undefined) {
        body.temperature = options.temperature;
      }

      // Thinking (ZAI format: enable_thinking)
      if (options?.reasoning && model.reasoning) {
        body.enable_thinking = true;
      }

      stream.push({ type: "start", partial: output });

      // --- Non-streaming API call ---
      const response = await fetch(`${model.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`API ${response.status}: ${errorText.slice(0, 500)}`);
      }

      const data = (await response.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        choices?: Array<{
          finish_reason?: string;
          message?: {
            content?: string | null;
            reasoning_content?: string;
            tool_calls?: Array<{
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };

      // Usage
      if (data.usage) {
        output.usage.input = data.usage.prompt_tokens || 0;
        output.usage.output = data.usage.completion_tokens || 0;
        output.usage.totalTokens = data.usage.total_tokens || 0;
        calculateCost(model, output.usage);
      }

      const choice = data.choices?.[0];
      if (!choice) throw new Error("No choices in response");

      // Stop reason
      switch (choice.finish_reason) {
        case "stop":
          output.stopReason = "stop";
          break;
        case "length":
          output.stopReason = "length";
          break;
        case "tool_calls":
        case "function_call":
          output.stopReason = "toolUse";
          break;
        default:
          output.stopReason = "stop";
      }

      const msg = choice.message;
      if (!msg) throw new Error("No message in response");

      // --- Reasoning / thinking content ---
      if (msg.reasoning_content && msg.reasoning_content.length > 0) {
        output.content.push({
          type: "thinking",
          thinking: msg.reasoning_content,
        });
        const ci = output.content.length - 1;
        stream.push({ type: "thinking_start", contentIndex: ci, partial: output });
        stream.push({
          type: "thinking_delta",
          contentIndex: ci,
          delta: msg.reasoning_content,
          partial: output,
        });
        stream.push({
          type: "thinking_end",
          contentIndex: ci,
          content: msg.reasoning_content,
          partial: output,
        });
      }

      // --- Text content ---
      if (msg.content) {
        output.content.push({ type: "text", text: msg.content });
        const ci = output.content.length - 1;
        stream.push({ type: "text_start", contentIndex: ci, partial: output });
        stream.push({ type: "text_delta", contentIndex: ci, delta: msg.content, partial: output });
        stream.push({ type: "text_end", contentIndex: ci, content: msg.content, partial: output });
      }

      // --- Tool calls ---
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const id = tc.id || "";
          const name = tc.function?.name || "";
          let args: Record<string, unknown> = {};
          const rawArgs = tc.function?.arguments || "{}";
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = {};
          }

          const toolBlock: ToolCall = {
            type: "toolCall",
            id,
            name,
            arguments: args,
          };
          output.content.push(toolBlock);
          const ci = output.content.length - 1;

          stream.push({ type: "toolcall_start", contentIndex: ci, partial: output });
          stream.push({ type: "toolcall_delta", contentIndex: ci, delta: rawArgs, partial: output });
          stream.push({ type: "toolcall_end", contentIndex: ci, toolCall: toolBlock, partial: output });
        }
      }

      // Check for abort
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      stream.push({
        type: "done",
        reason: output.stopReason as "stop" | "length" | "toolUse",
        message: output,
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

// All configuration via environment variables. Nothing hard-coded.
const PROVIDER_NAME = process.env.GLM_NONSTREAM_PROVIDER || "glm-nonstream";
const BASE_URL = process.env.GLM_NONSTREAM_BASE_URL || "https://www.micuapi.ai/v1";
const API_KEY = process.env.GLM_NONSTREAM_API_KEY || "$OCC_API_KEY";
const MODEL_ID = process.env.GLM_NONSTREAM_MODEL || "glm-5.2";
const MODEL_NAME = process.env.GLM_NONSTREAM_MODEL_NAME || `GLM-5.2 (non-stream)`;
const CONTEXT_WINDOW = parseInt(process.env.GLM_NONSTREAM_CONTEXT || "1000000", 10);
const MAX_TOKENS = parseInt(process.env.GLM_NONSTREAM_MAX_TOKENS || "131072", 10);

export default function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_NAME, {
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    api: PROVIDER_NAME,
    models: [
      {
        id: MODEL_ID,
        name: MODEL_NAME,
        reasoning: true,
        input: ["text"] as const,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: CONTEXT_WINDOW,
        maxTokens: MAX_TOKENS,
        thinkingLevelMap: {
          minimal: null,
          low: null,
          medium: null,
          high: "high",
          xhigh: "max",
        },
      },
    ],
    streamSimple: streamGLMNonstreaming,
  });
}
