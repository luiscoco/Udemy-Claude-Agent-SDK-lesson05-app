# Claude Agent SDK · Lesson 05 · Message types in depth

Based on the supplied Lesson05_Message_Types_in_Depth.pptx. A TypeScript application for inspecting actual SDK message shapes, streamed text, linked tools and final outcomes.

## What you will learn

- Narrow the union: Check message.type, then subtype or block.type before accessing shape-specific fields.
- Read session metadata: system/init describes session_id, model, tools, permission mode and credential source; never expose a key.
- Inspect assistant blocks: Read message.message.content. Separate text, tool_use and omitted non-text content; response IDs can be shared.
- Pair tool feedback: Match assistant tool_use.id with user tool_result.tool_use_id. Measure observed request-to-feedback time.
- Stream incremental text: Enable includePartialMessages. Narrow event.type and delta.type, then append only text_delta.text.
- Handle final outcomes: Check subtype and is_error; inspect result or errors[], timing, usage, modelUsage and stop_reason. Consume trailing events and catch exceptions.

## Configure and run

Use Node.js 24+, npm and your own model-accessible Anthropic API key.

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson05-app.git
cd .\Udemy-Claude-Agent-SDK-lesson05-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From the original presentations folder, use `cd .\agent-sdk\lesson05-message-types` instead of cloning. Open http://127.0.0.1:3105; keep the terminal open. Stop with Ctrl+C.

## Create your .env file

Copy .env.example only if .env does not exist. Replace the safe placeholder locally; never commit the real file. Restart after changes.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3105
```

Windows, if needed: add `CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe` after confirming the installed path. Keep optional npm dependencies installed for the bundled runtime. The SDK reads its process environment; start/sample:env explicitly load .env and existing shell variables take precedence.

## Run the exercises

1. Run Read and explain with partial messages enabled. Inspect init, assistant, user, stream_event and result in the log. Select rows to inspect their safe JSON projection.
2. Match Read tool_use.id to tool_result.tool_use_id and inspect observed timing.
3. Compare the separate incremental and complete text panels; repeat with partial messages off.
4. Select maxTurns: 1 and preserve the actual error result even if the runtime subsequently throws.
5. Explore labelled offline examples of compaction, thinking, refusal and API failures; they never populate the live counters.

Terminal logger, with a key in the launching shell:

```powershell
$env:ANTHROPIC_API_KEY = "your_api_key"
npm run sample -- read on
npm run sample -- limit on
# Explicit optional .env loading:
npm run sample:env -- read off
```

## How the app was built

### 01. Configure one Read tool

This read-only experiment asks the agent to read one harmless classroom file. maxTurns: 1 forces the limited scenario. The hook restricts reads to the bundled guide.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 02. Narrow system and init

Every system subtype is handled as a lifecycle event. Only init exposes init-specific fields. The browser receives an allowlisted projection, with the working directory reduced to a classroom label.

Source: [src/agent.ts](src/agent.ts)

```typescript
      case "system": {
        row.summary = `Session lifecycle: ${subtype}`;
        if (message.subtype === "init") {
          row.data = { ...row.data, model: message.model, cwd: "sample-workspace", tools: message.tools, permissionMode: message.permissionMode, apiKeySource: message.apiKeySource, claude_code_version: message.claude_code_version, mcp_servers: message.mcp_servers.map((m) => ({ name: m.name, status: m.status })), skills: message.skills, slash_commands: message.slash_commands };
        }
        // Other system subtypes are distinct union members; do not read init-only fields.
        break;
      }
```

### 03. Inspect assistant blocks

The SDK wrapper contains message.message.content. Tool requests are keyed by their actual ID. Text appears in the complete-block panel. Thinking and other non-text content are identified without displaying their content.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 04. Match user tool results

A user message can be tool feedback rather than a person typing. Its tool_use_id joins the earlier request. The elapsed time measures receipt-to-receipt observation, including runtime scheduling; it is not a provider billing duration.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 05. Extract text deltas safely

Check three nested discriminators before reading text. Complete assistant blocks still arrive, so this app uses a separate incremental panel and never appends the complete text to that panel.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 06. Read the typed result

The success subtype has result; error subtypes have errors[]. Check is_error as well: a success-shaped message can carry an API error. A refusal is visible in stop_reason. usage describes the main loop; modelUsage contains broader query-pipeline totals when present.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 07. Consume through trailing events

Do not break at the result. Preserve a typed outcome if the single-prompt runtime subsequently throws. An exception before any result remains a failure; no result is invented.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 08. Close the query reliably

The finally block closes the real SDK query. The host streams only the projected observations. Private configuration and dependency folders are not served by the static router.

Source: [src/agent.ts](src/agent.ts)

```typescript
export async function runAgent(prompt: string, emit: (event: LabEvent) => void, abortController = new AbortController(), config = DEFAULT_CONFIG) {
  config = validateConfig(config); emit({ type: "config", options: config });
  const run = query({ prompt, options: lessonOptions(config, abortController) });
  try { await observeRun(run, emit); }
  finally { run.close(); }
}
```

## UML workflow with code at every step

The architecture page includes a syntax-coloured TypeScript excerpt, source filename and line range, and a code-to-workflow explanation in each of its 13 numbered steps. Excerpts are checked against source anchors by scripts/workflow-snippets.py. Whitespace changes and omitted context are labelled. SDK-managed operations show the real application configuration or observation boundary; they do not invent an SDK transport or Read implementation.

## Formatted application responses

The incremental, complete assistant and final-result panels render Markdown as lists, emphasis, headings, tables and code. Marked parses the response and DOMPurify sanitizes the generated HTML before insertion. Both libraries are pinned and bundled locally with their licenses. Raw message JSON and downloaded observations retain the original text. Streaming buffers are separate and reset for every run.

## TypeScript and Python

The live app is TypeScript. Python reads AssistantMessage.content directly, while TypeScript reads message.message.content. Python init fields live in SystemMessage.data. Python cost/usage/model_usage can be optional; check for None. The student walkthrough includes a comparison table and a labelled reference example. No Python installation is needed to run the app.

## Interpretation and scope

The SDK manages the loop; the observer consumes messages. Partial events are not additional model turns. Complete assistant blocks can share a response ID. Read the actual SDK num_turns rather than replacing it with a message count. The union contains additional observability events; the default branch records safe common metadata. Non-init system variants do not expose init-only fields.

The browser shows an allowlisted projection, not a raw SDK transcript. Non-text reasoning and tool-input fragments are omitted; actual tool IDs, text deltas and classroom Read output remain observable. Timing in the pair cards measures request-to-feedback receipt, including runtime scheduling. Unmatched requests remain pending if interrupted.

Result subtype, is_error and stop_reason are separate. A success-shaped message may carry an API error; refusal is read from stop_reason. usage describes the main loop; modelUsage describes broader query-pipeline accounting when present. Cost is an estimate. This app creates no subagents and does not implement resume or streamed user input. It consumes trailing events and preserves an observed result if iteration later throws. A failure with no result remains a host failure.

Only Read is available, restricted to the bundled classroom guide by a host hook. These local guards are not an operating-system sandbox. Live responses are never replaced by examples. The examples API is explicitly labelled as illustrative and never used by the real query. .env, node_modules, runtime files, presentation/output/reviewed/v3, teaching-material, videos, audio and PowerPoint files are excluded from Git.

## Maintenance

```powershell
npm test
npm run build:client
python scripts/build-pages.py
```

Python is optional for regenerating the bundled HTML documentation. All five pages, syntax highlighting, mascot, UML, application source and lockfile are shipped.

## References

- [Official streaming documentation](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Agent loop and message lifecycle](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [TypeScript SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
