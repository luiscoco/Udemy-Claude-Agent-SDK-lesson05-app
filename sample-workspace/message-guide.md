# Five core SDK message types

- system: session lifecycle; init contains the session ID, model and tools.
- assistant: generated content blocks such as text or tool_use; in TypeScript inspect message.message.content (outer SDK message, nested API message, then the content array).
- user: user input or tool feedback; tool_result.tool_use_id matches tool_use.id.
- stream_event: raw API events when includePartialMessages is enabled; text_delta supplies incremental text.
- result: typed outcome with subtype, is_error, timing, usage, cost and session ID.

Complete assistant blocks still arrive when partial streaming is enabled. Keep incremental text and complete-block text in separate displays to avoid duplication. Some observability events may follow the result. Consume the iterator to completion and handle exceptions.
