import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Config (all optional: defaults hit public pass-through proxy) ─────────────

/** Used when no `LUMA_API_URL` / `API_SERVER_URL` / `API_SERVER_HOST` is set. */
const DEFAULT_LUMA_PROXY_BASE = "https://api.brainrotcreations.com";

const CONFIG_DIR = join(homedir(), ".config", "luma-api");

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

function commonApiServerBaseUrl() {
  const raw = getEnv("API_SERVER_URL") || getEnv("API_SERVER_HOST");
  if (!raw) return "";
  let s = raw.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/$/, "");
}

function commonApiServerKey() {
  return getEnv("API_SERVER_KEY") || getEnv("API_KEY");
}

function resolvedLumaApiUrl() {
  const specific = getEnv("LUMA_API_URL");
  if (specific) return specific.replace(/\/$/, "");
  return commonApiServerBaseUrl();
}

function resolvedLumaApiKey() {
  return getEnv("LUMA_API_KEY") || commonApiServerKey();
}

function lumaBaseUrl() {
  const u = resolvedLumaApiUrl();
  if (u) return u;
  return DEFAULT_LUMA_PROXY_BASE.replace(/\/$/, "");
}

async function lumaGet(pathname, query) {
  const base = lumaBaseUrl();
  const apiKey = resolvedLumaApiKey();
  const root = base.endsWith("/") ? base : `${base}/`;
  const u = new URL(pathname.replace(/^\//, ""), root);
  for (const [qk, qv] of Object.entries(query || {})) {
    if (qv === undefined || qv === null || qv === "") continue;
    if (typeof qv === "boolean") {
      if (qv) u.searchParams.set(qk, "true");
      continue;
    }
    u.searchParams.set(qk, String(qv));
  }
  const headers = { Accept: "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const resp = await fetch(u, { method: "GET", headers });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!resp.ok) {
    const err = new Error(`Luma API ${resp.status}: ${text.slice(0, 500)}`);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

function asTextContent(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

// ── MCP tools ─────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "luma-api", version: "0.3.0" });

server.tool(
  "luma_discover",
  "Fetch Luma Discover compact JSON (places, categories, calendars, hydration lat/lon) from the public API proxy.",
  {
    url: z.string().url().optional(),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ url, timeout }) => {
    try {
      const q = {};
      if (url) q.url = url;
      if (timeout) q.timeout = timeout;
      const data = await lumaGet("/api/luma/discover", q);
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_events_by_place",
  "List paginated Luma events for a discover_place_api_id (e.g. discplace-…).",
  {
    place_id: z.string().min(1),
    pagination_limit: z.number().int().positive().max(100).optional(),
    cursor: z.string().optional(),
    fetch_all: z.boolean().optional(),
    max_pages: z.number().int().positive().max(500).optional(),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async (args) => {
    try {
      const { place_id, ...q } = args;
      const data = await lumaGet(
        `/api/luma/events/place/${encodeURIComponent(place_id)}`,
        q,
      );
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_events_by_category",
  "List paginated Luma events near latitude/longitude for a category slug (e.g. wellness).",
  {
    slug: z.string().min(1),
    latitude: z.string().min(1),
    longitude: z.string().min(1),
    pagination_limit: z.number().int().positive().max(100).optional(),
    cursor: z.string().optional(),
    fetch_all: z.boolean().optional(),
    max_pages: z.number().int().positive().max(500).optional(),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ slug, latitude, longitude, ...q }) => {
    try {
      const data = await lumaGet(
        `/api/luma/events/category/${encodeURIComponent(slug)}`,
        { latitude, longitude, ...q },
      );
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_calendar_items",
  "List upcoming calendar rows (slim) for a Luma calendar_api_id.",
  {
    calendar_api_id: z.string().min(1),
    period: z.string().optional(),
    pagination_limit: z.number().int().positive().max(100).optional(),
    cursor: z.string().optional(),
    fetch_all: z.boolean().optional(),
    max_pages: z.number().int().positive().max(500).optional(),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ calendar_api_id, ...q }) => {
    try {
      const data = await lumaGet(
        `/api/luma/calendar/${encodeURIComponent(calendar_api_id)}/items`,
        q,
      );
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_calendar_full",
  "Fetch full Luma calendar/get JSON (hosts, tags, featured_items with urls) for a calendar_api_id. Large payload.",
  {
    calendar_api_id: z.string().min(1),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ calendar_api_id, timeout }) => {
    try {
      const q = {};
      if (timeout) q.timeout = timeout;
      const data = await lumaGet(
        `/api/luma/calendar/${encodeURIComponent(calendar_api_id)}`,
        q,
      );
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_event_detail",
  "Fetch full detail for a Luma event by api_id (evt-…): name, times, location, hosts with socials, tickets, guest_count, registration status.",
  {
    event_api_id: z.string().min(1),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ event_api_id, timeout }) => {
    try {
      const q = {};
      if (timeout) q.timeout = timeout;
      const data = await lumaGet("/api/luma/event", { id: event_api_id, ...q });
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_event_guests",
  "Get public featured attendees for a Luma event (up to 10 profiles with name, username, bio, twitter, instagram, linkedin, etc.) plus total guest_count.",
  {
    event_api_id: z.string().min(1),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ event_api_id, timeout }) => {
    try {
      const q = {};
      if (timeout) q.timeout = timeout;
      const data = await lumaGet("/api/luma/event/guests", { id: event_api_id, ...q });
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "luma_calendar_profile",
  "Fetch organizer profile for a Luma calendar (name, slug, socials, bio, city, verified, luma_plus, tags).",
  {
    calendar_api_id: z.string().min(1),
    timeout: z.number().int().positive().max(120).optional(),
  },
  async ({ calendar_api_id, timeout }) => {
    try {
      const q = {};
      if (timeout) q.timeout = timeout;
      const data = await lumaGet(
        `/api/luma/calendar/${encodeURIComponent(calendar_api_id)}/profile`,
        q,
      );
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
