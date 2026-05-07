#!/usr/bin/env python3
"""
Print Chrome cookies for a domain as a Cookie header string.

Usage:
  python3 plugins/amc-api/tools/getcookies.py amctheatres.com
"""

from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: getcookies.py <domain>", file=sys.stderr)
        return 2

    domain = sys.argv[1].strip()
    if not domain:
        print("Error: domain is required", file=sys.stderr)
        return 2

    try:
        import browser_cookie3  # type: ignore
    except Exception as exc:
        print(
            "Error: browser_cookie3 is required. Install with: pip3 install --user --break-system-packages browser-cookie3",
            file=sys.stderr,
        )
        print(f"Details: {exc}", file=sys.stderr)
        return 1

    try:
        jar = browser_cookie3.chrome(domain_name=domain)
    except Exception as exc:
        print(f"Error reading Chrome cookies for {domain}: {exc}", file=sys.stderr)
        return 1

    print("; ".join(f"{c.name}={c.value}" for c in jar))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
