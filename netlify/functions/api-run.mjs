import { executeRun } from "./_shared/runOrchestrator.mjs";
import { json, parseBody, cors } from "./_shared/http.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const body = event.httpMethod === "POST" ? parseBody(event) : {};
  const daysBack = Number(body.days_back || event.queryStringParameters?.days || 7);
  const dataMode = body.data_mode || "synthetic";
  const result = await executeRun({ daysBack, dataMode, trigger: "manual" });
  return json(result.ok ? 200 : 500, result);
};
