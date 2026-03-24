# 🌪️ Catastrophe Risk Analyst — Morning Briefing Agent

An AI agent that does **exactly what a CAT Risk Analyst does every morning**:
fetches live US natural disaster data, cross-references it against an insurance portfolio,
and produces a professional briefing report — all in one command.

---

## ⚡ Quick Start (2 minutes)

```bash
cd cat_agent

# 1. Install dependencies
pip install -r requirements.txt

# 2. Set your API key (Anthropic Claude — recommended)
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. Run the agent!
python cat_agent.py
```

A timestamped report file (e.g. `briefing_20260324_1042.txt`) will be saved automatically.

---

## 📋 Options

| Flag | Default | Description |
|------|---------|-------------|
| `--days N` | 7 | How many days back to scan |
| `--radius N` | 100 | Alert radius in miles around each policyholder |
| `--min-mag X` | 3.5 | Minimum earthquake magnitude to include |
| `--openai` | off | Use GPT-4o instead of Claude |
| `--no-llm` | off | Skip LLM — print raw data matches only (free) |
| `--output FILE` | auto | Save report to a specific filename |

### Examples

```bash
# Last 3 days, 150-mile radius
python cat_agent.py --days 3 --radius 150

# Use OpenAI instead
python cat_agent.py --openai

# Test data fetch without any API key
python cat_agent.py --no-llm

# Save to a specific file
python cat_agent.py --output morning_report.txt
```

---

## 💰 Cost

| Resource | Cost |
|----------|------|
| FEMA Disaster Declarations API | ✅ Free, no key |
| USGS Earthquake Catalog API | ✅ Free, no key |
| NWS Active Alerts API | ✅ Free, no key |
| LLM (Claude/GPT-4o) | ~$0.01–$0.10 per run |

**You only need your existing LLM API key.**

---

## 🗂️ Mock Portfolio

The script ships with 10 sample policyholders across the US covering:
- Hurricane / Flood / Wind (FL, TX, LA, NC, MS)
- Tornado / Hail (OK, KS, MS)
- Earthquake (CA)
- Wildfire (CA, OR)

Edit the `PORTFOLIO` list in `cat_agent.py` to add real or demo locations.

---

## 📡 Data Sources

| API | What it provides |
|-----|-----------------|
| `earthquake.usgs.gov` | All US earthquakes above minimum magnitude |
| `api.weather.gov/alerts/active` | All active severe/extreme weather alerts |
| `fema.gov/api/open/v2/...` | Recent federal disaster declarations |

All three are **100% free, public APIs** — no registration required.

---

## 🤖 How It Works

```
[ Fetch ] USGS + NWS + FEMA
    ↓
[ Match ] Cross-reference lat/lon against portfolio (haversine distance)
         + state-level matching for weather alerts & FEMA declarations
    ↓
[ Analyze ] Send matched exposures to Claude / GPT-4o
    ↓
[ Report ] Professional morning briefing saved to file
```
