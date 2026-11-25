// File-system storage adapter for the Docker / Pi target. Everything lives under DATA_DIR.
import { mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";

const safe = (key) => key.replace(/[^\w.:-]/g, "_").replace(/:/g, "__");

export function fsStorage(dir) {
  const p = (key) => join(dir, "store", safe(key));
  return {
    async get(key, type = "text") {
      try {
        const buf = await readFile(p(key));
        if (type === "bytes") return new Uint8Array(buf);
        const s = buf.toString("utf8");
        return type === "json" ? JSON.parse(s) : s;
      } catch (e) { if (e.code === "ENOENT") return null; throw e; }
    },
    async put(key, value) {
      await mkdir(join(dir, "store"), { recursive: true, mode: 0o700 });
      const tmp = p(key) + ".tmp";
      await writeFile(tmp, value instanceof Uint8Array ? value : String(value), { mode: 0o600 });
      await rename(tmp, p(key));
    },
    async delete(key) { await rm(p(key), { force: true }); },
  };
}
