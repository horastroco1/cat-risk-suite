import { getSupabase, getMemHits } from "./_shared/store.mjs";
import { json, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const runId = event.queryStringParameters?.run_id;
  if (!runId) return json(400, { error: "run_id required" });
  const supabase = getSupabase();
  if (!supabase) {
    const hits = getMemHits(runId);
    return json(200, { hits });
  }
  const { data, error } = await supabase.from("hits").select("*").eq("run_id", runId);
  if (error) return json(500, { error: error.message });
  return json(200, { hits: data || [] });
};
