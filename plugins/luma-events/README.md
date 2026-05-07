# Luma API MCP

Calls **`GET https://api.shubhthorat.com/api/luma/*`** by default — **no env or API key required**. Optional env overrides if you self-host or want an `X-API-Key` header.

## Tools

- `luma_discover` — compact Discover JSON + summary.
- `luma_events_by_place` — events by `discover_place_api_id`.
- `luma_events_by_category` — events by category slug + lat/lon.
- `luma_calendar_items` — slim upcoming rows for a `calendar_api_id`.
- `luma_calendar_full` — full `calendar/get` payload (large).

## Environment (optional)

| Variable | When to set |
|----------|-------------|
| `LUMA_API_URL` | Different base than `https://api.shubhthorat.com` |
| `API_SERVER_URL` / `API_SERVER_HOST` | Same, if you prefer shared naming |
| `LUMA_API_KEY` / `API_SERVER_KEY` / `API_KEY` | Only if your proxy requires `X-API-Key` |

Persistent file (optional): `~/.config/luma-api/env.json` — same keys; process env wins per key.

## Setup

`/reload-plugins` after install. Rebuild after editing `server/index.js`:

```bash
cd server && npm install && npm run build
```
