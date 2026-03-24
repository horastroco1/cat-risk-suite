import { getSupabase } from "./_shared/store.mjs";
import { json, parseBody, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const supabase = getSupabase();

  if (event.httpMethod === "GET") {
    if (!supabase) {
      return json(200, {
        settings: {
          timezone: "America/Chicago",
          data_mode: "synthetic",
          numbers_only_mode: false,
          llm_enabled: true,
        },
      });
    }
    const { data } = await supabase.from("settings").select("*").eq("id", "default").single();
    return json(200, { settings: data || {} });
  }

  if (event.httpMethod === "POST") {
    const body = parseBody(event);
    if (!supabase) return json(503, { error: "Supabase required" });
    await supabase.from("settings").upsert({ id: "default", ...body, updated_at: new Date().toISOString() });
    return json(200, { ok: true });
  }

  return json(405, { error: "Method not allowed" });
};
