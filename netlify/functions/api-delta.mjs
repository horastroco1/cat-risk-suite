import { getSupabase } from "./_shared/store.mjs";
import { json, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const prev = event.queryStringParameters?.prev_run_id;
  const cur = event.queryStringParameters?.run_id;
  if (!prev || !cur) return json(400, { error: "prev_run_id and run_id required" });
  const supabase = getSupabase();
  if (!supabase) {
    return json(200, { new_events: [], updated_events: [], new_hits: [], note: "Delta requires Supabase for history" });
  }
  const { data: evPrev } = await supabase.from("events").select("event_id, content_hash").eq("run_id", prev);
  const { data: evCur } = await supabase.from("events").select("event_id, content_hash").eq("run_id", cur);
  const { data: hitPrev } = await supabase.from("hits").select("event_id, policy_id").eq("run_id", prev);
  const { data: hitCur } = await supabase.from("hits").select("event_id, policy_id").eq("run_id", cur);

  const prevE = new Map((evPrev || []).map((e) => [e.event_id, e.content_hash]));
  const curE = new Map((evCur || []).map((e) => [e.event_id, e.content_hash]));
  const new_events = [];
  const updated_events = [];
  for (const [id, h] of curE) {
    if (!prevE.has(id)) new_events.push(id);
    else if (prevE.get(id) !== h) updated_events.push(id);
  }
  const prevH = new Set((hitPrev || []).map((h) => `${h.event_id}|${h.policy_id}`));
  const new_hits = (hitCur || []).filter((h) => !prevH.has(`${h.event_id}|${h.policy_id}`));

  return json(200, { new_events, updated_events, new_hits });
};
