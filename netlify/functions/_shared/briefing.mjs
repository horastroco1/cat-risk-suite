/** Template-first briefing — numbers only from structured input */

export function buildBriefingMarkdown(ctx) {
  const {
    timezone = "America/Chicago",
    retrievedCt = "",
    metrics = {},
    top_events = [],
    top_hits = [],
    run_id = "",
    caveats = [],
  } = ctx;

  const lines = [
    `# CAT Risk — Morning Scan (${timezone})`,
    ``,
    `Retrieved: ${retrievedCt}`,
    ``,
    `## Summary`,
    `- Events ingested: ${metrics.events_total ?? 0}`,
    `- Portfolio hits (rules-based): ${metrics.hits_total ?? 0}`,
    `- Policies touched: ${metrics.policies_impacted ?? 0}`,
    ``,
    `## Top events`,
    ...top_events.slice(0, 8).map((e) => `- ${e.name} — ${e.peril} / ${e.severity} — ${e.feed}`),
    ``,
    `## Top exposures (triage)`,
    ...top_hits.slice(0, 10).map((h) => `- ${h.policy_id}: ${h.notes || ""} — ${h.distance_mi} mi — score ${h.score}`),
    ``,
    `## Caveats`,
    `- Distances: great-circle; polygon hits use containment or centroid proxy when noted.`,
    `- TIV in zone is not loss estimate.`,
    `- NWS reflects alerts at retrieval time.`,
    ...caveats,
    ``,
    `## Sources`,
    `- USGS, NWS api.weather.gov, FEMA OpenFEMA, SPC, NHC (when available)`,
    `- Run ID: ${run_id}`,
  ];
  return lines.join("\n");
}

export async function callLlmNarrative(metricsJson, apiKey, provider = "openrouter") {
  const key = apiKey || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const system = `You draft a morning CAT risk briefing. You are given authoritative metrics (JSON). Do not invent counts or percentages; only reference numbers present in the input. Cite USGS, NWS, FEMA as applicable. 120–200 words.`;
  const user = JSON.stringify(metricsJson);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  try {
    if (process.env.OPENROUTER_API_KEY) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://cat-risk-suite.local",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku",
          max_tokens: 600,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      clearTimeout(t);
      return data?.choices?.[0]?.message?.content || null;
    }
    if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 600,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      clearTimeout(t);
      return data?.content?.[0]?.text || null;
    }
  } catch {
    clearTimeout(t);
  }
  return null;
}
