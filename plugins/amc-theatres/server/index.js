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

/** Browser session cookie for Queue-it / seats fetch (`X-Amc-Cookie`). */
function resolvedAmcCookie() {
  return getEnv("AMC_COOKIE") || getEnv("AMC_API_COOKIE");
}

function sanitizeCookie(raw) {
  return (raw || "").trim();
}

function setStoredAmcCookie(cookieValue) {
  const cookie = sanitizeCookie(cookieValue);
  persistentConfig.AMC_COOKIE = cookie;
  savePersistentConfig();
  return cookie;
}

function clearStoredAmcCookie() {
  delete persistentConfig.AMC_COOKIE;
  delete persistentConfig.AMC_API_COOKIE;
  savePersistentConfig();
}

function amcBaseUrl() {
  const u = resolvedAmcApiUrl();
  if (u) return u;
  return DEFAULT_AMC_PROXY_BASE.replace(/\/$/, "");
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

server.tool(
  "amc_cookie_set",
  "Store AMC cookie in ~/.config/amc-api/env.json so AMC API tools automatically send X-Amc-Cookie.",
  {
    cookie: z.string().min(1),
  },
  async ({ cookie }) => {
    try {
      const stored = setStoredAmcCookie(cookie);
      return asTextContent({
        ok: true,
        stored: true,
        config_path: CONFIG_PATH,
        cookie_length: stored.length,
        hint: "amc_theatres/amc_showtimes/amc_seats will now auto-send X-Amc-Cookie when no process env override is set.",
      });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_cookie_get",
  "Show whether an AMC cookie is currently configured (without printing full secret).",
  {},
  async () => {
    try {
      const cookie = resolvedAmcCookie();
      return asTextContent({
        ok: true,
        configured: Boolean(cookie),
        source: process.env.AMC_COOKIE
          ? "process.env.AMC_COOKIE"
          : process.env.AMC_API_COOKIE
            ? "process.env.AMC_API_COOKIE"
            : persistentConfig.AMC_COOKIE
              ? CONFIG_PATH
              : null,
        cookie_length: cookie ? cookie.length : 0,
      });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_cookie_clear",
  "Remove stored AMC cookie from ~/.config/amc-api/env.json.",
  {},
  async () => {
    try {
      clearStoredAmcCookie();
      return asTextContent({
        ok: true,
        cleared: true,
        config_path: CONFIG_PATH,
      });
    } catch (error) {
      return asTextContent({ ok: false, error: String(error) });
    }
  },
);

server.tool(
  "amc_cookie_capture",
  "Run local getcookies.py for a domain (default amctheatres.com), then store it for automatic AMC API calls.",
  {
    domain: z.string().min(1).optional(),
    script_path: z.string().optional(),
  },
  async ({ domain, script_path }) => {
    const resolvedDomain = (domain || "amctheatres.com").trim();
    const script = (script_path || process.env.AMC_COOKIE_SCRIPT || GETCOOKIES_FALLBACK_PATH).trim();
    try {
      const { stdout, stderr } = await execFileAsync("python3", [script, resolvedDomain], {
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const cookie = sanitizeCookie(stdout);
      if (!cookie) {
        return asTextContent({
          ok: false,
          error: "cookie capture returned empty output",
          script,
          domain: resolvedDomain,
          stderr: sanitizeCookie(stderr) || null,
        });
      }
      const stored = setStoredAmcCookie(cookie);
      return asTextContent({
        ok: true,
        captured: true,
        stored: true,
        domain: resolvedDomain,
        script,
        config_path: CONFIG_PATH,
        cookie_length: stored.length,
      });
    } catch (error) {
      return asTextContent({
        ok: false,
        error: String(error),
        script,
        domain: resolvedDomain,
      });
    }
  },
);

server.tool(
  "amc_theatres",
  "Theatre search / listing from GET /api/amc/theatres (JSON under `data`). Optional `X-Amc-Cookie` via AMC_COOKIE when Queue-it blocks.",
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
  "Venue or movie showtimes via AMC GraphQL. Pass `url`, or `slug` (e.g. 'amc-kips-bay-15'), or `region`+`slug`; optional `date` (YYYY-MM-DD), `movie` name filter, `premium_offering`. Reads Chrome cookies automatically. Requires tls-client and browser-cookie3 Python packages.",
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
  "Seat map for a numeric AMC showtime id via GraphQL. Auto-fetches cookie from browser. Requires tls-client and browser-cookie3 Python packages. Response includes seat_map_url — send that URL as a standalone iMessage so the preview image renders.",
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
