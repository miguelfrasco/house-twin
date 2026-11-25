// Cloudflare KV storage adapter (free tier: 1 GB, 100k reads and 1k writes per day).
export function kvStorage(kv) {
  return {
    async get(key, type = "text") {
      if (type === "bytes") { const v = await kv.get(key, "arrayBuffer"); return v ? new Uint8Array(v) : null; }
      return kv.get(key, type === "json" ? "json" : "text");
    },
    put: (key, value) => kv.put(key, value),
    delete: (key) => kv.delete(key),
  };
}
