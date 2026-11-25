// Cloudflare Workers target. Static files come from the ASSETS binding; data lives in KV.
import { handleApi, SECURITY_HEADERS } from "./core.js";
import { kvStorage } from "./storage-kv.js";

const memory = () => { const m = new Map(); return { get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) }; };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      const storage = env.TWIN ? kvStorage(env.TWIN) : memory();
      const res = await handleApi(req, env, {
        storage,
        target: "cloudflare",
        demoProfile: async () => (await env.ASSETS.fetch(new Request(new URL("/demo/profile.json", url)))).json(),
        setupCode: async () => env.SETUP_CODE || null,
      });
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      return res;
    }
    return env.ASSETS.fetch(req);
  },
};
