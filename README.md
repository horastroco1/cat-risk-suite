# CAT Risk Suite

Single-user catastrophe risk monitoring dashboard: **USGS**, **NWS**, **FEMA**, **SPC**, **NHC** feeds, portfolio intersection, delta/hits, template briefing, optional AI narrative (server-side).

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
