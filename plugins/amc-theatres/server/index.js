import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** Used when no `AMC_API_URL` / `API_SERVER_URL` / `API_SERVER_HOST` is set. */
const DEFAULT_AMC_PROXY_BASE = "https://api.brainrotcreations.com";

const CONFIG_DIR = join(homedir(), ".config", "amc-api");
const CONFIG_PATH = join(CONFIG_DIR, "env.json");
const GETCOOKIES_FALLBACK_PATH = join(
  process.cwd(),
  "plugins",
  "amc-api",
  "tools",
  "getcookies.py",
);
const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const FETCH_SHOWTIMES_PY = join(__dirname, "..", "tools", "fetch_showtimes.py");
const FETCH_SEATS_PY = join(__dirname, "..", "tools", "fetch_seats.py");

async function fetchSeatsLocal(showtime_id, timeout) {
  const ms = (timeout ?? 60) * 1000;
  const { stdout } = await execFileAsync("python3", [FETCH_SEATS_PY, "--showtime-id", String(showtime_id)], { timeout: ms });
  return JSON.parse(stdout.trim());
}

async function fetchShowtimesLocal(args) {
  const pyArgs = [];
  if (args.slug)             pyArgs.push("--slug",             args.slug);
  if (args.region)           pyArgs.push("--region",           args.region);
  if (args.url)              pyArgs.push("--url",              args.url);
  if (args.movie)            pyArgs.push("--movie",            args.movie);
  if (args.date)             pyArgs.push("--date",             args.date);
  if (args.premium_offering) pyArgs.push("--premium-offering", args.premium_offering);
  const timeout = (args.timeout ?? 60) * 1000;
  const { stdout } = await execFileAsync("python3", [FETCH_SHOWTIMES_PY, ...pyArgs], { timeout });
  return JSON.parse(stdout.trim());
}

function loadPersistentConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

let persistentConfig = loadPersistentConfig();

function savePersistentConfig() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(persistentConfig, null, 2)}\n`, "utf8");
}

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

function resolvedAmcApiUrl() {
  const specific = getEnv("AMC_API_URL");
  if (specific) return specific.replace(/\/$/, "");
  return commonApiServerBaseUrl();
}

function amcBaseUrl() {
  const u = resolvedAmcApiUrl();
  if (u) return u;
  return DEFAULT_AMC_PROXY_BASE.replace(/\/$/, "");
}

function resolvedAmcCookie() {
  return getEnv("AMC_COOKIE") || getEnv("AMC_API_COOKIE");
}

function sanitizeCookie(raw) {
  return (raw || "").trim();
}

function setStoredAmcCookie(value) {
  persistentConfig.AMC_COOKIE = sanitizeCookie(value);
  savePersistentConfig();
  return persistentConfig.AMC_COOKIE;
}

function clearStoredAmcCookie() {
  delete persistentConfig.AMC_COOKIE;
  delete persistentConfig.AMC_API_COOKIE;
  savePersistentConfig();
}

async function amcGet(pathname, query) {
  const base = amcBaseUrl();
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
  const apiKey = commonApiServerKey();
  if (apiKey) headers["X-API-Key"] = apiKey;
  const cookie = resolvedAmcCookie();
  if (cookie) headers["X-Amc-Cookie"] = cookie;
  const resp = await fetch(u, { method: "GET", headers });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!resp.ok) {
    const err = new Error(`AMC API ${resp.status}: ${text.slice(0, 500)}`);
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

const server = new McpServer({ name: "amc-api", version: "0.1.0" });

// Optional: store an AMC browser session for personalised results.
// Not required — all endpoints work without one.

server.tool(
  "amc_cookie_set",
  "Optionally store your AMC browser session cookie for personalised results. Not required — all endpoints work without one.",
  { cookie: z.string().min(1) },
  async ({ cookie }) => {
    try {
      const stored = setStoredAmcCookie(cookie);
      return asTextContent({ ok: true, stored: true, cookie_length: stored.length });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_cookie_get",
  "Check whether an optional AMC session cookie is stored.",
  {},
  async () => {
    try {
      const cookie = resolvedAmcCookie();
      return asTextContent({ ok: true, configured: Boolean(cookie), cookie_length: cookie ? cookie.length : 0 });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_cookie_clear",
  "Remove a stored AMC session cookie.",
  {},
  async () => {
    try {
      clearStoredAmcCookie();
      return asTextContent({ ok: true, cleared: true });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_cookie_capture",
  "Capture your AMC session cookie from a running Chrome browser and store it for optional personalised results.",
  { domain: z.string().min(1).optional() },
  async ({ domain }) => {
    const resolvedDomain = (domain || "amctheatres.com").trim();
    const script = process.env.AMC_COOKIE_SCRIPT || GETCOOKIES_FALLBACK_PATH;
    try {
      const { stdout } = await execFileAsync("python3", [script, resolvedDomain], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
      const cookie = sanitizeCookie(stdout);
      if (!cookie) return asTextContent({ ok: false, error: "no cookie found in browser" });
      const stored = setStoredAmcCookie(cookie);
      return asTextContent({ ok: true, captured: true, cookie_length: stored.length });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_theatres",
  "Search AMC theatres by zip code or city name.",
  {
    q: z.string().optional(),
    page_url: z.string().url().optional(),
    verbose: z.boolean().optional(),
    timeout: z.number().positive().max(120).optional(),
  },
  async ({ q, page_url, verbose, timeout }) => {
    try {
      const query = {};
      if (q !== undefined) query.q = q;
      if (page_url) query.page_url = page_url;
      if (verbose) query.verbose = true;
      if (timeout !== undefined) query.timeout = timeout;
      const data = await amcGet("/api/amc/theatres", query);
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_showtimes",
  "Showtimes for a theatre or movie. Pass `slug` (e.g. 'amc-kips-bay-15') with optional `date` (YYYY-MM-DD), `movie` name filter, or `premium_offering`.",
  {
    url: z.string().url().optional(),
    region: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    movie: z.string().min(1).optional(),
    date: z.string().optional(),
    premium_offering: z.string().optional(),
    timeout: z.number().positive().max(120).optional(),
  },
  async (args) => {
    try {
      const data = await fetchShowtimesLocal(args);
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_seats",
  "Seat map for a numeric AMC showtime id. Response includes seat_map_url — send that URL as a standalone iMessage so the preview image renders.",
  {
    showtime_id: z.number().int().positive(),
    timeout: z.number().positive().max(120).optional(),
  },
  async ({ showtime_id, timeout }) => {
    try {
      const data = await fetchSeatsLocal(showtime_id, timeout);
      const base = amcBaseUrl().includes("localhost") ? amcBaseUrl() : "https://api.brainrotcreations.com";
      data.seat_map_url = `${base}/api/amc/seats/${showtime_id}`;
      return asTextContent(data);
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
