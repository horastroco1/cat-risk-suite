# CAT Risk Suite — Operator guide

## Environment variables (Netlify)

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Recommended | Postgres persistence |
| `SUPABASE_SERVICE_ROLE_KEY` | With Supabase | Server-side inserts (keep secret) |
| `NWS_USER_AGENT` | Recommended | Contact string for api.weather.gov |
| `OPENROUTER_API_KEY` | Optional | AI briefing / explain (OpenRouter) |
| `OPENROUTER_MODEL` | Optional | Default model slug |
| `ANTHROPIC_API_KEY` | Optional | Alternative to OpenRouter for LLM |
| `RESEND_API_KEY` | Optional | Email digest (future) |

Without Supabase, runs persist in **function memory only** (lost between cold starts). For production, configure Supabase and run `supabase/migrations/001_initial.sql`.

## Local development

```bash
npm install
cd /path/to/mr && npx netlify dev
```

Open the printed localhost URL. `/api/run` and other redirects require Netlify dev (not plain `file://`).

## Cron

Scheduled runs use `netlify/functions/scheduled-run.mjs`. Enable `[functions.scheduled-run]` in `netlify.toml` on a plan that supports scheduled functions. Adjust UTC cron for America/Chicago.

## Repository layout

- `mrcat/` — static SPA (published site)
- `netlify/functions/` — serverless API
- `supabase/migrations/` — SQL schema

If `mrcat/` contains its own `.git`, consider removing nested git so the repo root is the single Netlify site.
