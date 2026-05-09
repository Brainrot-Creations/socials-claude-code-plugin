import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CONFIG_DIR = join(homedir(), ".config", "openai-mcp");

function loadPersistentConfig() {
  try {
    return JSON.parse(readFileSync(join(CONFIG_DIR, "env.json"), "utf8"));
  } catch {
    return {};
  }
}

const persistentConfig = loadPersistentConfig();

function getEnv(name) {
  return (process.env[name] || persistentConfig[name] || "").trim();
}

function apiKey() {
  return getEnv("OPENAI_API_KEY");
}

async function openaiPost(path, body) {
  const key = apiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not set. Set it via env or ~/.config/openai-mcp/env.json.");
  const resp = await fetch(`https://api.openai.com/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!resp.ok) {
    const msg = data?.error?.message || text || `HTTP ${resp.status}`;
    throw new Error(`OpenAI error: ${msg}`);
  }
  return data;
}

const server = new McpServer({
  name: "openai-mcp",
  version: "0.1.0",
});

// ── Tool: openai_chat ────────────────────────────────────────────────────────

server.tool(
  "chat",
  "Send a prompt to an OpenAI chat model and get a text response. Supports GPT-4o, GPT-4o-mini, o1, o3-mini, etc.",
  {
    prompt: z.string().describe("The user message to send."),
    model: z
      .string()
      .optional()
      .default("gpt-4o")
      .describe("Model ID. Defaults to gpt-4o."),
    system: z
      .string()
      .optional()
      .describe("Optional system prompt to prepend."),
    max_tokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max tokens in the response."),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Sampling temperature (0–2). Defaults to model default."),
  },
  async ({ prompt, model, system, max_tokens, temperature }) => {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const body = { model: model ?? "gpt-4o", messages };
    if (max_tokens) body.max_tokens = max_tokens;
    if (temperature !== undefined) body.temperature = temperature;

    const data = await openaiPost("/chat/completions", body);
    const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
    const usage = data.usage
      ? `\n\n[tokens: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out]`
      : "";

    return {
      content: [{ type: "text", text: text + usage }],
    };
  }
);

// ── Tool: openai_image ───────────────────────────────────────────────────────

server.tool(
  "image",
  "Generate an image using OpenAI DALL-E. Returns the image URL(s).",
  {
    prompt: z.string().describe("Description of the image to generate."),
    model: z
      .string()
      .optional()
      .default("dall-e-3")
      .describe("Image model. 'dall-e-3' (default) or 'dall-e-2'."),
    size: z
      .enum(["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"])
      .optional()
      .default("1024x1024")
      .describe("Image dimensions. DALL-E 3 supports 1024x1024, 1792x1024, 1024x1792."),
    quality: z
      .enum(["standard", "hd"])
      .optional()
      .default("standard")
      .describe("Image quality. 'hd' costs more but is more detailed (DALL-E 3 only)."),
    n: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .default(1)
      .describe("Number of images to generate (DALL-E 2: up to 4; DALL-E 3: always 1)."),
    style: z
      .enum(["vivid", "natural"])
      .optional()
      .describe("DALL-E 3 only: 'vivid' (dramatic) or 'natural' (realistic)."),
  },
  async ({ prompt, model, size, quality, n, style }) => {
    const body = {
      model: model ?? "dall-e-3",
      prompt,
      size: size ?? "1024x1024",
      quality: quality ?? "standard",
      n: n ?? 1,
      response_format: "url",
    };
    if (style) body.style = style;

    const data = await openaiPost("/images/generations", body);
    const images = data.data ?? [];
    const lines = images.map((img, i) => {
      const url = img.url ?? "(no url)";
      const revised = img.revised_prompt ? `\nRevised prompt: ${img.revised_prompt}` : "";
      return `Image ${i + 1}: ${url}${revised}`;
    });

    return {
      content: [{ type: "text", text: lines.join("\n\n") || "No images returned." }],
    };
  }
);

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
