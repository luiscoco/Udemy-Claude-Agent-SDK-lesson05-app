import { DEFAULT_PROMPT, runAgent, validateConfig } from "./agent.js";
if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith("your_")) {
  console.error("Set ANTHROPIC_API_KEY in the same shell, or use npm run sample:env."); process.exitCode = 1;
} else {
  try {
    await runAgent(DEFAULT_PROMPT, (row) => {
      if (row.type === "message") {
        console.log(`#${row.sequence} ${row.sdkType}${row.subtype ? "/" + row.subtype : ""}: ${row.summary}`);
        if (row.outcome) console.log(JSON.stringify(row.outcome, null, 2));
      } else if (row.type !== "config") console.log(row.text);
    }, new AbortController(), validateConfig({ scenario: process.argv[2] || "read", partial: process.argv[3] !== "off" }));
  } catch { console.error("No final SDK result: check the key, model access and runtime setup."); process.exitCode = 1; }
}
