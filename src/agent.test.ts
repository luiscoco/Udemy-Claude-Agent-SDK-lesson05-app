import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_CONFIG, lessonOptions, MessageInspector, observeRun, validateConfig, validatePrompt, type LabEvent } from "./agent.js";
import { examples } from "./examples.js";
const message = (value: object) => value as SDKMessage;
const tool = message({ type: "assistant", message: { id: "response-1", role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "message-guide.md" } }] }, parent_tool_use_id: null });
const success = message({ type: "result", subtype: "success", is_error: false, result: "Explained", stop_reason: "end_turn", session_id: "s", total_cost_usd: .01, num_turns: 2, duration_ms: 1000, duration_api_ms: 700, usage: { input_tokens: 2, output_tokens: 8 }, modelUsage: {}, permission_denials: [] });
const limit = message({ ...success, subtype: "error_max_turns", is_error: true, errors: ["Reached maximum turns"] });
test("validate the prompt and config before running", () => {
  assert.equal(validatePrompt(" hi "), "hi"); assert.throws(() => validatePrompt(" "));
  for (const value of [[], 7, { scenario: "other" }, { partial: "yes" }]) assert.throws(() => validateConfig(value));
  assert.equal(lessonOptions(validateConfig({ scenario: "limit" })).maxTurns, 1);
  assert.equal(lessonOptions(DEFAULT_CONFIG).includePartialMessages, true);
  assert.deepEqual(lessonOptions(DEFAULT_CONFIG).tools, ["Read"]);
});
test("non-init system messages never read init fields", () => {
  const row = new MessageInspector().consume(message({ type: "system", subtype: "compact_boundary" }));
  assert.equal(row.subtype, "compact_boundary"); assert.equal(row.data.model, undefined);
});
test("pair tool use and feedback by ID and observed receipt time", () => {
  let now = 100; const inspector = new MessageInspector(() => now);
  const start = inspector.consume(tool); now = 160;
  const end = inspector.consume(message({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "guide" }] } }));
  assert.equal(end.pairs[0].elapsedMs, 60); assert.equal(end.pairs[0].state, "completed");
  assert.equal(start.pairs[0].state, "requested");
  const unmatched = inspector.consume(message({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "missing", is_error: true, content: "denied" }] } }));
  assert.match(unmatched.summary, /unmatched/);
});
test("partial text and complete blocks stay distinct; thinking content is omitted", () => {
  const inspector = new MessageInspector();
  const delta = inspector.consume(message({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } } }));
  assert.equal(delta.textDelta, "Hi"); assert.equal(delta.textBlock, undefined);
  const block = inspector.consume(message({ type: "assistant", message: { id: "a", content: [{ type: "text", text: "Hi" }] } }));
  assert.equal(block.textBlock, "Hi"); assert.equal(block.textDelta, undefined);
  const hidden = inspector.consume(message({ type: "assistant", message: { id: "a", content: [{ type: "thinking", thinking: "private-content" }] } }));
  assert.ok(!JSON.stringify(hidden).includes("private-content"));
  const hiddenDelta = inspector.consume(message({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private-content" } } }));
  assert.ok(!JSON.stringify(hiddenDelta).includes("private-content"));
});
test("typed error results use errors rather than the success string", () => {
  const row = new MessageInspector().consume(limit);
  assert.equal(row.outcome?.subtype, "error_max_turns"); assert.equal(row.outcome?.text, "Reached maximum turns");
  assert.equal(row.data.result, undefined); assert.equal(row.outcome?.duration_api_ms, 700);
});
test("drain events after result and preserve result when iteration later throws", async () => {
  const rows: LabEvent[] = [];
  async function* stream() { yield limit; yield message({ type: "prompt_suggestion", suggestion: "example" }); throw new Error("process exited"); }
  await observeRun(stream(), (row) => rows.push(row));
  assert.equal(rows.length, 3); assert.equal(rows[1].type === "message" && rows[1].sdkType, "prompt_suggestion");
  assert.equal(rows[2].type, "notice");
});
test("missing results and pre-result exceptions remain failures", async () => {
  async function* empty() {}
  async function* broken() { yield tool; throw new Error("connection failed"); }
  await assert.rejects(observeRun(empty(), () => {}), /without a final/);
  await assert.rejects(observeRun(broken(), () => {}), /connection failed/);
});
test("unknown observability fields are not copied to the projection", () => {
  const row = new MessageInspector().consume(message({ type: "prompt_suggestion", suggestion: "private unlisted field", arbitrarySecret: "keep local" }));
  assert.equal(row.sdkType, "prompt_suggestion"); assert.ok(!JSON.stringify(row).includes("keep local"));
  assert.ok(!JSON.stringify(row).includes("private unlisted field"));
  assert.ok(examples.every((e) => e.note));
});
