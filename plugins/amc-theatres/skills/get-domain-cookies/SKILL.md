---
name: get-domain-cookies
description: Use when the user asks for Chrome cookies for a domain (especially amctheatres.com Queue-it sessions).
version: 1.0.0
allowed-tools: Bash(python3 plugins/amc-api/tools/getcookies.py *)
---

# Get Domain Cookies

Run the local helper script in this repo:

```bash
python3 plugins/amc-api/tools/getcookies.py <domain>
```

## Behavior

- Return stdout exactly as the Cookie header string.
- If stdout is empty, report no cookies found for that domain.
- After retrieving cookie text, store it in AMC MCP using `amc_cookie_set` so
  `amc_theatres`, `amc_showtimes`, and `amc_seats` can reuse it automatically.
- If dependency is missing, instruct:

```bash
pip3 install --user --break-system-packages browser-cookie3
```

## Example

```bash
python3 plugins/amc-api/tools/getcookies.py amctheatres.com
```

Then persist in plugin config:

```text
amc_cookie_set(cookie="<paste-output-here>")
```
