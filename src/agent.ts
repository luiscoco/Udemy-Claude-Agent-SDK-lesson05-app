import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const WORKSPACE = fileURLToPath(new URL("../sample-workspace/", import.meta.url));
export const DEFAULT_PROMPT = "Read message-guide.md, then explain the five core SDK message types in five short bullet points.";
export type Config = { scenario: "read" | "limit"; partial: boolean };
export const DEFAULT_CONFIG: Config = { scenario: "read", partial: true };
export type ToolPair = { id: string; name: string; state: "requested" | "completed" | "error"; requestedAt: number; elapsedMs?: number };
export type Outcome = { subtype: string; is_error: boolean; text: string; session_id: string; num_turns: number; total_cost_usd: number; duration_ms: number; duration_api_ms: number; stop_reason: string | null; usage: Record<string, number>; modelUsage: Record<string, Record<string, number>>; permission_denials: { tool_name: string; tool_use_id: string }[] };
export type MessageRow = { type: "message"; sequence: number; sdkType: string; subtype: string; summary: string; data: Record<string, unknown>; counts: Record<string, number>; pairs: ToolPair[]; textDelta?: string; textBlock?: string; outcome?: Outcome };
export type LabEvent = MessageRow | { type: "notice" | "error"; text: string } | { type: "config"; options: Config };

export function validatePrompt(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2000) throw new Error("Enter a prompt of 1–2,000 characters.");
  return value.trim();
}
export function validateConfig(value: unknown): Config {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) throw new Error("Options must be an object.");
  const config = { ...DEFAULT_CONFIG, ...(value as Partial<Config>) };
  if (!["read", "limit"].includes(config.scenario) || typeof config.partial !== "boolean") throw new Error("Choose a scenario and a boolean partial-message setting.");
  return { scenario: config.scenario, partial: config.partial };
}
export function redact(text: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  return (key ? text.split(key).join("[REDACTED]") : text).replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, "[REDACTED]").slice(0, 18000);
}
function numbers(value: object): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
}
export function resultFields(message: SDKResultMessage): Outcome {
  return {
    subtype: message.subtype, is_error: message.is_error,
    text: redact(message.subtype === "success" ? message.result : message.errors.join("\n")),
    session_id: message.session_id, num_turns: message.num_turns,
    total_cost_usd: message.total_cost_usd, duration_ms: message.duration_ms, duration_api_ms: message.duration_api_ms,
    stop_reason: message.stop_reason, usage: numbers(message.usage),
    modelUsage: Object.fromEntries(Object.entries(message.modelUsage || {}).map(([name, value]) => [name, numbers(value)])),
    permission_denials: (message.permission_denials || []).map((d) => ({ tool_name: d.tool_name, tool_use_id: d.tool_use_id })),
  };
}
export class MessageInspector {
  sequence = 0;
  counts: Record<string, number> = {};
  pairs = new Map<string, ToolPair>();
  constructor(private now = () => Date.now()) {}
  consume(message: SDKMessage): MessageRow {
    this.counts[message.type] = (this.counts[message.type] || 0) + 1;
    const subtype = "subtype" in message ? String(message.subtype) : "";
    const row: MessageRow = { type: "message", sequence: ++this.sequence, sdkType: message.type, subtype, summary: "Additional observability event", data: { type: message.type, subtype, session_id: message.session_id, uuid: message.uuid }, counts: { ...this.counts }, pairs: [] };
    switch (message.type) {
      case "system": {
        row.summary = `Session lifecycle: ${subtype}`;
        if (message.subtype === "init") {
          row.data = { ...row.data, model: message.model, cwd: "sample-workspace", tools: message.tools, permissionMode: message.permissionMode, apiKeySource: message.apiKeySource, claude_code_version: message.claude_code_version, mcp_servers: message.mcp_servers.map((m) => ({ name: m.name, status: m.status })), skills: message.skills, slash_commands: message.slash_commands };
        }
        // Other system subtypes are distinct union members; do not read init-only fields.
        break;
      }
      case "assistant": {
        row.summary = message.error ? `Assistant API error: ${message.error}` : "Complete assistant content block";
        const blocks = message.message.content.map((block) => {
          if (block.type === "text") { row.textBlock = (row.textBlock || "") + redact(block.text); return { type: block.type, text: redact(block.text) }; }
          if (block.type === "tool_use") {
            if (!this.pairs.has(block.id)) this.pairs.set(block.id, { id: block.id, name: block.name, state: "requested", requestedAt: this.now() });
            row.summary = `Tool request: ${block.name}`;
            const input = block.input as { file_path?: unknown };
            return { type: block.type, id: block.id, name: block.name, input: { file_path: typeof input.file_path === "string" ? redact(basename(input.file_path)) : "Not provided" } };
          }
          return { type: block.type, note: "Non-text content omitted from the classroom projection." };
        });
        row.data = { ...row.data, error: message.error, parent_tool_use_id: message.parent_tool_use_id, message: { id: message.message.id, role: message.message.role, content: blocks } };
        break;
      }
      case "user": {
        row.summary = "User input or tool feedback";
        const blocks = typeof message.message.content === "string" ? [{ type: "text", text: redact(message.message.content) }] : message.message.content.map((block) => {
          if (block.type === "tool_result") {
            const pair = this.pairs.get(block.tool_use_id);
            if (pair) { pair.state = block.is_error ? "error" : "completed"; pair.elapsedMs = Math.max(0, this.now() - pair.requestedAt); }
            row.summary = `Tool feedback: ${pair?.name || "unmatched request"}`;
            return { type: block.type, tool_use_id: block.tool_use_id, is_error: Boolean(block.is_error), content: typeof block.content === "string" ? redact(block.content) : "Non-text tool content omitted." };
          }
          return { type: block.type, note: "Additional input block" };
        });
        row.data = { ...row.data, parent_tool_use_id: message.parent_tool_use_id, message: { role: "user", content: blocks } };
        break;
      }
      case "stream_event": {
        const event = message.event;
        row.summary = `Partial event: ${event.type}`;
        let delta: Record<string, unknown> | undefined;
        if (event.type === "content_block_delta") {
          delta = { type: event.delta.type };
          if (event.delta.type === "text_delta") { row.textDelta = redact(event.delta.text); delta.text = row.textDelta; }
        }
        row.data = { ...row.data, parent_tool_use_id: message.parent_tool_use_id, event: { type: event.type, ...("index" in event ? { index: event.index } : {}), ...(delta ? { delta } : {}) } };
        break;
      }
      case "result": {
        row.outcome = resultFields(message);
        row.summary = `Final outcome: ${message.subtype}${message.is_error ? " (error)" : ""}`;
        const { text, ...metadata } = row.outcome;
        row.data = { type: "result", ...metadata, ...(message.subtype === "success" ? { result: text } : { errors: message.errors.map(redact) }) };
        break;
      }
    }
    row.pairs = [...this.pairs.values()].map((pair) => ({ ...pair }));
    return row;
  }
}
export function lessonOptions(config: Config, abortController = new AbortController()): Options {
  return {
    model: MODEL, cwd: WORKSPACE, tools: ["Read"], allowedTools: ["Read"], disallowedTools: ["Edit", "Write", "Bash", "Glob", "WebFetch"],
    permissionMode: "default", includePartialMessages: config.partial, maxTurns: config.scenario === "limit" ? 1 : 6,
    maxBudgetUsd: 0.30, effort: "low", settingSources: [], persistSession: false, mcpServers: {}, plugins: [], abortController,
    systemPrompt: "For this message-inspection classroom lab, first use Read on message-guide.md with no text or other call in that first response. Wait for the content, then answer the task briefly. Read only this file. Do not claim a result before reading it.",
    hooks: { PreToolUse: [{ hooks: [async (input) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const file = (input.tool_input as { file_path?: unknown }).file_path;
      if (input.tool_name !== "Read" || typeof file !== "string" || resolve(WORKSPACE, file).toLowerCase() !== resolve(WORKSPACE, "message-guide.md").toLowerCase()) {
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Only the classroom message-guide.md is available." } };
      }
      return {};
    }] }] },
  };
}
export async function observeRun(messages: AsyncIterable<SDKMessage>, emit: (event: LabEvent) => void) {
  const inspector = new MessageInspector(); let gotResult = false;
  try {
    for await (const message of messages) {
      const row = inspector.consume(message);
      if (row.outcome) gotResult = true;
      emit(row);
    }
    if (!gotResult) throw new Error("The stream ended without a final SDK result.");
  } catch (error) {
    if (!gotResult) throw error;
    emit({ type: "notice", text: "The runtime closed after yielding a result; its observed outcome is preserved." });
  }
}
export async function runAgent(prompt: string, emit: (event: LabEvent) => void, abortController = new AbortController(), config = DEFAULT_CONFIG) {
  config = validateConfig(config); emit({ type: "config", options: config });
  const run = query({ prompt, options: lessonOptions(config, abortController) });
  try { await observeRun(run, emit); }
  finally { run.close(); }
}
