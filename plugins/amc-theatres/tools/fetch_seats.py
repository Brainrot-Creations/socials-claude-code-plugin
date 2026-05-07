"""Fetch AMC seat map via GraphQL. Outputs JSON to stdout.

Usage:
    python3 fetch_seats.py --showtime-id 142758278 [--cookie "..."]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


_GRAPH_URL = "https://graph.amctheatres.com/"
_HEADERS = {
    "Content-Type": "application/json",
    "X-AMC-Vendor-Key": "amc-web-prod",
    "Origin": "https://www.amctheatres.com",
    "Referer": "https://www.amctheatres.com/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}
_QUERY = "{ viewer { showtime(id: $ID) { showtimeId status seatingLayout { rows columns seats { name row column available seatStatus type shouldDisplay } } } } }"


def _get_cookie_from_browser() -> str:
    script = Path(__file__).parent / "getcookies.py"
    result = subprocess.run(["python3", str(script), "amctheatres.com"], capture_output=True, text=True)
    return result.stdout.strip()


def _graphql_post(query: str, cookie: str) -> dict:
    try:
        import tls_client
        session = tls_client.Session(client_identifier="chrome_124", random_tls_extension_order=True)
        resp = session.post(_GRAPH_URL, json={"query": query}, headers={**_HEADERS, "Cookie": cookie}, timeout_seconds=30)
        return resp.json()
    except ImportError:
        import urllib.request
        data = json.dumps({"query": query}).encode()
        req = urllib.request.Request(_GRAPH_URL, data=data, headers={**_HEADERS, "Cookie": cookie}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())


def fetch_seats(showtime_id: int, cookie: str) -> dict:
    query = _QUERY.replace("$ID", str(showtime_id))
    result = _graphql_post(query, cookie)
    if result.get("errors"):
        raise RuntimeError(f"GraphQL errors: {result['errors']}")

    showtime = (result.get("data") or {}).get("viewer", {}).get("showtime") or {}
    if not showtime:
        raise RuntimeError(f"Showtime {showtime_id} not found")

    layout = showtime.get("seatingLayout") or {}
    seats_raw = layout.get("seats") or []

    by_row: dict[int, list] = defaultdict(list)
    summary = {"total": 0, "available": 0, "occupied": 0, "unavailable": 0}

    for s in seats_raw:
        if not s.get("shouldDisplay") or s.get("type") == "Space":
            continue
        avail = s.get("available", False)
        status_raw = (s.get("seatStatus") or "").lower()
        if avail:
            status = "available"
        elif status_raw == "occupied":
            status = "occupied"
        else:
            status = "unavailable"
        summary["total"] += 1
        summary[status] += 1
        by_row[s["row"]].append({"name": s.get("name", ""), "column": s["column"], "status": status})

    rows_out = []
    for row_num in sorted(by_row.keys()):
        row_seats = sorted(by_row[row_num], key=lambda x: x["column"])
        rs = {"available": 0, "occupied": 0, "unavailable": 0}
        for seat in row_seats:
            rs[seat["status"]] += 1
        rows_out.append({
            "row": str(row_num),
            "summary": rs,
            "seats": [{"number": s["column"], "name": s["name"], "status": s["status"]} for s in row_seats],
        })

    return {
        "kind": "showtimes_seats",
        "showtime_id": showtime_id,
        "status": showtime.get("status"),
        "summary": summary,
        "rows": rows_out,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--showtime-id", type=int, required=True)
    parser.add_argument("--cookie", default="")
    args = parser.parse_args()

    cookie = args.cookie.strip() or _get_cookie_from_browser()
    if not cookie:
        print(json.dumps({"error": "No cookie available. Log in to amctheatres.com first."}))
        sys.exit(1)

    try:
        result = fetch_seats(args.showtime_id, cookie)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
