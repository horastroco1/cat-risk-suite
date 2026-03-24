import crypto from "node:crypto";
import {
  fetchUsgsEarthquakes,
  fetchNwsActive,
  fetchFemaDeclarations,
  fetchSpcDay1,
  fetchNhcActive,
} from "./feeds.mjs";
import {
  normalizeUsgsFeature,
  normalizeNwsFeature,
  normalizeFemaRecord,
  normalizeSpcFeatures,
  normalizeNhcFeatures,
} from "./normalize.mjs";
import { computeHits } from "./hitTest.mjs";
import { loadPolicies, seedSyntheticIfEmpty, persistRun, getSupabase } from "./store.mjs";

function portfolioHash(policies) {
  return crypto.createHash("sha256").update(JSON.stringify(policies.map((p) => p.policy_id).sort())).digest("hex").slice(0, 16);
}

export async function executeRun(options = {}) {
  const {
    daysBack = 7,
    radiusByPeril = {},
    dataMode = "synthetic",
    trigger = "manual",
  } = options;

  const runId = crypto.randomUUID();
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const feedStatus = {};
  const events = [];

  const supabase = getSupabase();
  await seedSyntheticIfEmpty(supabase);
  const policies = await loadPolicies(supabase);
  const pHash = portfolioHash(policies);

  try {
    const [usgs, nws, fema] = await Promise.all([
      fetchUsgsEarthquakes(daysBack, 2.5).catch((e) => {
        feedStatus.usgs = { ok: false, error: String(e.message) };
        return { features: [] };
      }),
      fetchNwsActive().catch((e) => {
        feedStatus.nws = { ok: false, error: String(e.message) };
        return { features: [] };
      }),
      fetchFemaDeclarations(daysBack).catch((e) => {
        feedStatus.fema = { ok: false, error: String(e.message) };
        return { records: [] };
      }),
    ]);

    if (!feedStatus.usgs) feedStatus.usgs = { ok: true, count: usgs.features.length };
    for (const f of usgs.features || []) {
      const n = normalizeUsgsFeature(f);
      if (n) events.push(n);
    }

    if (!feedStatus.nws) feedStatus.nws = { ok: true, count: nws.features?.length ?? 0 };
    const nwsFeatures = (nws.features || []).slice(0, 400);
    for (const f of nwsFeatures) {
      const n = normalizeNwsFeature(f);
      if (n) events.push(n);
    }

    if (!feedStatus.fema) feedStatus.fema = { ok: true, count: fema.records?.length ?? 0 };
    for (const r of fema.records || []) {
      events.push(normalizeFemaRecord(r));
    }

    const [spcResult, nhc] = await Promise.all([
      fetchSpcDay1().catch((e) => ({ error: e })),
      fetchNhcActive(),
    ]);

    if (spcResult?.error) {
      feedStatus.spc = { ok: false, error: String(spcResult.error.message || spcResult.error) };
    } else if (spcResult?.features) {
      feedStatus.spc = { ok: true, count: spcResult.features?.length ?? 0 };
      events.push(...normalizeSpcFeatures(spcResult.features || [], spcResult.raw));
    } else {
      feedStatus.spc = { ok: false, error: "unknown" };
    }

    feedStatus.nhc = nhc.error ? { ok: false, error: nhc.error } : { ok: true, count: nhc.features?.length ?? 0 };
    events.push(...normalizeNhcFeatures(nhc.features || []));

    const hits = computeHits(events, policies, radiusByPeril);
    const latencyMs = Date.now() - started;

    const summary = {
      events_total: events.length,
      hits_total: hits.length,
      policies_impacted: new Set(hits.map((h) => h.policy_id)).size,
      by_peril: aggregateByPeril(events),
      by_feed: aggregateByFeed(events),
    };

    const runRow = {
      run_id: runId,
      started_at_utc: startedAt,
      ended_at_utc: new Date().toISOString(),
      trigger,
      data_mode: dataMode,
      feed_status_json: feedStatus,
      summary_counts_json: summary,
      latency_ms: latencyMs,
      portfolio_hash: pHash,
      schema_version: "1",
    };

    await persistRun(supabase, runRow, events, hits);

    return {
      ok: true,
      run_id: runId,
      summary,
      events,
      hits,
      feed_status: feedStatus,
      latency_ms: latencyMs,
      portfolio_hash: pHash,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    try {
      await persistRun(
        supabase,
        {
          run_id: runId,
          started_at_utc: startedAt,
          ended_at_utc: new Date().toISOString(),
          trigger,
          data_mode: dataMode,
          feed_status_json: feedStatus,
          summary_counts_json: {},
          latency_ms: latencyMs,
          portfolio_hash: pHash,
          error: String(e.message),
        },
        [],
        []
      );
    } catch {
      /* ignore persist failure */
    }
    return { ok: false, run_id: runId, error: String(e.message), feed_status: feedStatus, latency_ms: latencyMs };
  }
}

function aggregateByPeril(events) {
  const m = {};
  for (const e of events) {
    m[e.peril] = (m[e.peril] || 0) + 1;
  }
  return Object.entries(m).map(([peril, count]) => ({ peril, count }));
}

function aggregateByFeed(events) {
  const m = {};
  for (const e of events) {
    m[e.feed] = (m[e.feed] || 0) + 1;
  }
  return m;
}
