import { buildBriefingMarkdown, callLlmNarrative } from "./_shared/briefing.mjs";
import { executeRun } from "./_shared/runOrchestrator.mjs";
import { getSupabase, fetchRunFull } from "./_shared/store.mjs";
import { json, parseBody, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const body = parseBody(event);
  const runIdParam = body.run_id || event.queryStringParameters?.run_id;
  const mode = body.mode || event.queryStringParameters?.mode || "template";

  let events;
  let hits;
  let summary;
  let run_id;

  if (runIdParam) {
    const supabase = getSupabase();
    const full = await fetchRunFull(supabase, runIdParam);
    if (!full) return json(404, { error: "Run not found" });
    events = full.events.map((e) => ({
      name: e.name,
      peril: e.peril,
      severity: e.severity,
      feed: e.feed,
    }));
    hits = full.hits;
    summary = full.run.summary_counts_json || {};
    run_id = runIdParam;
  } else {
    const run = await executeRun({ daysBack: body.days_back || 7, dataMode: body.data_mode || "synthetic" });
    if (!run.ok) return json(500, run);
    events = run.events || [];
    hits = run.hits || [];
    summary = run.summary || {};
    run_id = run.run_id;
  }

  const metrics = {
    events_total: summary.events_total ?? events.length,
    hits_total: summary.hits_total ?? hits.length,
    policies_impacted: summary.policies_impacted ?? new Set(hits.map((h) => h.policy_id)).size,
  };

  const top_events = (Array.isArray(events) ? events : []).slice(0, 8).map((e) => ({
    name: e.name,
    peril: e.peril,
    severity: e.severity,
    feed: e.feed,
  }));
  const top_hits = [...hits].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);

  const md = buildBriefingMarkdown({
    retrievedCt: new Date().toISOString(),
    metrics: { ...metrics, events_total: events.length, hits_total: hits.length },
    top_events,
    top_hits,
    run_id,
  });

  let narrative = null;
  if (mode === "llm" || mode === "both") {
    narrative = await callLlmNarrative(metrics, null);
  }

  return json(200, {
    markdown: md,
    narrative,
    narrative_label: narrative ? "AI narrative (draft — verify tables)" : null,
    run_id,
  });
};
