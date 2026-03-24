import { executeRun } from "./_shared/runOrchestrator.mjs";

/** Netlify scheduled cron — UTC; adjust in netlify.toml */
export const handler = async () => {
  const r = await executeRun({ daysBack: 1, dataMode: "synthetic", trigger: "cron" });
  console.log("scheduled-run", r.run_id, r.ok ? "ok" : r.error);
  return { statusCode: 200, body: JSON.stringify(r) };
};
