// Floor-plan drafting with a vision model on OpenRouter (bring your own key).
// The image goes to OpenRouter only when the owner presses "Draft with AI".
import { PLAN_PROMPT, extractJson, sanitizeDraft } from "../web/profile/plan-ai.js";
export { PLAN_PROMPT, extractJson, sanitizeDraft };
/** Call OpenRouter. fetchImpl is injectable for tests. */
export async function draftPlan({ apiKey, model = "google/gemini-2.5-flash", imageDataUrl, baseUrl = "https://openrouter.ai/api/v1", referer, fetchImpl = fetch }) {
  if (!apiKey) { const e = new Error("OPENROUTER_API_KEY is not set"); e.status = 503; throw e; }
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(imageDataUrl || "")) { const e = new Error("image must be a PNG, JPEG or WebP data URL"); e.status = 400; throw e; }
  const r = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(referer ? { "HTTP-Referer": referer, "X-Title": "House twin" } : {}) },
    body: JSON.stringify({
      model, temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "text", text: PLAN_PROMPT }, { type: "image_url", image_url: { url: imageDataUrl } }] }],
    }),
  });
  if (!r.ok) { const e = new Error(`OpenRouter ${r.status}`); e.status = 502; throw e; }
  const j = await r.json();
  const out = extractJson(j.choices?.[0]?.message?.content);
  return sanitizeDraft(out);
}

