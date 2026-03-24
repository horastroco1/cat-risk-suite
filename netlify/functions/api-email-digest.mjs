import { json, cors } from "./_shared/http.mjs";

/** Stub: wire Resend/Postmark when RESEND_API_KEY or POSTMARK_TOKEN set */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  const resend = process.env.RESEND_API_KEY;
  if (!resend) {
    return json(200, { ok: false, message: "Email digest not configured (set RESEND_API_KEY)" });
  }
  return json(200, { ok: true, message: "Placeholder: implement send with last run summary" });
};
