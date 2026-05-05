#!/usr/bin/env node
// ── OpenCode Go → Anthropic API Proxy ──
// Claude Code (Anthropic) → OpenCode Go (OpenAI format)
// Usage: node index.js [port]
//
// Models: edit /home/debian/opencode-proxy/models.json, then:
//   systemctl --user restart opencode-proxy

const PORT = process.argv[2] || 11434;
const ZEN_GO = "https://opencode.ai/zen/go/v1/chat/completions";
const API_KEY = process.env.OPENCODE_API_KEY || (() => { console.error("ERROR: Set OPENCODE_API_KEY env var"); process.exit(1); })();
const CONFIG_PATH = __dirname + "/models.json";

const http = require("http");
const url = require("url");
const fs = require("fs");

// All available opencode-go models
const MODELS = [
  "glm-5", "glm-5.1",
  "kimi-k2.5", "kimi-k2.6",
  "minimax-m2.5", "minimax-m2.7",
  "deepseek-v4-flash", "deepseek-v4-pro",
  "qwen3.5-plus", "qwen3.6-plus",
  "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5", "mimo-v2.5-pro",
];

// Build Claude name variants → target model map from models.json
function buildMap(cfg) {
  const map = {};
  for (const [alias, target] of Object.entries(cfg)) {
    const base = alias.toLowerCase();
    map[base] = target;
    // claude-NAME-4, claude-NAME-4-5, claude-NAME-4-6, claude-NAME-4-7
    for (const v of ["", "-4", "-4-5", "-4-6", "-4-7"]) {
      const key = `claude-${base}${v}`;
      map[key] = target;
    }
    // claude-NAME-4-20250514
    map[`claude-${base}-4-20250514`] = target;
    // With context suffixes [1m] [8k] [200k] [1]
    for (const suffix of ["[1m]", "[8k]", "[200k]", "[1]"]) {
      map[base + suffix] = target;
      map[`claude-${base}` + suffix] = target;
      map[`claude-${base}-4` + suffix] = target;
      map[`claude-${base}-4-20250514` + suffix] = target;
      for (const v of ["-4-5", "-4-6", "-4-7"]) {
        map[`claude-${base}${v}` + suffix] = target;
      }
    }
  }
  return map;
}

let MAP = {};
function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    MAP = buildMap(cfg);
    console.log("📋 Models loaded from models.json:", JSON.stringify(cfg));
  } catch (e) {
    console.error("⚠️  Can't read models.json:", e.message, "— using defaults");
    MAP = { sonnet: "glm-5", opus: "glm-5", haiku: "glm-5" };
  }
}
loadConfig();

function cleanModel(name) {
  name = name.replace(/\[.*?\]$/, "");
  const m = MAP[name.toLowerCase()];
  return m || name;
}

// Watch config file for changes
fs.watchFile(CONFIG_PATH, () => {
  console.log("🔄 models.json changed — reloading...");
  loadConfig();
});

function anthropicToOpenAI(body) {
  body.model = cleanModel(body.model || "deepseek-v4-pro");
  const messages = [];
  const system = [];

  if (body.system) {
    if (Array.isArray(body.system)) {
      for (const s of body.system) {
        if (typeof s === "string") system.push(s);
        else if (s.type === "text") system.push(s.text);
      }
    } else if (typeof body.system === "string") {
      system.push(body.system);
    }
  }

  for (const msg of body.messages || []) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const parts = [];
        for (const c of msg.content) {
          if (c.type === "text") parts.push({ type: "text", text: c.text });
          else if (c.type === "image" && c.source) {
            parts.push({
              type: "image_url",
              image_url: { url: c.source.type === "base64" ? `data:${c.source.media_type};base64,${c.source.data}` : c.source.url || "" },
            });
          }
        }
        if (parts.length) messages.push({ role: "user", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        messages.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const texts = [], toolCalls = [];
        for (const c of msg.content) {
          if (c.type === "text") texts.push(c.text);
          else if (c.type === "tool_use") {
            toolCalls.push({ id: c.id, type: "function", function: { name: c.name, arguments: typeof c.input === "string" ? c.input : JSON.stringify(c.input) } });
          }
        }
        const obj = { role: "assistant" };
        if (texts.length) obj.content = texts.join("\n");
        if (toolCalls.length) obj.tool_calls = toolCalls;
        messages.push(obj);
      }
    } else if (msg.role === "tool") {
      const content = typeof msg.content === "string" ? msg.content
        : Array.isArray(msg.content) ? msg.content.map(c => c.type === "text" ? c.text : "").join("") : "";
      messages.push({ role: "tool", tool_call_id: msg.tool_use_id || "", content });
    }
  }

  if (system.length) messages.unshift({ role: "system", content: system.join("\n") });

  const result = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens || 4096,
    stream: body.stream || false,
  };
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stop_sequences?.length) result.stop = body.stop_sequences;
  if (body.tools?.length) {
    result.tools = body.tools.map(t => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }
  return result;
}

function handleRequest(req, res) {
  const { pathname } = url.parse(req.url);

  // HEAD check (Claude Code connection test)
  if ((pathname === "/v1" || pathname === "/v1/" || pathname === "/") && req.method === "HEAD") {
    res.writeHead(200); res.end(); return;
  }

  // Health
  if (pathname === "/health" || pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", upstream: ZEN_GO, port: PORT }));
    return;
  }

  // Models endpoint
  if (pathname === "/v1/models" && req.method === "GET") {
    const all = [];
    for (const id of MODELS) {
      all.push(id, id + "[1m]", id + "[8k]", id + "[200k]");
    }
    for (const alias of Object.keys(MAP)) {
      all.push(alias, alias + "[1m]", alias + "[8k]");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [...new Set(all)].map(id => ({ id, object: "model", owned_by: "opencode-go" })) }));
    return;
  }

  // Only /v1/messages POST (handle double-prefix /v1/v1/messages too)
  const cleanPath = pathname.replace(/^\/v1\/v1\//, "/v1/");
  if (cleanPath !== "/v1/messages" || req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. Use POST /v1/messages");
    return;
  }

  let rawBody = "";
  req.on("data", c => rawBody += c);
  req.on("end", () => {
    try {
      const anthropicBody = JSON.parse(rawBody);
      const openaiBody = anthropicToOpenAI(anthropicBody);
      const isStream = !!anthropicBody.stream;

      fetch(ZEN_GO, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
        body: JSON.stringify(openaiBody),
      }).then(async upstreamRes => {
        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          res.writeHead(upstreamRes.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "upstream_error", message: errText.slice(0, 500) } }));
          return;
        }

        if (!isStream) {
          upstreamRes.json().then(data => {
            const choice = data.choices?.[0];
            const msg = choice?.message || {};
            let text = msg.content || "";
            if (msg.reasoning_content) text = msg.reasoning_content + "\n\n" + text;
            const content = [];
            if (text) content.push({ type: "text", text });
            if (msg.tool_calls?.length) {
              for (const tc of msg.tool_calls) {
                content.push({ type: "tool_use", id: tc.id, name: tc.function?.name || "", input: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {} });
              }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              id: "msg_" + Date.now(), type: "message", role: "assistant", content,
              model: openaiBody.model,
              stop_reason: choice?.finish_reason === "stop" ? "end_turn" : choice?.finish_reason || "end_turn",
              stop_sequence: null,
              usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
            }));
          }).catch(err => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ type: "error", error: { type: "parse_error", message: err.message } }));
          });
          return;
        }

        // ─── Streaming ───
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let textBlockStarted = false, thinkingBlockStarted = false;
        let textBlockIndex = 0, thinkingBlockIndex = -1;
        let messageId = "msg_" + Date.now(), model = openaiBody.model;

        res.write(JSON.stringify({
          type: "message_start", message: {
            id: messageId, type: "message", role: "assistant", content: [],
            model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
          },
        }) + "\n\n");

        async function readStream() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") {
                if (textBlockStarted) res.write(JSON.stringify({ type: "content_block_stop", index: textBlockIndex }) + "\n\n");
                if (thinkingBlockStarted) res.write(JSON.stringify({ type: "content_block_stop", index: thinkingBlockIndex }) + "\n\n");
                res.write(JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } }) + "\n\n");
                res.end(); return;
              }
              if (trimmed.startsWith(": ")) continue;
              let chunk;
              try { chunk = JSON.parse(data); } catch { continue; }
              const choice = chunk.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta || {};
              const finish = choice.finish_reason;

              if (delta.reasoning_content) {
                if (!thinkingBlockStarted) {
                  thinkingBlockIndex = textBlockStarted ? textBlockIndex + 1 : 0;
                  thinkingBlockStarted = true;
                  res.write(JSON.stringify({ type: "content_block_start", index: thinkingBlockIndex, content_block: { type: "thinking", thinking: "" } }) + "\n\n");
                }
                res.write(JSON.stringify({ type: "content_block_delta", index: thinkingBlockIndex, delta: { type: "thinking_delta", thinking: delta.reasoning_content } }) + "\n\n");
              }
              if (delta.content) {
                if (!textBlockStarted) {
                  textBlockIndex = thinkingBlockStarted ? thinkingBlockIndex + 1 : 0;
                  textBlockStarted = true;
                  res.write(JSON.stringify({ type: "content_block_start", index: textBlockIndex, content_block: { type: "text", text: "" } }) + "\n\n");
                }
                res.write(JSON.stringify({ type: "content_block_delta", index: textBlockIndex, delta: { type: "text_delta", text: delta.content } }) + "\n\n");
              }
              if (finish) {
                if (textBlockStarted) res.write(JSON.stringify({ type: "content_block_stop", index: textBlockIndex }) + "\n\n");
                if (thinkingBlockStarted) res.write(JSON.stringify({ type: "content_block_stop", index: thinkingBlockIndex }) + "\n\n");
                const stopReason = finish === "stop" ? "end_turn" : finish === "length" ? "max_tokens" : finish === "tool_calls" ? "tool_use" : finish;
                res.write(JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: chunk.usage?.completion_tokens || 0 } }) + "\n\n");
                res.end(); return;
              }
            }
          }
        }
        readStream().catch(err => {
          console.error("[proxy] stream error:", err.message);
          if (textBlockStarted) res.write(JSON.stringify({ type: "content_block_stop", index: textBlockIndex }) + "\n\n");
          res.end();
        });

      }).catch(err => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "upstream_error", message: err.message } }));
      });
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request", message: e.message } }));
    }
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 Anthropic → OpenCode Go proxy on http://127.0.0.1:${PORT}`);
  console.log(`   Available: ${MODELS.join(", ")}`);
});
