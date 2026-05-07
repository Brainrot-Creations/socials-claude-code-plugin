#!/usr/bin/env python3
"""
fetch_showtimes.py - AMC showtimes via GraphQL with Chrome TLS fingerprint bypass.

Bypasses Cloudflare on graph.amctheatres.com by using tls_client (uTLS/Chrome fingerprint)
and reading Chrome's own AMC session cookie to set the correct business date.

Usage:
  python3 fetch_showtimes.py [--slug SLUG] [--region REGION] [--url URL]
                             [--movie MOVIE] [--date YYYY-MM-DD]
                             [--premium-offering FORMAT]
  Outputs JSON to stdout.
"""
import sys
import json
import argparse
import base64
import re
from urllib.parse import quote, unquote, urlparse
from datetime import datetime, timezone, date as date_type, timedelta

# ── dependency check ──────────────────────────────────────────────────────────

def _check(pkg, install_cmd):
    try:
        return __import__(pkg)
    except ImportError:
        print(json.dumps({"ok": False, "error":
            f"Missing: {pkg}. Install with: {install_cmd}"}))
        sys.exit(0)

tls_client    = _check("tls_client",    "pip3 install --user --break-system-packages tls-client typing_extensions")
browser_cookie3 = _check("browser_cookie3", "pip3 install --user --break-system-packages browser-cookie3")

# ── GraphQL client ────────────────────────────────────────────────────────────

GRAPH_URL  = "https://graph.amctheatres.com/"
VENDOR_KEY = "amc-web-prod"

def _make_session():
    return tls_client.Session(client_identifier="chrome_124", random_tls_extension_order=True)

def _graph_headers(cookie_str: str) -> dict:
    return {
        "Content-Type": "application/json",
        "X-AMC-Vendor-Key": VENDOR_KEY,
        "Origin": "https://www.amctheatres.com",
        "Referer": "https://www.amctheatres.com/",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Cookie": cookie_str,
    }

def gql(sess, cookie_str: str, query: str, variables: dict = None):
    r = sess.post(GRAPH_URL, headers=_graph_headers(cookie_str),
                  json={"query": query, "variables": variables or {}})
    if r.status_code != 200:
        raise RuntimeError(f"GraphQL HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    if data.get("errors"):
        raise RuntimeError(f"GraphQL errors: {data['errors']}")
    return data.get("data", {})

# ── cookie helpers ────────────────────────────────────────────────────────────

def _get_chrome_cookies() -> str:
    """Return amctheatres.com cookie string from Chrome."""
    jar = browser_cookie3.chrome(domain_name="amctheatres.com")
    parts = [f"{c.name}={c.value}" for c in jar]
    return "; ".join(parts)

def _days_since_epoch(d: date_type) -> int:
    return (d - date_type(1970, 1, 1)).days

def _patch_session_date(cookie_str: str, target_date: date_type) -> str:
    """Rewrite the 'session' cookie so AMC returns showtimes for target_date."""
    cookies = {}
    for part in cookie_str.split("; "):
        if "=" in part:
            k, v = part.split("=", 1)
            cookies[k.strip()] = v.strip()

    raw = cookies.get("session", "")
    if not raw:
        return cookie_str

    try:
        decoded = unquote(raw)
        # base64 padding
        padding = 4 - len(decoded) % 4
        if padding != 4:
            decoded += "=" * padding
        session_data = json.loads(base64.b64decode(decoded))
    except Exception:
        return cookie_str

    session_data["nowInDays"] = _days_since_epoch(target_date)
    session_data["lastViewedDate"] = target_date.strftime("%Y-%m-%dT12:00:00.000Z")

    new_raw = base64.b64encode(
        json.dumps(session_data, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    new_raw_encoded = quote(new_raw)

    parts = []
    for part in cookie_str.split("; "):
        if part.startswith("session="):
            parts.append(f"session={new_raw_encoded}")
        else:
            parts.append(part)
    return "; ".join(parts)

# ── slug resolution ───────────────────────────────────────────────────────────

def _slug_from_url(url: str) -> str:
    """Extract theatre slug from an AMC URL like /theatres/new-york/amc-kips-bay-15"""
    parsed = urlparse(url)
    m = re.search(r"/theatres/[^/]+/([^/?#]+)", parsed.path)
    return m.group(1) if m else ""

def _normalize_slug(slug: str, region: str = "") -> str:
    """Ensure slug is in the form AMC expects (without region prefix)."""
    # strip leading region: "new-york/amc-kips-bay-15" → "amc-kips-bay-15"
    if "/" in slug:
        slug = slug.split("/")[-1]
    return slug.strip("/")

# ── GraphQL query ─────────────────────────────────────────────────────────────

SHOWTIMES_QUERY = """
{
  viewer {
    theatre(slug: $SLUG) {
      name
      theatreId
      slug
      timezoneAbbreviation
      utcOffset
      formats {
        items {
          attributes { name code }
          groups(first: 100) {
            edges {
              node {
                showtimes(first: 200) {
                  edges {
                    node {
                      showtimeId
                      showDateTimeUtc
                      status
                      auditorium
                      isReservedSeating
                      movie {
                        name
                        slug
                        movieId
                        mpaaRating
                        runTime
                        genre
                        synopsis
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
"""

# ── data shaping ──────────────────────────────────────────────────────────────

def _utc_to_et(utc_str: str) -> str:
    """Convert UTC ISO string to rough Eastern time display (UTC-4 in summer)."""
    try:
        dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
        et = dt - timedelta(hours=4)  # EDT; adjust to -5 for EST if needed
        return et.strftime("%-I:%M %p ET")
    except Exception:
        return utc_str

def _format_showtimes(raw: dict, filter_date: date_type, filter_movie: str = "",
                       filter_format: str = "") -> dict:
    theatre = raw.get("viewer", {}).get("theatre") or {}
    if not theatre or not theatre.get("theatreId"):
        return {"ok": False, "error": "Theatre not found"}

    movie_filter_lc = filter_movie.lower() if filter_movie else ""
    format_filter_lc = filter_format.lower() if filter_format else ""

    movies_out = {}
    seen_ids = set()

    for item in theatre.get("formats", {}).get("items") or []:
        fmt_attrs = [a["name"] for a in (item.get("attributes") or [])]
        fmt_name  = fmt_attrs[0] if fmt_attrs else "Standard"
        fmt_codes = [a["code"] for a in (item.get("attributes") or [])]

        if format_filter_lc and not any(
            format_filter_lc in (a or "").lower() for a in fmt_attrs + fmt_codes
        ):
            continue

        for ge in (item.get("groups", {}).get("edges") or []):
            node = ge["node"]

            for se in (node.get("showtimes", {}).get("edges") or []):
                st    = se["node"]
                st_id = st.get("showtimeId")

                # each showtime carries its own correct movie — use that, not group.movie
                movie = st.get("movie") or {}
                mname = movie.get("name", "Unknown")

                if movie_filter_lc and movie_filter_lc not in mname.lower():
                    continue

                # deduplicate: same showtime can appear in multiple format groups
                if st_id in seen_ids:
                    continue
                seen_ids.add(st_id)

                utc = st.get("showDateTimeUtc", "")
                try:
                    dt_utc = datetime.fromisoformat(utc.replace("Z", "+00:00"))
                except Exception:
                    continue

                # AMC business day: a show at 00:00-03:59 UTC belongs to prior calendar day
                business_date = dt_utc.date()
                if dt_utc.hour < 4:
                    business_date = (dt_utc - timedelta(days=1)).date()

                if business_date != filter_date:
                    continue

                slug = movie.get("slug", "")
                if slug not in movies_out:
                    movies_out[slug] = {
                        "movie":       mname,
                        "slug":        slug,
                        "movieId":     movie.get("movieId"),
                        "mpaaRating":  movie.get("mpaaRating"),
                        "runTime":     movie.get("runTime"),
                        "genre":       movie.get("genre"),
                        "synopsis":    movie.get("synopsis"),
                        "showtimes":   [],
                    }

                movies_out[slug]["showtimes"].append({
                    "showtimeId":        st_id,
                    "showDateTimeUtc":   utc,
                    "timeET":            _utc_to_et(utc),
                    "format":            fmt_name,
                    "status":            st.get("status"),
                    "auditorium":        st.get("auditorium"),
                    "isReservedSeating": st.get("isReservedSeating"),
                })

    # sort showtimes per movie by time
    for mv in movies_out.values():
        mv["showtimes"].sort(key=lambda s: s["showDateTimeUtc"])

    # drop movies with no showtimes on this date
    playing = {k: v for k, v in movies_out.items() if v["showtimes"]}

    return {
        "ok": True,
        "theatre": {
            "name":      theatre.get("name"),
            "theatreId": theatre.get("theatreId"),
            "slug":      theatre.get("slug"),
            "timezone":  theatre.get("timezoneAbbreviation"),
        },
        "date":   filter_date.isoformat(),
        "count":  sum(len(m["showtimes"]) for m in playing.values()),
        "movies": list(playing.values()),
    }

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug",             default="")
    ap.add_argument("--region",           default="")
    ap.add_argument("--url",              default="")
    ap.add_argument("--movie",            default="")
    ap.add_argument("--date",             default="")
    ap.add_argument("--premium-offering", default="")
    args = ap.parse_args()

    # resolve theatre slug
    slug = args.slug or ""
    if not slug and args.url:
        slug = _slug_from_url(args.url)
    if not slug:
        print(json.dumps({"ok": False, "error": "Provide --slug, --url, or --region+--slug"}))
        return
    slug = _normalize_slug(slug, args.region)

    # resolve date (default: today ET ≈ today UTC, but note AMC business day)
    if args.date:
        try:
            target = date_type.fromisoformat(args.date)
        except ValueError:
            print(json.dumps({"ok": False, "error": f"Invalid date: {args.date}. Use YYYY-MM-DD."}))
            return
    else:
        # Default to "today" in ET. If it's before 4am UTC, that's yesterday's business day.
        now_utc = datetime.now(timezone.utc)
        if now_utc.hour < 4:
            target = (now_utc - timedelta(days=1)).date()
        else:
            target = now_utc.date()

    # get cookies from Chrome
    try:
        cookie_str = _get_chrome_cookies()
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Could not read Chrome cookies: {e}"}))
        return

    if not cookie_str:
        print(json.dumps({"ok": False, "error": "No AMC cookies in Chrome. Visit amctheatres.com first."}))
        return

    # patch session date
    cookie_str = _patch_session_date(cookie_str, target)

    # run GraphQL query
    query = SHOWTIMES_QUERY.replace("$SLUG", json.dumps(slug))
    try:
        sess = _make_session()
        raw  = gql(sess, cookie_str, query)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return

    # shape and output
    result = _format_showtimes(
        raw,
        filter_date   = target,
        filter_movie  = args.movie,
        filter_format = args.premium_offering,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
