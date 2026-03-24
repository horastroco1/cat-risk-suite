# CAT Risk Suite — Product Requirements Document (PRD)

**Version:** 1.0  
**Last updated:** 2026-03-24  
**Status:** Draft — pending external validation  
**Product:** Single-user daily operations dashboard for a **Catastrophe Risk Analyst (Insurance)** based in **Chicago, IL**, monitoring **United States** exposure.

---

## 1. Executive summary

**CAT Risk Suite** is a personal, daily-use web application that helps a catastrophe risk analyst:

- Monitor **new or evolving** natural hazard events across the US.
- **Intersect** those events with a **portfolio of insured locations** (limits, perils, geography).
- Produce a **morning-style briefing** and **prioritized follow-ups** (triage mindset), with clear separation between **data from authoritative feeds** and **narrative summarization** (LLM).

This document defines **who it is for**, **what they do daily**, **what we will build in phases**, **what we will not pretend to be**, **which data sources apply**, a **high-level architecture**, **success metrics**, and **questions for external AI review** before a full implementation pass.

---

## 2. Problem statement

CAT analysts split time between **event monitoring**, **portfolio awareness**, **analytics and reporting**, and **stakeholder communication**. Existing enterprise tools (vendor cat models, GIS, policy systems) are powerful but heavy; a **lightweight, fast, single-user companion** can still add daily value if it:

1. Surfaces **what changed since last check** (delta), not only raw lists.
2. Makes **geography + peril relevance** obvious for **his** book of business.
3. Produces **copy-ready summaries** for email or slides without inventing numbers.

---

## 3. Persona & constraints

| Field | Detail |
|--------|--------|
| **Role** | Catastrophe Risk Analyst (Insurance) |
| **Location** | Chicago, IL (Central Time) |
| **Scope** | United States natural hazard exposure monitoring |
| **Users** | **Exactly one** authenticated or trusted user (the recipient) |
| **Deployment** | Static frontend (e.g. Netlify); secrets **must not** live in the browser |
| **Data sensitivity** | Portfolio may be **real**, **anonymized**, or **synthetic** — **must be decided explicitly** before storing real policy data in a personal stack |

### 3.1 Implications of single-user mode

- No multi-tenant auth complexity; optional simple gate (password, Netlify Identity, or private URL) is enough.
- Storage can be minimal: one portfolio dataset + run history.
- “Production-grade” means **reliable cron + auditable runs**, not SOC2 from day one.

---

## 4. Jobs to be done (JTBD)

Each row is a testable outcome for the product.

| When… | I need… | So I can… |
|--------|---------|-----------|
| I start the day | A **fast scan** of what happened overnight / last 24h | Prioritize reading and outreach |
| A hazard appears | To see **which policies** (if any) sit in the **affected area** | Focus loss estimation and triage |
| Leadership asks | A **short executive summary** with **sources** | Communicate without manual tab crunching |
| I revisit mid-day | **What changed** since my last run | Avoid re-reading the same events |
| I plan long-term | **Concentration** and **exposure by peril / region** (illustrative) | Discuss portfolio heat with underwriting / reinsurance |

---

## 5. Feature inventory by phase

### 5.1 MVP — “Daily habit, honest limits”

**Goal:** Something he can open **most mornings** and trust for **event + intersection** workflows. Narrative is optional but clearly labeled.

| ID | Feature | Description |
|----|---------|-------------|
| **MVP-01** | **Morning scan** | Pull USGS (earthquakes), NWS (active alerts / relevant subsets), FEMA disaster declarations (as applicable); normalize to a single internal event model. |
| **MVP-02** | **Portfolio overlay** | Import or edit portfolio (CSV minimum): lat/lon, identifier, state, insured value, covered perils (tags). |
| **MVP-03** | **Distance-based hit test** | Configurable radius (mi) from event to policy; list “hits” with distance and basic peril alignment (rules-based v1). |
| **MVP-04** | **Delta / “since last run”** | Persist last-run timestamp; highlight new events or new hits. |
| **MVP-05** | **Chicago / CT default** | UI and “overnight” copy assume **America/Chicago** for human-readable times; store **UTC** internally. |
| **MVP-06** | **Exportable briefing shell** | Structured sections: summary counts, top events, top exposures, caveats — suitable for copy-paste. |
| **MVP-07** | **LLM on the server** | Optional narrative layer via API proxy (no API keys in client). If LLM fails, **numeric/table output still works**. |

### 5.2 V1 — “Professional daily driver”

| ID | Feature | Description |
|----|---------|-------------|
| **V1-01** | **Scheduled runs** | Cron (e.g. serverless) for automatic daily snapshot + optional email/webhook. |
| **V1-02** | **Run history / audit** | Immutable log: inputs hash, time, event counts, hit counts — “what we knew at 8:00am.” |
| **V1-03** | **Map-centric view** | Events + portfolio on map; layer toggles; severity styling. |
| **V1-04** | **Peril sophistication** | Improve matching rules (e.g. flood vs wind from alert types); document uncertainty. |
| **V1-05** | **Data quality panel** | Flags: missing geocode, duplicate locations, outlier limits — aligned with analyst reality. |
| **V1-06** | **Claims triage list** | Ranked list by proximity + severity + policy value (rules-based scoring; not reserving). |

### 5.3 Later — “Depth without lying”

| ID | Feature | Description |
|----|---------|-------------|
| **L-01** | Additional feeds (wildfire hotspots, river flood where API permits) | Each feed documented; rate limits respected. |
| **L-02** | **Illustrative** EP curve / PML-style views | Clearly **not** vendor RMS/AIR output; for communication only. |
| **L-03** | Integrations | Email digest, Slack, Calendar reminder. |
| **L-04** | Mobile-friendly layout | PWA optional. |

---

## 6. Non-goals (explicit)

The product **does not** claim to:

| Non-goal | Reason |
|----------|--------|
| Replace **RMS, AIR, Touchstone**, or internal actuarial systems | Those require licensed models and company data pipelines |
| Provide **regulatory filing** or **reserving** numbers | Legal and financial liability |
| Guarantee **complete** hazard coverage on day one | Public APIs have gaps; versioned documentation instead |
| Multi-company or **brokerage-scale** tenancy | Out of scope for v1 |
| Real-time **claims adjudication** | Only **prioritization / awareness** support |

---

## 7. Data sources (authoritative-first)

| Source | Typical use | Key / cost | Notes |
|--------|-------------|------------|--------|
| **USGS Earthquake Hazards** | Seismic events | Generally public; follow usage guidelines | Magnitude / time filters |
| **api.weather.gov (NWS)** | Alerts, watches, warnings | Free; **User-Agent** required | Rate limits — cache responses |
| **FEMA Disaster Declarations** | Federal declaration context | Open data APIs | Declarations ≠ all local damage |
| **NASA FIRMS** (optional later) | Wildfire hotspots | Public | Interpretation docs required |
| **NOAA / NCEI** (optional later) | Historical storm events | Varies by product | Often bulk or delayed |

**Rule:** Numbers in UI and exports should trace to **feed + retrieval time**. LLM text must not invent counts.

---

## 8. Architecture (target)

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Browser)                       │
│  Dashboard · Map · Tables · Briefing view · No secrets        │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTPS
┌─────────────────────────────▼───────────────────────────────┐
│              API / Serverless (scheduled + on-demand)       │
│  · Fetch & normalize feeds                                     │
│  · Portfolio CRUD / import                                       │
│  · Hit testing & delta logic                                   │
│  · Proxy to LLM for narrative (optional)                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│  Persistence                                                  │
│  · Portfolio + settings + run history (DB or object store)   │
└──────────────────────────────────────────────────────────────┘
```

**Principles:**

1. **Secrets** (LLM keys, optional DB passwords) only in server environment.
2. **Idempotent ingestion** where possible; tag each run with `run_id`.
3. **Version** the normalization schema (`event_schema_version`).

---

## 9. Security & privacy (single user)

- Treat portfolio as **sensitive**; encrypt at rest if using managed DB.
- **Transport:** HTTPS only.
- **Access:** Private URL + strong secret, or identity provider — pick one and document.
- If **real employer data** is forbidden, run **synthetic** locations and values.

---

## 10. Success metrics

| Metric | Target |
|--------|--------|
| **Morning scan latency** | &lt; 30–60s end-to-end for typical day (excluding LLM or with LLM timeout) |
| **Adoption** | Used **4+ weekdays / week** for 2 weeks |
| **Trust** | User prefers this for **first pass** awareness before opening enterprise tools |
| **Honesty** | Zero incidents of **fabricated** event counts in LLM mode (guardrails + templates) |

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Feed outage or rate limit | Cached last-good response; visible stale banner |
| False “hits” from coarse geometry | Disclose radius + rules; refine in V1 |
| LLM hallucination | Template-first briefing; LLM fills **narrative only**; validate counts in code |
| Scope creep | This PRD + phase tags; ship MVP before “nuclear” expansion |

---

## 12. Open questions (resolve before build lock)

1. **Portfolio:** Real vs anonymized vs demo data — **compliance sign-off**?
2. **Primary perils** for v1 ranking: wind/hurricane, flood, convective, quake, wildfire — **which two matter most** for his book?
3. **Alerting:** In-app only vs email for v1?
4. **LLM budget:** OpenRouter / Anthropic — acceptable **monthly cap**?
5. **Hosting:** Netlify only vs add Supabase/Planetscale/Turso for DB?

---

## 13. External validation pack (for 4 independent AIs)

Use the **same** prompt set; compare answers. Flag **disagreements** and **source citations**.

### 13.1 Workflow validation

> As a **Catastrophe Risk Analyst** at a US P&C insurer, list the **top 8 tasks you perform weekly**. Mark each as **Daily** / **Weekly** / **Monthly**. For the **Daily** items, what is the **minimum** tool support needed (not nice-to-have)?

### 13.2 Data sources

> For **US-wide** natural catastrophe **awareness** (not pricing), which **public** feeds would you wire into a **personal** monitoring dashboard? Order by importance. Note **official** providers (USGS, NWS, FEMA, etc.) and any **licensing** caveats.

### 13.3 Metrics & briefing

> What should a **morning briefing** include for **exposure monitoring** vs **underwriting support**? What metrics are **misleading** if shown without context?

### 13.4 Architecture

> Propose a **minimal production architecture** for a **single-user** internal tool: ingestion, storage, analytics, UI. How do you keep **API keys** off the client? What is the **smallest** persistence layer you’d accept for **audit trail**?

### 13.5 Midwest / Chicago operator

> An analyst **based in Chicago** monitors **national** exposure. What **timezone**, **default map**, and **secondary perils** (e.g. convective) deserve emphasis so “overnight” and “end of day” make sense?

### 13.6 Red team

> How could this tool **fail** in ways that damage trust (false negatives, false positives, compliance)? List **three** mitigations.

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| **CAT** | Catastrophe (large-scale insured loss events) |
| **PML** | Probable Maximum Loss — often model-driven; **not** claimed as official here unless sourced |
| **AAL** | Average Annual Loss |
| **EP curve** | Exceedance probability vs loss |
| **Delta** | Set of events or hits **new or changed** since last run |

---

## 15. Document history

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-03-24 | Initial full PRD for CAT Risk Suite |

---

*End of document.*
