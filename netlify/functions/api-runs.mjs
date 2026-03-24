import { getRunById, listRecentRuns, getSupabase } from "./_shared/store.mjs";
import { json, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const supabase = getSupabase();
  const id = event.queryStringParameters?.id;
  if (id) {
    const run = await getRunById(supabase, id);
    return json(run ? 200 : 404, run || { error: "Not found" });
  }
  const list = await listRecentRuns(supabase, 20);
  return json(200, { runs: list });
};
