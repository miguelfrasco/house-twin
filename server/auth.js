// Owner auth with WebCrypto only (works in Workers and Node 20+).
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function randomToken(bytes = 32) { return b64u(crypto.getRandomValues(new Uint8Array(bytes))); }

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 100000) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${b64u(salt)}$${b64u(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, it, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2") return false;
  const again = await hashPassword(password, fromB64u(salt), +it);
  return timingSafeEqual(again.split("$")[3], hash);
}

export function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

/** Session cookie value: "<expiry>.<sig>" signed with the session key. */
export async function makeSession(key, ttlDays = 30) {
  const exp = Date.now() + ttlDays * 864e5;
  return `${exp}.${await hmac(key, `owner.${exp}`)}`;
}

export async function checkSession(key, value) {
  if (!key || !value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || +exp < Date.now()) return false;
  return timingSafeEqual(sig, await hmac(key, `owner.${exp}`));
}

export function cookie(name, value, { maxAge, secure = true } = {}) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ""}`;
}

export function readCookie(req, name) {
  const h = req.headers.get("cookie") || "";
  for (const part of h.split(/;\s*/)) { const i = part.indexOf("="); if (part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}
