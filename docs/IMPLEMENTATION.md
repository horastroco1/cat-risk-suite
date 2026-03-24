# Implementation notes (nuclear build)

## Delivered

- **Netlify Functions** (`/api/run`, `/api/runs`, `/api/portfolio`, `/api/hits`, `/api/delta`, `/api/briefing`, `/api/explain`, `/api/settings`, `/api/email-digest` stub) with CORS.
- **Feeds**: USGS FDSNWS, NWS `alerts/active`, FEMA OpenFEMA v2, SPC (multiple URL fallbacks), NHC ArcGIS (optional).
- **Normalization + hit testing**: Haversine for points; Turf `booleanPointInPolygon` with centroid distance fallback outside polygon; rules-based score; peril radii in `perilMap.mjs`.
- **Persistence**: Supabase Postgres schema in `supabase/migrations/001_initial.sql`; in-memory fallback when env vars absent.
- **SPA** (`mrcat/`): Trust ribbon, morning card, prompt packs, command palette (⌘K), help drawer, dark/light theme, structured briefing + optional AI narrative button, peril chips on events, claims triage from last run.
- **Docs**: `README.md`, `docs/OPERATOR.md`, this file.

## Deferred / partial

- **ETag `feed_cache` table**: Schema exists; incremental caching not wired in fetchers.
- **Scheduled cron**: Commented in `netlify.toml` (requires paid Netlify schedule).
- **Email digest**: Stub only (`RESEND_API_KEY`).
- **Map PNG export**: Use browser Print to PDF (`exportMapSnapshot` → `print()`).
- **LLM budget caps**: Documented in settings table; not enforced in code (add rate limit store).

## Acceptance

Run `npx netlify dev`, POST `/api/run`, confirm `latency_ms` &lt; 60s and events JSON. With Supabase, confirm rows in `runs` / `events` / `hits`.
