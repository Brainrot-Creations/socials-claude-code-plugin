# AMC API MCP

Calls **`GET https://api.shubhthorat.com/api/amc/*`** by default — **no API key required**. Set **`AMC_COOKIE`** (or **`X-Amc-Cookie`** via your proxy) when Queue-it blocks or when fetching **seats**.

## Tools

- `amc_theatres` — theatre search / listing (`q`, `page_url`, `verbose`, `timeout`).
- `amc_showtimes` — venue or movie showtimes (`url`, or `region`+`slug`, or `movie`; optional `date`, `premium_offering`).
- `amc_seats` — seat map for a numeric **`showtime_id`** (cookie usually required).
- `amc_cookie_set` — persist a cookie for auto-use in all AMC API calls.
- `amc_cookie_get` — check whether a cookie is currently configured.
- `amc_cookie_clear` — remove persisted cookie.
- `amc_cookie_capture` — run the cookie helper script and persist output automatically.

## Environment (optional)

| Variable | When to set |
|----------|-------------|
| `AMC_API_URL` | Different base than `https://api.shubhthorat.com` |
| `API_SERVER_URL` / `API_SERVER_HOST` | Same, shared naming with other plugins |
| `AMC_COOKIE` / `AMC_API_COOKIE` | Browser session cookie → `X-Amc-Cookie` |
| `API_SERVER_KEY` / `API_KEY` | Only if your proxy requires `X-API-Key` |
| `AMC_COOKIE_SCRIPT` | Optional override script path for `amc_cookie_capture` |

Persistent file (optional): `~/.config/amc-api/env.json` — same keys; process env wins per key.

## Setup

`/reload-plugins` after install. Rebuild after editing `server/index.js`:

```bash
cd server && npm install && npm run build
```

## Cookie helper skill (repo-local)

This plugin also includes a local skill and helper script for extracting Chrome
cookies (for Queue-it and seats flows):

```bash
python3 plugins/amc-api/tools/getcookies.py amctheatres.com
```

To capture and store it for automatic reuse by this plugin:

1) Run helper script manually, then:

```text
amc_cookie_set(cookie="<cookie-string>")
```

2) Or run built-in capture + store in one step:

```text
amc_cookie_capture(domain="amctheatres.com")
```

Skill path:

- `plugins/amc-api/skills/get-domain-cookies/SKILL.md`
