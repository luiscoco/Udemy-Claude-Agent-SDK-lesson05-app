"""Source-checked excerpts for every numbered UML workflow step.

The display omits surrounding implementation where marked. Anchors are checked
against the shipped source so a renamed statement cannot silently leave stale
teaching material behind.
"""
def workflow_excerpt(source, anchors, code):
    text = (APP / source).read_text(encoding='utf-8')
    positions = [text.index(anchor) for anchor in anchors]
    lines = [text.count('\n', 0, position) + 1 for position in positions]
    return dict(source=source, firstLine=min(lines), lastLine=max(lines),
                code=code.strip(), anchors=anchors,
                sourceSHA256=hashlib.sha256(text.encode('utf-8')).hexdigest(),
                language='typescript', excerptLabel='Selected source; whitespace reformatted and surrounding context omitted.')

workflow_specs = [
    ('Validate the submitted task', 'The JSON body supplies the prompt and options. These actual server statements validate both before creating the SDK run.',
     'src/server.ts', ['const input = JSON.parse(body);', 'const prompt = validatePrompt(input.prompt);', 'const config = validateConfig(input.options);'],
     '''const input = JSON.parse(body);
const prompt = validatePrompt(input.prompt);
const config = validateConfig(input.options);''',
     'Step one connects the request to its server code. JSON parse reads the submitted body. Validate prompt and validate config reject invalid inputs before a query starts. The source filename and line range identify these actual statements.'),
    ('Create one SDK query', 'The host passes the prompt and computed options to query(). The SDK owns the subsequent model and tool interactions.',
     'src/agent.ts', ['const run = query({ prompt, options: lessonOptions(config, abortController) });'],
     '''const run = query({
  prompt,
  options: lessonOptions(config, abortController)
});''',
     'Step two creates one real query. The prompt and lesson options enter the SDK together. This application does not write its own model and tool loop. The following messages are observations from this query.'),
    ('Narrow system initialization', 'The subtype guard selects init. Its model is one of the metadata fields copied into the classroom projection.',
     'src/agent.ts', ['if (message.subtype === "init") {', 'model: message.model'],
     '''if (message.subtype === "init") {
  row.data = {
    ...row.data,
    model: message.model,
    // Other init fields omitted.
  };
}''',
     'Step three narrows the system subtype before reading init fields. This selected projection copies the actual model into the row. The remaining metadata fields are omitted from this short excerpt and remain available in the full source.'),
    ('Configure the SDK transport boundary', 'These options supply the model, working directory and Read definition. The SDK sends the model request internally; these are application configuration properties, not a custom HTTP client.',
     'src/agent.ts', ['model: MODEL, cwd: WORKSPACE, tools: ["Read"], allowedTools: ["Read"]'],
     '''// Properties inside lessonOptions():
model: MODEL,
cwd: WORKSPACE,
tools: ["Read"],
allowedTools: ["Read"],''',
     'Step four shows the application boundary for the SDK request. These real option properties select the model, directory and Read tool. The SDK performs transport internally; this excerpt is configuration, not an invented network implementation.'),
    ('Observe a model tool request', 'The model chooses its output. The application observes tool_use blocks and labels the actual requested tool.',
     'src/agent.ts', ['if (block.type === "tool_use") {', 'row.summary = `Tool request: ${block.name}`;'],
     '''if (block.type === "tool_use") {
  // Request tracking omitted here.
  row.summary = `Tool request: ${block.name}`;
  // Input projection follows in the full source.
}''',
     'Step five connects model output to the observer branch. A tool use block is an actual model request. The summary reads its real name. Request tracking and input projection are marked as omitted, rather than presented as fabricated model-side code.'),
    ('Project assistant content blocks', 'The nested API message supplies its response ID and role. The blocks variable contains the safely projected content from the earlier mapping branch.',
     'src/agent.ts', ['const blocks = message.message.content.map((block) => {', 'message: { id: message.message.id, role: message.message.role, content: blocks }'],
     '''// Selected message property in row.data:
message: {
  id: message.message.id,
  role: message.message.role,
  content: blocks
}''',
     'Step six shows the assistant projection. The response identifier and role come from the nested API message. Content uses the blocks already mapped by the observer. This property excerpt preserves the same SDK wrapper structure used in the selected-message viewer.'),
    ('Guard the built-in Read tool', 'The SDK executes Read. Before that execution, the actual PreToolUse hook identifies the event and resolves the requested filename; the following full guard permits only message-guide.md.',
     'src/agent.ts', ['if (input.hook_event_name !== "PreToolUse") return {};', 'const file = (input.tool_input as { file_path?: unknown }).file_path;', 'resolve(WORKSPACE, file).toLowerCase() !== resolve(WORKSPACE, "message-guide.md").toLowerCase()'],
     '''if (input.hook_event_name !== "PreToolUse") {
  return {};
}
const file = (
  input.tool_input as { file_path?: unknown }
).file_path;
// The next guard permits only message-guide.md.''',
     'Step seven identifies the real pre-tool hook. The event check and requested filename lead into the source guard that allows only the classroom guide. The SDK runs the built-in Read implementation after permission checks; the host does not pretend to implement that tool.'),
    ('Project returned file content', 'The user tool_result block contains the returned content. This actual property handles text and explicitly labels omitted non-text content.',
     'src/agent.ts', ['content: typeof block.content === "string" ? redact(block.content) : "Non-text tool content omitted."'],
     '''// Content property of a projected tool_result:
content: typeof block.content === "string"
  ? redact(block.content)
  : "Non-text tool content omitted."''',
     'Step eight shows where actual Read output enters the displayed data. Text content is redacted before projection, and non-text content is explicitly labelled as omitted. The file read itself occurs inside the SDK; this source handles its returned result.'),
    ('Match feedback to the request', 'The returned tool_use_id retrieves the earlier request. The full branch also updates state and observed request-to-feedback timing.',
     'src/agent.ts', ['if (block.type === "tool_result") {', 'const pair = this.pairs.get(block.tool_use_id);'],
     '''if (block.type === "tool_result") {
  const pair = this.pairs.get(block.tool_use_id);
  // State and observed timing updates follow.
}''',
     'Step nine matches the returned tool use identifier to the request map. This is the same correlation shown in the live tool-pair card. The following source statements update completion state and observed timing.'),
    ('Extract an incremental text delta', 'The stream handler narrows event.type and delta.type. Only text_delta.text enters the incremental-text buffer.',
     'src/agent.ts', ['if (event.type === "content_block_delta") {', 'if (event.delta.type === "text_delta") { row.textDelta = redact(event.delta.text); delta.text = row.textDelta; }'],
     '''if (event.type === "content_block_delta") {
  // Delta metadata initialization omitted.
  if (event.delta.type === "text_delta") {
    row.textDelta = redact(event.delta.text);
    delta.text = row.textDelta;
  }
}''',
     'Step ten shows the nested checks for partial output. Only text delta reaches row dot text delta. Other delta shapes do not enter the incremental text panel. The omitted statement initializes metadata, not another model turn.'),
    ('Collect complete assistant text', 'Complete text blocks are projected independently of partial deltas. The browser then renders this complete-text buffer in its own formatted panel.',
     'src/agent.ts', ['if (block.type === "text") { row.textBlock = (row.textBlock || "") + redact(block.text); return { type: block.type, text: redact(block.text) }; }'],
     '''if (block.type === "text") {
  row.textBlock = (row.textBlock || "")
    + redact(block.text);
  return {
    type: block.type,
    text: redact(block.text)
  };
}''',
     'Step eleven collects complete assistant text separately. The observer sets text block rather than text delta. This distinction lets the browser format both views without appending the complete message into the streamed-text buffer again.'),
    ('Preserve the result and drain events', 'The iterator records the typed outcome and continues. The surrounding try/catch distinguishes a failure before any result from a later runtime exception.',
     'src/agent.ts', ['for await (const message of messages) {', 'const row = inspector.consume(message);', 'if (row.outcome) gotResult = true;', 'emit(row);'],
     '''for await (const message of messages) {
  const row = inspector.consume(message);
  if (row.outcome) gotResult = true;
  emit(row);
}''',
     'Step twelve consumes the query through completion. Got result records that a typed outcome was observed, but there is no break statement. Trailing events are still consumed. The surrounding catch preserves an observed result and rethrows failures that happened before one.'),
    ('Render the selected data and answer', 'These actual client statements highlight selected JSON and render final answer text through the sanitizing Markdown renderer.',
     'src/client.ts', ['code("json", row.data);', 'renderMarkdown($("result-text"), result.text);'],
     '''// In choose(row):
code("json", row.data);

// In consume(row):
renderMarkdown($("result-text"), result.text);''',
     'Step thirteen connects observations to the student interface. The selected row is shown as coloured JSON. The final answer uses the Markdown renderer so lists, bold text and code appear as formatted content. These are actual statements from the client file.'),
]
workflow_steps=[]
for number, (title, explanation, source, anchors, code, narration) in enumerate(workflow_specs, 1):
    excerpt = workflow_excerpt(source, anchors, code)
    workflow_steps.append(dict(number=number, title=title, explanation=explanation,
                               narration=narration, **excerpt))
assert len(workflow_steps) == len(arrows) == 13
