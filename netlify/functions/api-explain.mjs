import { json, parseBody, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const body = parseBody(event);
  const alert = body.alert_json || body.properties;
  if (!alert) return json(400, { error: "alert_json or properties required" });

  const key = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json(200, {
      plain: `Alert: ${alert.headline || alert.event || "NWS"}. Areas: ${JSON.stringify(alert.areaDesc || "")}. Sent: ${alert.sent || ""}.`,
      source: "template",
    });
  }

  const system =
    "Rewrite the NWS alert JSON into plain English: who is affected, where, when, what to watch. Do not add facts not in the JSON. Under 120 words.";
  try {
    if (process.env.OPENROUTER_API_KEY) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku",
          max_tokens: 400,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(alert) },
          ],
        }),
        signal: AbortSignal.timeout(4000),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return json(200, { plain: text, source: "openrouter" });
    }
  } catch (e) {
    return json(200, { plain: String(alert.headline || alert.event), error: String(e.message) });
  }
  return json(200, { plain: JSON.stringify(alert), source: "fallback" });
};
