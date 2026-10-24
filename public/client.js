import { renderMarkdown } from "./markdown.js";
const $ = (id) => document.getElementById(id);
const field = (id) => $(id);
const rows = [];
const responseText = { delta: "", answer: "" };
let running = false, selected = 0;
function code(id, value) { $(id).textContent = JSON.stringify(value, null, 2); Prism.highlightElement($(id)); }
function choose(row) {
    selected = row.sequence;
    $("selected").textContent = `#${row.sequence} · ${row.sdkType}${row.subtype ? " / " + row.subtype : ""}`;
    code("json", row.data);
    for (const button of $("events").querySelectorAll("button"))
        button.setAttribute("aria-pressed", String(button.dataset.sequence === String(selected)));
}
function trace() {
    const filter = field("filter").value, showPartial = field("show-partial").checked;
    $("events").replaceChildren();
    const core = ["system", "assistant", "user", "stream_event", "result"];
    for (const row of rows) {
        if (filter === "all" && !showPartial && row.sdkType === "stream_event")
            continue;
        if (filter !== "all" && (filter === "other" ? core.includes(row.sdkType) : row.sdkType !== filter))
            continue;
        const li = document.createElement("li"), button = document.createElement("button");
        button.type = "button";
        button.dataset.sequence = String(row.sequence);
        button.setAttribute("aria-pressed", String(row.sequence === selected));
        const title = document.createElement("strong"), text = document.createElement("span");
        title.textContent = `#${row.sequence} · ${row.sdkType}${row.subtype ? " / " + row.subtype : ""}`;
        text.textContent = row.summary;
        button.append(title, text);
        button.onclick = () => choose(row);
        li.append(button);
        $("events").append(li);
    }
    $("visible").textContent = `${$("events").children.length} displayed / ${rows.length} received`;
}
function pairs(values) {
    $("pairs").replaceChildren();
    if (!values.length) {
        $("pairs").textContent = "No tool request observed yet.";
        return;
    }
    for (const pair of values) {
        const article = document.createElement("article");
        article.className = "pair";
        const title = document.createElement("strong"), id = document.createElement("code"), note = document.createElement("p");
        title.textContent = `${pair.name} · ${pair.state}`;
        id.textContent = pair.id;
        note.textContent = pair.elapsedMs === undefined ? "Awaiting matching tool_result" : `${pair.elapsedMs} ms observed request-to-feedback time`;
        article.append(title, document.createElement("br"), id, note);
        $("pairs").append(article);
    }
}
function consume(row) {
    rows.push(row);
    $("messages").textContent = String(rows.length);
    for (const type of ["system", "assistant", "user", "stream_event", "result"])
        $("count-" + type).textContent = String(row.counts[type] || 0);
    $("count-other").textContent = String(Object.entries(row.counts).filter(([type]) => !["system", "assistant", "user", "stream_event", "result"].includes(type)).reduce((n, [, count]) => n + count, 0));
    if (row.textDelta) {
        responseText.delta += row.textDelta;
        renderMarkdown($("delta"), responseText.delta);
    }
    if (row.textBlock) {
        responseText.answer += row.textBlock + "\n\n";
        renderMarkdown($("answer"), responseText.answer);
    }
    if (row.sdkType === "system" && row.subtype === "init")
        code("init", row.data);
    pairs(row.pairs);
    if (row.outcome) {
        const result = row.outcome;
        $("status").textContent = result.subtype;
        $("turns").textContent = String(result.num_turns);
        $("cost").textContent = "$" + result.total_cost_usd.toFixed(4);
        $("stop").textContent = result.stop_reason || "null";
        $("duration").textContent = `${result.duration_ms} ms total · ${result.duration_api_ms} ms API`;
        $("session").textContent = result.session_id;
        renderMarkdown($("result-text"), result.text);
        code("usage", { usage: result.usage, modelUsage: result.modelUsage, permission_denials: result.permission_denials });
        $("outcome-kind").textContent = result.is_error ? "SDK error outcome" : result.stop_reason === "refusal" ? "Refusal stop reason" : "SDK completed";
    }
    trace();
    if (field("follow").checked || selected === 0)
        choose(row);
}
field("filter").onchange = trace;
field("show-partial").onchange = trace;
$("inspect-init").onclick = () => { const row = rows.find((r) => r.sdkType === "system" && r.subtype === "init"); if (row) {
    field("follow").checked = false;
    choose(row);
    $("inspector").scrollIntoView({ behavior: "smooth", block: "start" });
} };
$("inspect-result").onclick = () => { const row = [...rows].reverse().find((r) => r.sdkType === "result"); if (row) {
    field("follow").checked = false;
    choose(row);
    $("inspector").scrollIntoView({ behavior: "smooth", block: "start" });
} };
$("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ source: "Actual SDK observations; safe field projection", rows }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "lesson05-observed-messages.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$("form").onsubmit = async (event) => {
    event.preventDefault();
    if (running)
        return;
    running = true;
    field("run").disabled = true;
    rows.length = 0;
    selected = 0;
    $("events").replaceChildren();
    pairs([]);
    responseText.delta = "";
    responseText.answer = "";
    for (const id of ["answer", "delta", "notice", "result-text", "session", "duration", "stop", "outcome-kind"])
        $(id).textContent = "";
    for (const id of ["messages", "turns", "count-system", "count-assistant", "count-user", "count-stream_event", "count-result", "count-other"])
        $(id).textContent = "0";
    for (const id of ["json", "init", "usage"])
        code(id, { state: "Waiting for this run" });
    $("selected").textContent = "No message selected";
    $("status").textContent = "running";
    $("cost").textContent = "—";
    $("visible").textContent = "0 displayed / 0 received";
    const options = { scenario: field("scenario").value, partial: field("partial").checked };
    try {
        const response = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: field("prompt").value, options }) });
        if (!response.ok)
            throw new Error(await response.text());
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = "";
        function line(text) {
            if (!text.trim())
                return;
            const event = JSON.parse(text);
            if (event.type === "message")
                consume(event);
            if (event.type === "notice" || event.type === "error") {
                $("notice").textContent = event.text;
                if (event.type === "error" && !rows.some((r) => r.outcome))
                    $("status").textContent = "transport_error";
            }
        }
        for (;;) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let end;
            while ((end = buffer.indexOf("\n")) !== -1) {
                line(buffer.slice(0, end));
                buffer = buffer.slice(end + 1);
            }
            if (done) {
                line(buffer);
                break;
            }
        }
        if (!rows.some((row) => row.outcome))
            throw new Error("The stream ended without a final SDK result.");
    }
    catch (error) {
        $("notice").textContent = error instanceof Error ? error.message : "The run failed.";
        if (!rows.some((row) => row.outcome))
            $("status").textContent = "transport_error";
    }
    finally {
        running = false;
        field("run").disabled = false;
    }
};
fetch("/api/config").then((r) => r.json()).then((config) => {
    field("prompt").value = config.defaultPrompt;
    $("model").textContent = config.model;
    $("configuration").textContent = config.ready ? "Key configured on the server" : "Set your API key and restart. See How to run.";
    field("run").disabled = !config.ready;
}).catch(() => { $("configuration").textContent = "Cannot reach the local server."; });
fetch("/api/examples").then((r) => r.json()).then((examples) => {
    const select = field("example");
    for (const example of examples) {
        const option = document.createElement("option");
        option.value = example.id;
        option.textContent = example.title;
        select.append(option);
    }
    function show() { const example = examples.find((e) => e.id === select.value); $("example-note").textContent = example.note; code("example-json", example.data); }
    select.onchange = show;
    show();
});
