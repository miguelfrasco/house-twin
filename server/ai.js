// Floor-plan drafting with a vision model on OpenRouter (bring your own key).
// The image goes to OpenRouter only when the owner presses "Draft with AI".
export const PLAN_PROMPT = `You are reading an architectural floor plan image.
Return ONLY JSON (no prose) with this shape, using IMAGE PIXEL coordinates (origin top-left):
{"walls":[{"a":[x,y],"b":[x,y],"exterior":true|false}],
 "rooms":[{"name":"string","type":"living|kitchen|bedroom|bathroom|hall|office|garage|stairs|other","polygon":[[x,y],...]}],
 "openings":[{"type":"door|window|garage","a":[x,y],"b":[x,y]}],
 "scale_hint":{"pixels":number,"metres":number}|null}
Rules: walls are straight centre lines; split walls at corners and T-junctions; rooms are closed polygons
following wall centre lines; openings are the two end points of each door or window ON its wall;
use the room names written on the plan when legible; if a dimension line is legible, fill scale_hint.
Do not include title blocks, furniture, text boxes, or dimension lines as walls.`;

export function extractJson(text) {
  const s = String(text || "").replace(/```(?:json)?/g, "");
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("model did not return JSON");
  return JSON.parse(s.slice(i, j + 1));
}

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

/** Keep only well-formed numbers and bounded strings. */
export function sanitizeDraft(d) {
  const pt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(+v)) ? [+p[0], +p[1]] : null;
  const str = (s, n = 60) => String(s ?? "").slice(0, n);
  return {
    walls: (d.walls || []).map((w) => ({ a: pt(w.a), b: pt(w.b), exterior: !!w.exterior })).filter((w) => w.a && w.b).slice(0, 400),
    rooms: (d.rooms || []).map((r) => ({ name: str(r.name), type: str(r.type, 20), polygon: (r.polygon || []).map(pt).filter(Boolean) })).filter((r) => r.polygon.length >= 3).slice(0, 80),
    openings: (d.openings || []).map((o) => ({ type: ["door", "window", "garage"].includes(o.type) ? o.type : "door", a: pt(o.a), b: pt(o.b) })).filter((o) => o.a && o.b).slice(0, 200),
    scale_hint: d.scale_hint && Number.isFinite(+d.scale_hint.pixels) && Number.isFinite(+d.scale_hint.metres) ? { pixels: +d.scale_hint.pixels, metres: +d.scale_hint.metres } : null,
  };
}
