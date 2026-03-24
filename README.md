# CAT Risk Suite

Single-user catastrophe risk monitoring dashboard: **USGS**, **NWS**, **FEMA**, **SPC**, **NHC** feeds, portfolio intersection, delta/hits, template briefing, optional AI narrative (server-side).

**Repository:** [github.com/horastroco1/cat-risk-suite](https://github.com/horastroco1/cat-risk-suite)

## Deploy on Netlify (live site)

1. [Netlify](https://app.netlify.com) → **Add new site** → **Import an existing project** → connect **GitHub** → select **`cat-risk-suite`**.
2. Build settings: **Build command** `npm install` (or leave empty; `netlify.toml` sets it), **Publish directory** `mrcat` (already in `netlify.toml`).
3. **Site settings → Environment variables** (optional but recommended): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NWS_USER_AGENT`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` — see [docs/OPERATOR.md](docs/OPERATOR.md).
4. Deploy. APIs are at `https://<your-site>.netlify.app/api/run` etc.

## Quick start

```bash
npm install
npx netlify dev
```

Configure Supabase (see [docs/OPERATOR.md](docs/OPERATOR.md)) and apply [supabase/migrations/001_initial.sql](supabase/migrations/001_initial.sql).

## Product spec

See [docs/CAT-Risk-Suite-PRD.md](docs/CAT-Risk-Suite-PRD.md).

## Legacy CLI

The `cat_agent/` Python script remains a standalone prototype; production logic lives in `netlify/functions/`.
