"""
CAT Risk Analyst Birthday Suite — Flask Backend
================================================
Run:  python3 app.py
Then open http://localhost:5050 in your browser.

OpenRouter key is configured below (or via OPENROUTER_API_KEY env var).
"""

import json
import os
import random
from datetime import datetime, timezone
from math import cos, radians, sin, sqrt, asin

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

# ── Import data functions from existing cat_agent ────────────────────────────
from cat_agent import (
    PORTFOLIO,
    NWS_COVERAGE_MAP,
    fetch_earthquakes,
    fetch_fema_declarations,
    fetch_nws_alerts,
    haversine,
    match_earthquakes,
    match_fema,
    match_nws_alerts,
)

app = Flask(__name__)
CORS(app)

# ── OpenRouter config ─────────────────────────────────────────────────────────
OPENROUTER_API_KEY = os.getenv(
    "OPENROUTER_API_KEY",
    "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",
)
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "anthropic/claude-haiku-4-5"   # fast + cheap for most calls
HEAVY_MODEL = "anthropic/claude-opus-4-5"      # used for morning briefing
DEFAULT_DAYS = 7
DEFAULT_RADIUS = 100


# ══════════════════════════════════════════════════════════════════════════════
#  LLM HELPER
# ══════════════════════════════════════════════════════════════════════════════

def llm(prompt: str, model: str = DEFAULT_MODEL, max_tokens: int = 1500) -> str:
    """Call OpenRouter (OpenAI-compatible endpoint)."""
    try:
        from openai import OpenAI
    except ImportError:
        return "[ERROR] openai package not installed. Run: pip3 install openai"

    client = OpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE,
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        extra_headers={
            "HTTP-Referer": "http://localhost:5050",
            "X-Title": "CAT Risk Birthday Suite",
        },
    )
    return resp.choices[0].message.content


# ══════════════════════════════════════════════════════════════════════════════
#  SEASON HELPER
# ══════════════════════════════════════════════════════════════════════════════

def get_season() -> dict:
    month = datetime.now().month
    if 6 <= month <= 11:
        return {
            "name": "Hurricane Season",
            "icon": "🌀",
            "color": "#ff4757",
            "desc": "High-stress real-time monitoring — live-CAT updates to leadership.",
            "mode": "hurricane",
        }
    elif month in (12, 1):
        return {
            "name": "Renewal Season",
            "icon": "📋",
            "color": "#ffa502",
            "desc": "High-volume data processing — thousands of policies re-modeling.",
            "mode": "renewal",
        }
    else:
        return {
            "name": "Off-Season",
            "icon": "🔬",
            "color": "#2ed573",
            "desc": "Model validation — testing the software's math against historical data.",
            "mode": "offseason",
        }


# ══════════════════════════════════════════════════════════════════════════════
#  PORTFOLIO ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

def compute_portfolio_stats() -> dict:
    peril_exposure: dict[str, float] = {}
    peril_count: dict[str, int] = {}
    total = 0.0

    for p in PORTFOLIO:
        total += p["insured_value"]
        for cov in p["coverage"]:
            peril_exposure[cov] = peril_exposure.get(cov, 0) + p["insured_value"]
            peril_count[cov] = peril_count.get(cov, 0) + 1

    # Sort perils by exposure
    perils = sorted(peril_exposure.items(), key=lambda x: x[1], reverse=True)

    return {
        "total_insured_value": total,
        "policy_count": len(PORTFOLIO),
        "perils": [
            {
                "name": k,
                "exposure": v,
                "policy_count": peril_count[k],
                "pct": round(v / total * 100, 1),
            }
            for k, v in perils
        ],
        "portfolio": PORTFOLIO,
    }


def compute_ep_curve() -> list[dict]:
    """
    Exceedance Probability curve.
    We simulate annual loss draws using a simple parametric model seeded by
    portfolio TIV, then sort them to build a return-period curve.
    This is a demonstration model — real EP uses RMS/AIR vendor models.
    """
    random.seed(42)
    total_tiv = sum(p["insured_value"] for p in PORTFOLIO)
    simulations = 10_000
    annual_losses = []

    for _ in range(simulations):
        # Simplified: each year has a probability of one or more events
        year_loss = 0.0
        for p in PORTFOLIO:
            for peril in p["coverage"]:
                # Rough frequency/severity by peril
                freq_sev = {
                    "Hurricane": (0.08, 0.30),
                    "Flood": (0.10, 0.05),
                    "Tornado": (0.12, 0.04),
                    "Earthquake": (0.03, 0.45),
                    "Wildfire": (0.06, 0.20),
                    "Hail": (0.18, 0.03),
                    "Wind": (0.20, 0.02),
                }
                freq, sev_mean = freq_sev.get(peril, (0.05, 0.05))
                if random.random() < freq:
                    loss_ratio = random.lognormvariate(
                        -2.5 + (sev_mean - 0.05) * 2,
                        0.8
                    )
                    loss_ratio = min(loss_ratio, sev_mean * 3)
                    year_loss += p["insured_value"] * loss_ratio
        annual_losses.append(year_loss)

    annual_losses.sort(reverse=True)
    n = len(annual_losses)

    # Return period points to plot
    return_periods = [2, 5, 10, 25, 50, 100, 200, 250, 500, 1000]
    curve = []
    for rp in return_periods:
        idx = int(n / rp)
        idx = max(0, min(idx, n - 1))
        curve.append({
            "return_period": rp,
            "exceedance_prob": round(1 / rp * 100, 2),
            "loss": round(annual_losses[idx]),
            "loss_pct_tiv": round(annual_losses[idx] / total_tiv * 100, 2),
        })
    return curve


def compute_pml() -> dict:
    """Probable Maximum Loss at standard return periods."""
    ep = compute_ep_curve()
    ep_map = {row["return_period"]: row for row in ep}
    total_tiv = sum(p["insured_value"] for p in PORTFOLIO)

    return {
        "total_tiv": total_tiv,
        "pml_100": ep_map.get(100, {}),
        "pml_250": ep_map.get(250, {}),
        "pml_500": ep_map.get(500, {}),
        "note": (
            "Demonstration model only. Real PML uses RMS (Moody's) or AIR (Verisk) "
            "vendor platforms with full stochastic event sets."
        ),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  ROUTES — Static
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok", "time": datetime.now(timezone.utc).isoformat()})


# ══════════════════════════════════════════════════════════════════════════════
#  ROUTES — Data (no LLM)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/season")
def api_season():
    return jsonify(get_season())


@app.get("/api/portfolio")
def api_portfolio():
    return jsonify(compute_portfolio_stats())


@app.get("/api/ep-curve")
def api_ep_curve():
    return jsonify(compute_ep_curve())


@app.get("/api/pml")
def api_pml():
    return jsonify(compute_pml())


@app.get("/api/events")
def api_events():
    days = int(request.args.get("days", DEFAULT_DAYS))
    radius = int(request.args.get("radius", DEFAULT_RADIUS))

    quakes = fetch_earthquakes(days, 3.5)
    alerts = fetch_nws_alerts()
    fema = fetch_fema_declarations(days)

    # Serialize earthquakes
    quake_rows = []
    for q in quakes[:50]:
        props = q.get("properties", {})
        coords = q.get("geometry", {}).get("coordinates", [None, None, None])
        mag = props.get("mag", 0) or 0
        quake_rows.append({
            "type": "Earthquake",
            "title": f"M{mag:.1f} — {props.get('place', 'Unknown')}",
            "severity": "High" if mag >= 6.0 else "Moderate" if mag >= 4.5 else "Low",
            "time": datetime.fromtimestamp(
                props.get("time", 0) / 1000, tz=timezone.utc
            ).strftime("%Y-%m-%d %H:%M UTC") if props.get("time") else "",
            "lat": coords[1],
            "lon": coords[0],
            "magnitude": mag,
        })

    # Serialize NWS alerts
    alert_rows = []
    for a in alerts[:50]:
        props = a.get("properties", {})
        alert_rows.append({
            "type": "Weather",
            "title": props.get("event", "Unknown"),
            "severity": props.get("severity", "Unknown"),
            "time": props.get("sent", ""),
            "area": props.get("areaDesc", "")[:100],
            "headline": props.get("headline", "")[:150],
        })

    # Serialize FEMA
    fema_rows = []
    for d in fema[:20]:
        fema_rows.append({
            "type": "FEMA",
            "title": f"DR-{d.get('disasterNumber')}: {d.get('incidentType')}",
            "severity": "High",
            "time": (d.get("declarationDate") or "")[:10],
            "state": d.get("state", ""),
            "area": d.get("declarationTitle", ""),
        })

    # Portfolio hits
    hits = match_earthquakes(quakes, radius) + match_nws_alerts(alerts, radius) + match_fema(fema)

    return jsonify({
        "earthquakes": quake_rows,
        "alerts": alert_rows,
        "fema": fema_rows,
        "portfolio_hits": hits,
        "summary": {
            "earthquake_count": len(quakes),
            "alert_count": len(alerts),
            "fema_count": len(fema),
            "hit_count": len(hits),
            "total_exposure": sum(h["insured_value"] for h in hits),
        },
    })


# ══════════════════════════════════════════════════════════════════════════════
#  ROUTES — LLM-powered
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/briefing")
def api_briefing():
    days = int(request.args.get("days", DEFAULT_DAYS))
    radius = int(request.args.get("radius", DEFAULT_RADIUS))

    quakes = fetch_earthquakes(days, 3.5)
    alerts = fetch_nws_alerts()
    fema = fetch_fema_declarations(days)

    hits = match_earthquakes(quakes, radius) + match_nws_alerts(alerts, radius) + match_fema(fema)
    total_exposure = sum(h["insured_value"] for h in hits)
    unique_policies = list({h["policy_id"] for h in hits})

    prompt = f"""You are a senior Catastrophe Risk Analyst at a US P&C insurance company.
Date: {datetime.now().strftime("%A, %B %d, %Y")} | Lookback: {days} days | Radius: {radius} miles

RAW DATA:
- Earthquakes above M3.5: {len(quakes)} (top: {quakes[0]["properties"].get("place","") if quakes else "none"})
- NWS severe alerts: {len(alerts)}
- FEMA declarations: {len(fema)}

PORTFOLIO EXPOSURE MATCHES:
{json.dumps(hits[:15], indent=2, default=str)}

Total gross exposure: ${total_exposure:,.0f} across {len(unique_policies)} policies.

Write a professional MORNING BRIEFING REPORT:

## Executive Summary
(3-4 sentences: what happened, which areas, peak exposure)

## Active Events by Peril
(Group portfolio hits by peril type. For each: policy, location, insured value, severity)

## Priority Actions for Today
(3-5 specific steps for the CAT team — numbered list)

## Data Sources
USGS Earthquake Catalog | NWS Active Alerts | FEMA Disaster Declarations

Be concise, professional, and actionable. Use real insurance terminology."""

    report = llm(prompt, model=HEAVY_MODEL, max_tokens=1800)
    return jsonify({
        "report": report,
        "hits": hits,
        "summary": {
            "hit_count": len(hits),
            "total_exposure": total_exposure,
            "unique_policies": len(unique_policies),
            "event_counts": {
                "earthquakes": len(quakes),
                "alerts": len(alerts),
                "fema": len(fema),
            },
        },
    })


@app.get("/api/claims-triage")
def api_claims_triage():
    days = int(request.args.get("days", DEFAULT_DAYS))
    radius = int(request.args.get("radius", DEFAULT_RADIUS))

    quakes = fetch_earthquakes(days, 3.5)
    alerts = fetch_nws_alerts()
    fema = fetch_fema_declarations(days)
    hits = match_earthquakes(quakes, radius) + match_nws_alerts(alerts, radius) + match_fema(fema)

    if not hits:
        return jsonify({
            "triage": [],
            "summary": "No portfolio exposures matched current events. No claims expected today.",
            "raw_report": "No active exposures to triage.",
        })

    prompt = f"""You are a CAT Claims Triage Specialist at a US insurance company.
Date: {datetime.now().strftime("%B %d, %Y")}

Below are portfolio policyholders potentially affected by recent natural disasters.
Your job: rank them by claim likelihood and urgency.

Exposure data:
{json.dumps(hits, indent=2, default=str)}

For EACH affected policyholder produce a JSON array like:
[
  {{
    "rank": 1,
    "policy_id": "POL-001",
    "holder": "Name",
    "event": "Event description",
    "claim_likelihood": "High/Medium/Low",
    "urgency": "Immediate/Same-day/Monitor",
    "recommended_action": "Specific action for the claims team",
    "estimated_claim_range": "$X – $Y"
  }}
]

Return ONLY the JSON array, nothing else."""

    raw = llm(prompt, model=DEFAULT_MODEL, max_tokens=1500)

    # Try to parse the LLM JSON response
    triage = []
    try:
        # Strip markdown code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
        triage = json.loads(cleaned.strip())
    except Exception:
        triage = []

    return jsonify({
        "triage": triage,
        "raw_report": raw,
        "hit_count": len(hits),
    })


@app.post("/api/underwriting")
def api_underwriting():
    data = request.get_json(force=True) or {}
    prop = data.get("property", {})

    name = prop.get("name", "Unknown Property")
    address = prop.get("address", "Unknown")
    state = prop.get("state", "TX")
    lat = float(prop.get("lat", 35.0))
    lon = float(prop.get("lon", -95.0))
    insured_value = float(prop.get("insured_value", 1_000_000))
    construction = prop.get("construction", "Wood Frame")
    year_built = prop.get("year_built", 2000)
    perils = prop.get("perils", ["Wind", "Flood"])
    occupancy = prop.get("occupancy", "Commercial")

    # Compute proximity to existing portfolio concentrations
    nearby = [
        {**p, "dist": round(haversine(p["lat"], p["lon"], lat, lon), 1)}
        for p in PORTFOLIO
        if haversine(p["lat"], p["lon"], lat, lon) <= 200
    ]
    concentration_tiv = sum(p["insured_value"] for p in nearby)

    pml = compute_pml()
    season = get_season()

    prompt = f"""You are a senior Catastrophe Risk Analyst advising an Underwriter.
Date: {datetime.now().strftime("%B %d, %Y")} | Current season: {season["name"]}

A new submission has arrived. Provide a WRITE / DON'T WRITE recommendation.

PROPERTY DETAILS:
- Name: {name}
- Address: {address}, {state}
- Insured Value: ${insured_value:,.0f}
- Construction: {construction} | Year Built: {year_built}
- Occupancy: {occupancy}
- Perils requested: {", ".join(perils)}

EXISTING PORTFOLIO CONTEXT:
- Current portfolio TIV: ${pml["total_tiv"]:,.0f}
- 1-in-100 PML: ${pml["pml_100"].get("loss", 0):,.0f} ({pml["pml_100"].get("loss_pct_tiv", 0)}% of TIV)
- 1-in-250 PML: ${pml["pml_250"].get("loss", 0):,.0f} ({pml["pml_250"].get("loss_pct_tiv", 0)}% of TIV)
- Nearby policies (within 200mi): {len(nearby)} | Concentration TIV: ${concentration_tiv:,.0f}

Write an UNDERWRITING RECOMMENDATION in this format:

## Decision: [✅ WRITE / ⚠️ CONDITIONAL WRITE / ❌ DECLINE]

## Risk Assessment
(2-3 sentences on the key risk factors for this property)

## Accumulation Impact
(How does adding this policy affect concentration risk?)

## Recommended Terms
(If writing: suggest premium loading %, sublimits, exclusions if any)

## Conditions / Red Flags
(Any specific concerns the underwriter must address before binding)

Use professional, concise insurance underwriting language."""

    report = llm(prompt, model=DEFAULT_MODEL, max_tokens=1200)
    return jsonify({
        "report": report,
        "nearby_count": len(nearby),
        "concentration_tiv": concentration_tiv,
        "pml": pml,
    })


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    host = "0.0.0.0"
    port = 5050
    print(f"\n  🌪️  CAT Risk Birthday Suite starting on http://localhost:{port}\n")
    app.run(host=host, port=port, debug=True)
