"""
Catastrophe Risk Analyst — Morning Briefing Agent
==================================================
Fetches live US disaster data (USGS, NWS, FEMA) and cross-references
against a mock insurance portfolio, then asks an LLM to produce a
professional daily briefing report.

Usage:
    python cat_agent.py                          # uses ANTHROPIC_API_KEY env var
    python cat_agent.py --openai                 # uses OPENAI_API_KEY env var
    python cat_agent.py --days 3 --radius 150    # custom lookback & alert radius (miles)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt

import requests

# ── OPTIONAL LLM IMPORTS (detected at runtime) ────────────────────────────────
# We import lazily so the script can still pull raw data without any LLM key.

# ── DEFAULT CONFIG ────────────────────────────────────────────────────────────
DEFAULT_LOOKBACK_DAYS = 7          # how many days back to scan
DEFAULT_RADIUS_MILES = 100         # alert radius around each policyholder
MIN_EARTHQUAKE_MAGNITUDE = 3.5

# ══════════════════════════════════════════════════════════════════════════════
#  MOCK INSURANCE PORTFOLIO
#  Replace / extend these entries to match any real (or demo) portfolio.
# ══════════════════════════════════════════════════════════════════════════════
PORTFOLIO = [
    {
        "policy_id": "POL-001",
        "holder": "Sunshine Plaza LLC",
        "address": "Miami, FL",
        "lat": 25.7617, "lon": -80.1918,
        "state": "FL",
        "coverage": ["Hurricane", "Flood", "Wind"],
        "insured_value": 5_000_000,
    },
    {
        "policy_id": "POL-002",
        "holder": "Smith Family Residence",
        "address": "Oklahoma City, OK",
        "lat": 35.4676, "lon": -97.5164,
        "state": "OK",
        "coverage": ["Tornado", "Hail", "Wind"],
        "insured_value": 350_000,
    },
    {
        "policy_id": "POL-003",
        "holder": "Pacific Coast Warehousing",
        "address": "Los Angeles, CA",
        "lat": 34.0522, "lon": -118.2437,
        "state": "CA",
        "coverage": ["Earthquake", "Wildfire"],
        "insured_value": 12_000_000,
    },
    {
        "policy_id": "POL-004",
        "holder": "Bayou Energy Corp",
        "address": "Houston, TX",
        "lat": 29.7604, "lon": -95.3698,
        "state": "TX",
        "coverage": ["Hurricane", "Flood"],
        "insured_value": 8_500_000,
    },
    {
        "policy_id": "POL-005",
        "holder": "Heartland Grain Co-op",
        "address": "Topeka, KS",
        "lat": 39.0489, "lon": -95.6780,
        "state": "KS",
        "coverage": ["Tornado", "Hail", "Flood"],
        "insured_value": 1_200_000,
    },
    {
        "policy_id": "POL-006",
        "holder": "Riverside Medical Center",
        "address": "New Orleans, LA",
        "lat": 29.9511, "lon": -90.0715,
        "state": "LA",
        "coverage": ["Hurricane", "Flood"],
        "insured_value": 15_000_000,
    },
    {
        "policy_id": "POL-007",
        "holder": "Sierra Tech Campus",
        "address": "San Jose, CA",
        "lat": 37.3382, "lon": -121.8863,
        "state": "CA",
        "coverage": ["Earthquake"],
        "insured_value": 22_000_000,
    },
    {
        "policy_id": "POL-008",
        "holder": "Dixie Lumber Yard",
        "address": "Jackson, MS",
        "lat": 32.2988, "lon": -90.1848,
        "state": "MS",
        "coverage": ["Tornado", "Flood", "Wind"],
        "insured_value": 750_000,
    },
    {
        "policy_id": "POL-009",
        "holder": "Blue Ridge Resort",
        "address": "Asheville, NC",
        "lat": 35.5951, "lon": -82.5515,
        "state": "NC",
        "coverage": ["Flood", "Wind", "Tornado"],
        "insured_value": 3_200_000,
    },
    {
        "policy_id": "POL-010",
        "holder": "Cascade Timber LLC",
        "address": "Portland, OR",
        "lat": 45.5231, "lon": -122.6765,
        "state": "OR",
        "coverage": ["Wildfire", "Earthquake", "Flood"],
        "insured_value": 4_750_000,
    },
]

# ── NWS event keywords → coverage category mapping ───────────────────────────
NWS_COVERAGE_MAP = {
    "Tornado": ["Tornado"],
    "Hail": ["Hail"],
    "Hurricane": ["Hurricane", "Tropical Storm"],
    "Flood": ["Flood", "Flash Flood"],
    "Wind": ["Wind", "Thunderstorm Wind", "Blizzard", "High Wind", "Dust Storm"],
    "Earthquake": ["Earthquake"],
    "Wildfire": ["Fire", "Red Flag"],
}


# ══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles between two lat/lon points."""
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * asin(sqrt(a)) * 3_956  # Earth radius in miles


def fmt_usd(value: int) -> str:
    return f"${value:,.0f}"


def pct(numerator: float, denominator: float) -> str:
    if denominator == 0:
        return "N/A"
    return f"{numerator / denominator * 100:.1f}%"


# ══════════════════════════════════════════════════════════════════════════════
#  DATA SOURCES
# ══════════════════════════════════════════════════════════════════════════════

def fetch_earthquakes(days_back: int, min_mag: float) -> list[dict]:
    """USGS Earthquake Catalog — no API key required."""
    print("  📡 Fetching USGS Earthquakes …")
    start = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    params = {
        "format": "geojson",
        "starttime": start,
        "endtime": end,
        "minmagnitude": min_mag,
        "orderby": "magnitude",
    }
    try:
        r = requests.get(
            "https://earthquake.usgs.gov/fdsnws/event/1/query",
            params=params, timeout=20,
        )
        r.raise_for_status()
        features = r.json().get("features", [])
        print(f"     ✅ {len(features)} earthquake(s) above M{min_mag}")
        return features
    except Exception as exc:
        print(f"     ❌ USGS error: {exc}")
        return []


def fetch_nws_alerts() -> list[dict]:
    """NWS Active Alerts for the contiguous US — no API key required."""
    print("  📡 Fetching NWS Active Weather Alerts …")
    headers = {"User-Agent": "CatRiskAgent/1.0 (demo-tool)"}
    try:
        r = requests.get(
            "https://api.weather.gov/alerts/active?region_type=land",
            headers=headers, timeout=20,
        )
        r.raise_for_status()
        features = r.json().get("features", [])
        # Filter to purely warning/advisory/watch levels
        severe = [
            f for f in features
            if f.get("properties", {}).get("severity") in ("Extreme", "Severe", "Moderate")
        ]
        print(f"     ✅ {len(severe)} active severe/moderate NWS alerts")
        return severe
    except Exception as exc:
        print(f"     ❌ NWS error: {exc}")
        return []


def fetch_fema_declarations(days_back: int) -> list[dict]:
    """FEMA Disaster Declarations — no API key required."""
    print("  📡 Fetching FEMA Disaster Declarations …")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )
    params = {
        "$filter": f"declarationDate ge '{cutoff}'",
        "$orderby": "declarationDate desc",
        "$top": 50,
        "$format": "json",
    }
    try:
        # Note: capitalized entity path is required by the FEMA API
        r = requests.get(
            "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",
            params=params, timeout=25,
        )
        r.raise_for_status()
        data = r.json().get("DisasterDeclarationsSummaries", [])
        print(f"     ✅ {len(data)} FEMA declaration(s)")
        return data
    except Exception as exc:
        print(f"     ❌ FEMA error: {exc}")
        return []


# ══════════════════════════════════════════════════════════════════════════════
#  PORTFOLIO MATCHING
# ══════════════════════════════════════════════════════════════════════════════

def match_earthquakes(quakes: list[dict], radius_miles: float) -> list[dict]:
    hits = []
    for q in quakes:
        props = q.get("properties", {})
        coords = q.get("geometry", {}).get("coordinates", [None, None, None])
        if None in coords[:2]:
            continue
        eq_lon, eq_lat = coords[0], coords[1]
        mag = props.get("mag", 0) or 0
        place = props.get("place", "Unknown")
        time_ms = props.get("time", 0)
        eq_time = (
            datetime.fromtimestamp(time_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            if time_ms else "Unknown"
        )
        for policy in PORTFOLIO:
            if "Earthquake" not in policy["coverage"]:
                continue
            dist = haversine(policy["lat"], policy["lon"], eq_lat, eq_lon)
            if dist <= radius_miles:
                hits.append({
                    "event_type": "Earthquake",
                    "event_id": q.get("id", ""),
                    "event_desc": f"M{mag:.1f} – {place}",
                    "event_time": eq_time,
                    "distance_miles": round(dist, 1),
                    "policy_id": policy["policy_id"],
                    "holder": policy["holder"],
                    "address": policy["address"],
                    "coverage": policy["coverage"],
                    "insured_value": policy["insured_value"],
                    "severity": "High" if mag >= 5.5 else "Moderate" if mag >= 4.0 else "Low",
                })
    return hits


def match_nws_alerts(alerts: list[dict], radius_miles: float) -> list[dict]:
    hits = []
    for alert in alerts:
        props = alert.get("properties", {})
        event_name = props.get("event", "")
        severity = props.get("severity", "Unknown")
        headline = props.get("headline", "")
        sent = props.get("sent", "")
        area_desc = props.get("areaDesc", "")

        # Parse affected states from zone IDs (e.g. "TXZ045" → "TX") AND from areaDesc
        affected_states: set[str] = set()
        for zone_id in (props.get("geocode", {}).get("UGC") or []):
            if len(zone_id) >= 2:
                affected_states.add(zone_id[:2].upper())
        # Also naively pick 2-letter words from areaDesc that look like state abbrevs
        for token in area_desc.replace(",", " ").replace(";", " ").split():
            if len(token) == 2 and token.isupper() and token.isalpha():
                affected_states.add(token)

        # Resolve coverage type
        matched_coverage = None
        for cov_type, keywords in NWS_COVERAGE_MAP.items():
            if any(kw.lower() in event_name.lower() for kw in keywords):
                matched_coverage = cov_type
                break
        if not matched_coverage:
            continue  # irrelevant event type

        for policy in PORTFOLIO:
            if matched_coverage not in policy["coverage"]:
                continue
            if policy["state"] not in affected_states:
                continue
            hits.append({
                "event_type": f"Weather – {event_name}",
                "event_id": props.get("id", ""),
                "event_desc": headline or event_name,
                "event_time": sent,
                "distance_miles": "State-level alert",
                "policy_id": policy["policy_id"],
                "holder": policy["holder"],
                "address": policy["address"],
                "coverage": policy["coverage"],
                "insured_value": policy["insured_value"],
                "severity": severity,
                "area_desc": area_desc[:200],
            })
    return hits


def match_fema(declarations: list[dict]) -> list[dict]:
    hits = []
    state_map = {p["state"]: p for p in PORTFOLIO}  # simplified 1-per-state for demo
    for decl in declarations:
        state = decl.get("state", "")
        incident = decl.get("incidentType", "Unknown")
        title = decl.get("declarationTitle", "")
        declared = decl.get("declarationDate", "")[:10]
        disaster_no = decl.get("disasterNumber", "")

        matched_coverage = None
        for cov_type, keywords in NWS_COVERAGE_MAP.items():
            if any(kw.lower() in incident.lower() for kw in keywords):
                matched_coverage = cov_type
                break

        for policy in PORTFOLIO:
            if policy["state"] != state:
                continue
            if matched_coverage and matched_coverage not in policy["coverage"]:
                continue
            hits.append({
                "event_type": f"FEMA Declaration – {incident}",
                "event_id": str(disaster_no),
                "event_desc": f"DR-{disaster_no}: {title} ({state})",
                "event_time": declared,
                "distance_miles": "State-wide declaration",
                "policy_id": policy["policy_id"],
                "holder": policy["holder"],
                "address": policy["address"],
                "coverage": policy["coverage"],
                "insured_value": policy["insured_value"],
                "severity": "High",
            })
    return hits


# ══════════════════════════════════════════════════════════════════════════════
#  LLM BRIEFING GENERATION
# ══════════════════════════════════════════════════════════════════════════════

def build_prompt(hits: list[dict], raw_summary: dict, radius: int, days: int) -> str:
    total_exposure = sum(h["insured_value"] for h in hits)
    unique_policies = {h["policy_id"] for h in hits}

    hits_json = json.dumps(hits, indent=2, default=str)
    raw_json = json.dumps(raw_summary, indent=2, default=str)

    return f"""You are a senior Catastrophe Risk Analyst at a US property & casualty insurance company.
Today is {datetime.now().strftime("%A, %B %d, %Y")} (local Chicago time).

You have just run a morning scan covering the last {days} day(s) of US natural disaster events.
The scan radius used was {radius} miles around each insured location.

--- RAW DATA SUMMARY ---
{raw_json}

--- MATCHED PORTFOLIO EXPOSURES ---
{hits_json}

Total unique affected policies: {len(unique_policies)}
Total estimated gross insured exposure: ${total_exposure:,.0f}

Please produce a professional MORNING BRIEFING REPORT with the following sections:

1. EXECUTIVE SUMMARY (3–5 sentences max — what happened, which areas, highest exposure)
2. ACTIVE EVENTS BY PERIL (group hits by peril type: Earthquake / Wind / Flood / etc.)
3. PORTFOLIO EXPOSURE TABLE (policy ID | holder | location | peril | insured value | severity)
4. TOP 3 PRIORITY ACTIONS (specific next steps for the CAT team today)
5. DATA SOURCES USED (list the APIs queried)

Use professional insurance industry language. Keep it focused and actionable.
Do NOT invent data not present above. If no events were found for a category, say so briefly.
"""


def generate_briefing_anthropic(prompt: str) -> str:
    try:
        import anthropic
    except ImportError:
        return "[ERROR] 'anthropic' package not installed. Run: pip install anthropic"

    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        return "[ERROR] ANTHROPIC_API_KEY environment variable not set."

    client = anthropic.Anthropic(api_key=key)
    print("\n  🤖 Generating briefing via Claude …")
    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def generate_briefing_openai(prompt: str) -> str:
    try:
        from openai import OpenAI
    except ImportError:
        return "[ERROR] 'openai' package not installed. Run: pip install openai"

    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        return "[ERROR] OPENAI_API_KEY environment variable not set."

    client = OpenAI(api_key=key)
    print("\n  🤖 Generating briefing via GPT-4o …")
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
    )
    return response.choices[0].message.content


def generate_briefing_noai(hits: list[dict], raw_summary: dict) -> str:
    """Fallback: plain-text report with no LLM call."""
    lines = [
        "=" * 70,
        f"  CATASTROPHE RISK MORNING BRIEFING — {datetime.now():%B %d, %Y}",
        "  (No-LLM mode — raw data summary)",
        "=" * 70,
        "",
        f"  Earthquakes scanned : {raw_summary['earthquakes_total']}",
        f"  NWS alerts scanned  : {raw_summary['nws_alerts_total']}",
        f"  FEMA declarations   : {raw_summary['fema_total']}",
        "",
        f"  ⚡ Portfolio matches found: {len(hits)}",
        "",
    ]
    for h in hits:
        lines.append(
            f"  [{h['policy_id']}] {h['holder']} — {h['event_type']} | "
            f"Severity: {h.get('severity','?')} | "
            f"Insured Value: {fmt_usd(h['insured_value'])}"
        )
        lines.append(f"    └─ {h['event_desc']}")
    lines.append("")
    lines.append("  Run with ANTHROPIC_API_KEY or OPENAI_API_KEY for a full LLM briefing.")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Catastrophe Risk Analyst Morning Briefing Agent")
    parser.add_argument("--days", type=int, default=DEFAULT_LOOKBACK_DAYS,
                        help=f"Days to look back (default {DEFAULT_LOOKBACK_DAYS})")
    parser.add_argument("--radius", type=int, default=DEFAULT_RADIUS_MILES,
                        help=f"Alert radius in miles (default {DEFAULT_RADIUS_MILES})")
    parser.add_argument("--min-mag", type=float, default=MIN_EARTHQUAKE_MAGNITUDE,
                        help=f"Minimum earthquake magnitude (default {MIN_EARTHQUAKE_MAGNITUDE})")
    parser.add_argument("--openai", action="store_true",
                        help="Use OpenAI GPT-4o instead of Anthropic Claude")
    parser.add_argument("--no-llm", action="store_true",
                        help="Skip LLM call — print raw data report only")
    parser.add_argument("--output", type=str, default="",
                        help="Save report to this file (optional)")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  🌪️  CATASTROPHE RISK ANALYST — MORNING BRIEFING AGENT")
    print(f"  📅  {datetime.now():%A, %B %d, %Y  %H:%M}")
    print("=" * 60)
    print(f"\n  Scanning last {args.days} day(s) | radius {args.radius} mi | min M{args.min_mag}\n")

    # ── Step 1: Fetch live data ───────────────────────────────────────────────
    print("[ STEP 1 ] Fetching live disaster data …")
    quakes = fetch_earthquakes(args.days, args.min_mag)
    alerts = fetch_nws_alerts()
    fema = fetch_fema_declarations(args.days)

    raw_summary = {
        "report_date": datetime.now().isoformat(),
        "lookback_days": args.days,
        "radius_miles": args.radius,
        "earthquakes_total": len(quakes),
        "nws_alerts_total": len(alerts),
        "fema_total": len(fema),
        "top_earthquakes": [
            {
                "place": q["properties"].get("place"),
                "magnitude": q["properties"].get("mag"),
                "time": datetime.fromtimestamp(
                    q["properties"]["time"] / 1000, tz=timezone.utc
                ).strftime("%Y-%m-%d %H:%M UTC") if q["properties"].get("time") else None,
            }
            for q in quakes[:5]
        ],
        "top_fema_declarations": [
            {
                "state": d.get("state"),
                "incident": d.get("incidentType"),
                "declared": (d.get("declarationDate") or "")[:10],
                "disaster_number": d.get("disasterNumber"),
            }
            for d in fema[:5]
        ],
    }

    # ── Step 2: Cross-reference portfolio ────────────────────────────────────
    print("\n[ STEP 2 ] Matching against insurance portfolio …")
    hits = []
    eq_hits = match_earthquakes(quakes, args.radius)
    nws_hits = match_nws_alerts(alerts, args.radius)
    fema_hits = match_fema(fema)
    hits = eq_hits + nws_hits + fema_hits

    total_exposure = sum(h["insured_value"] for h in hits)
    unique_policies = {h["policy_id"] for h in hits}
    print(f"  ✅ {len(hits)} exposure match(es) across {len(unique_policies)} unique policy(ies)")
    print(f"  💰 Gross estimated exposure: {fmt_usd(total_exposure)}")

    # ── Step 3: Generate briefing ─────────────────────────────────────────────
    print("\n[ STEP 3 ] Generating morning briefing report …")

    if args.no_llm:
        report = generate_briefing_noai(hits, raw_summary)
    else:
        prompt = build_prompt(hits, raw_summary, args.radius, args.days)
        if args.openai:
            report = generate_briefing_openai(prompt)
        else:
            report = generate_briefing_anthropic(prompt)

    # ── Step 4: Output ────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(report)
    print("=" * 60)

    out_path = args.output or f"briefing_{datetime.now():%Y%m%d_%H%M}.txt"
    with open(out_path, "w") as f:
        f.write(report)
    print(f"\n  📄 Report saved → {out_path}\n")


if __name__ == "__main__":
    main()
