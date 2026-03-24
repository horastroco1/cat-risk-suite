import { getSupabase, loadPolicies } from "./_shared/store.mjs";
import { json, parseBody, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const supabase = getSupabase();

  if (event.httpMethod === "GET") {
    const policies = await loadPolicies(supabase);
    return json(200, { policies, count: policies.length });
  }

  if (event.httpMethod === "POST") {
    const body = parseBody(event);
    const rows = body.policies || body.rows || [];
    if (!supabase) {
      return json(503, { error: "Configure SUPABASE_URL to persist portfolio" });
    }
    const valid = [];
    for (const r of rows) {
      if (r.policy_id == null || r.lat == null || r.lon == null) continue;
      valid.push({
        policy_id: String(r.policy_id),
        name: r.name || "",
        lat: Number(r.lat),
        lon: Number(r.lon),
        state: String(r.state || "XX").slice(0, 2).toUpperCase(),
        insured_value: Number(r.insured_value) || 0,
        perils: Array.isArray(r.perils) ? r.perils : String(r.perils || "").split(",").map((s) => s.trim()).filter(Boolean),
      });
    }
    if (valid.length) await supabase.from("policies").upsert(valid, { onConflict: "policy_id" });
    return json(200, { ok: true, imported: valid.length });
  }

  return json(405, { error: "Method not allowed" });
};
