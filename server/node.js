// Node target (Docker on a Raspberry Pi or any small server). Zero dependencies.
// Data and secrets live in DATA_DIR (a mounted volume). Serves web/ as static files.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, SECURITY_HEADERS, SECRET_NAMES } from "./core.js";
import { fsStorage } from "./storage-fs.js";
import { randomToken } from "./auth.js";
import { CSP } from "./csp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const DATA = process.env.DATA_DIR || join(process.cwd(), "data");
const PORT = +process.env.PORT || 8787;
const SECRETS_FILE = join(DATA, "secrets.env");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json", ".glb": "model/gltf-binary", ".txt": "text/plain" };

function loadSecrets() {
  const env = { ...process.env };
  if (existsSync(SECRETS_FILE)) for (const line of readFileSync(SECRETS_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && SECRET_NAMES.includes(m[1]) && !process.env[m[1]]) env[m[1]] = m[2];
  }
  return env;
}
let env = loadSecrets();
const storage = fsStorage(DATA);

async function setupCode() {
  if (env.SETUP_CODE) return env.SETUP_CODE;
  const f = join(DATA, "setup-code.txt");
  try { return (await readFile(f, "utf8")).trim(); } catch { return null; }
}

async function ensureSetupCode() {
  if (env.DEMO === "1" || env.SETUP_CODE || (await storage.get("owner", "text"))) return;
  await mkdir(DATA, { recursive: true, mode: 0o700 });
  const f = join(DATA, "setup-code.txt");
  let code;
  try { code = (await readFile(f, "utf8")).trim(); } catch { code = randomToken(9); await writeFile(f, code + "\n", { mode: 0o600 }); }
  console.log(`\n  First run. Open the app and enter this one-time setup code: ${code}\n  (also saved in ${f})\n`);
}

async function writeSecret(name, value) {
  await mkdir(DATA, { recursive: true, mode: 0o700 });
  const lines = existsSync(SECRETS_FILE) ? (await readFile(SECRETS_FILE, "utf8")).split("\n").filter((l) => l && !l.startsWith(name + "=")) : [];
  if (value) lines.push(`${name}=${value.replace(/[\r\n]/g, "")}`);
  await writeFile(SECRETS_FILE, lines.join("\n") + "\n", { mode: 0o600 });
  env = loadSecrets();
}

async function serveStatic(pathname, res) {
  let p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  let file = join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { file = join(ROOT, "index.html"); }
  try {
    const body = await readFile(file);
    const headers = { "content-type": MIME[extname(file)] || "application/octet-stream", ...SECURITY_HEADERS, "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=300" };
    if (extname(file) === ".html") headers["content-security-policy"] = CSP;
    res.writeHead(200, headers);
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const proto = req.headers["x-forwarded-proto"] || "http";
      const request = new Request(`${proto}://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      const r = await handleApi(request, env, {
        storage, target: "node", setupCode, writeSecret,
        demoProfile: async () => JSON.parse(await readFile(join(ROOT, "demo", "profile.json"), "utf8")),
      });
      const headers = Object.fromEntries(r.headers);
      res.writeHead(r.status, { ...headers, ...SECURITY_HEADERS });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    await serveStatic(url.pathname, res);
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end("server error");
  }
});

await ensureSetupCode();
server.listen(PORT, () => console.log(`House twin on http://localhost:${PORT} (${env.DEMO === "1" ? "demo" : "owner"} mode, data in ${DATA})`));
