import { createClient } from "@supabase/supabase-js";
import { SYNTHETIC_PORTFOLIO } from "./syntheticPortfolio.mjs";

let memPolicies = [...SYNTHETIC_PORTFOLIO];
const memRuns = [];
const memEvents = new Map();
const memHits = new Map();

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function loadPolicies(supabase) {
  if (!supabase) return memPolicies;
  const { data, error } = await supabase.from("policies").select("*");
  if (error) throw error;
  if (!data?.length) return memPolicies;
  return data.map((r) => ({
    policy_id: r.policy_id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    state: r.state,
    insured_value: Number(r.insured_value),
    perils: r.perils || [],
  }));
}

export async function seedSyntheticIfEmpty(supabase) {
  if (!supabase) return;
  const { count } = await supabase.from("policies").select("*", { count: "exact", head: true });
  if (count && count > 0) return;
  const rows = SYNTHETIC_PORTFOLIO.map((p) => ({
    policy_id: p.policy_id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    state: p.state,
    insured_value: p.insured_value,
    perils: p.perils,
  }));
  await supabase.from("policies").insert(rows);
}

export async function persistRun(supabase, runRow, events, hits) {
  if (!supabase) {
    memRuns.push(runRow);
    memEvents.set(runRow.run_id, events);
    memHits.set(runRow.run_id, hits);
    return;
  }
  const { error: runErr } = await supabase.from("runs").insert({
    run_id: runRow.run_id,
    started_at_utc: runRow.started_at_utc,
    ended_at_utc: runRow.ended_at_utc,
    trigger: runRow.trigger || "manual",
    data_mode: runRow.data_mode,
    feed_status_json: runRow.feed_status_json,
    summary_counts_json: runRow.summary_counts_json,
    latency_ms: runRow.latency_ms,
    portfolio_hash: runRow.portfolio_hash,
    schema_version: runRow.schema_version || "1",
    error: runRow.error || null,
  });
  if (runErr) throw runErr;
  const evRows = events.map((e) => ({
    event_id: e.event_id,
    run_id: runRow.run_id,
    feed: e.feed,
    schema_version: e.schema_version,
    occurred_at_utc: e.occurred_at_utc,
    updated_at_utc: e.updated_at_utc,
    name: e.name,
    peril: e.peril,
    severity: e.severity,
    tier: e.tier,
    geometry: e.geometry,
    source_url: e.source_url,
    raw_properties_json: e.raw_properties_json,
    content_hash: e.content_hash,
  }));
  if (evRows.length) await supabase.from("events").insert(evRows);
  const hitRows = hits.map((h) => ({
    run_id: runRow.run_id,
    event_id: h.event_id,
    policy_id: h.policy_id,
    distance_mi: h.distance_mi,
    inside_polygon: h.inside_polygon,
    peril_alignment: h.peril_alignment,
    tier: h.tier,
    score: h.score,
    notes: h.notes,
  }));
  if (hitRows.length) await supabase.from("hits").insert(hitRows);
}

export async function getRunById(supabase, runId) {
  if (!supabase) {
    return memRuns.find((r) => r.run_id === runId) || null;
  }
  const { data } = await supabase.from("runs").select("*").eq("run_id", runId).single();
  return data;
}

export async function listRecentRuns(supabase, limit = 10) {
  if (!supabase) return [...memRuns].sort((a, b) => new Date(b.started_at_utc) - new Date(a.started_at_utc)).slice(0, limit);
  const { data } = await supabase.from("runs").select("run_id, started_at_utc, summary_counts_json, latency_ms").order("started_at_utc", { ascending: false }).limit(limit);
  return data || [];
}

export function getMemEvents(runId) {
  return memEvents.get(runId) || [];
}

export function getMemHits(runId) {
  return memHits.get(runId) || [];
}

export async function fetchRunFull(supabase, runId) {
  if (!supabase) {
    const run = memRuns.find((r) => r.run_id === runId);
    if (!run) return null;
    return {
      run,
      events: getMemEvents(runId),
      hits: getMemHits(runId),
    };
  }
  const { data: run } = await supabase.from("runs").select("*").eq("run_id", runId).single();
  if (!run) return null;
  const { data: events } = await supabase.from("events").select("*").eq("run_id", runId);
  const { data: hits } = await supabase.from("hits").select("*").eq("run_id", runId);
  return { run, events: events || [], hits: hits || [] };
}
