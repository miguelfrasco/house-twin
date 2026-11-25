#!/usr/bin/env node
// Blocks secrets and personal strings from entering the repo.
// 1. Built-in secret patterns (API keys, tokens, private keys).
// 2. A private denylist that is NEVER committed: pass it via the HT_DENYLIST env var
//    (newline-separated; in CI it comes from a repository secret) or HT_DENYLIST_FILE.
// Usage: node scripts/privacy-guard.mjs [--staged] [paths...]
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

const SECRET_PATTERNS = [
  ["OpenRouter key", /sk-or-v1-[a-f0-9]{20,}/],
  ["OpenAI-style key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ["Cloudflare API token", /\b(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Supabase secret", /\bsb_secret_[A-Za-z0-9_-]{20,}|service_role[^\n]{0,20}eyJ[A-Za-z0-9_-]{20,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ["Home Assistant long-lived token", /\bHA_TOKEN\s*[=:]\s*["']?eyJ/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
];
const SKIP = [/^web\/vendor\//, /\.(png|jpe?g|webp|glb|gif|ico|pdf)$/i, /^package-lock\.json$/];

function denylist() {
  let raw = process.env.HT_DENYLIST || "";
  const f = process.env.HT_DENYLIST_FILE;
  if (f && existsSync(f)) raw += "\n" + readFileSync(f, "utf8");
  return raw.split("\n").map((s) => s.trim()).filter((s) => s.length >= 4 && !s.startsWith("#"));
}

function files(args) {
  if (args.includes("--staged")) return execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" }).split("\n").filter(Boolean);
  const explicit = args.filter((a) => !a.startsWith("--"));
  if (explicit.length) return explicit;
  return execSync("git ls-files -co --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
}

const args = process.argv.slice(2);
const deny = denylist();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const denyRe = deny.map((d) => [d, new RegExp(`(^|[^A-Za-z0-9])${escape(d)}($|[^A-Za-z0-9])`, "i")]);
const problems = [];
for (const f of files(args)) {
  if (SKIP.some((r) => r.test(f)) || !existsSync(f) || statSync(f).isDirectory()) continue;
  const text = args.includes("--staged") ? (() => { try { return execSync(`git show :${JSON.stringify(f).slice(1, -1)}`, { encoding: "utf8", maxBuffer: 50e6 }); } catch { return readFileSync(f, "utf8"); } })() : readFileSync(f, "utf8");
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) problems.push(`${f}:${i + 1}  secret-like value (${name})`);
    for (const [, re] of denyRe) if (re.test(line)) problems.push(`${f}:${i + 1}  matches a private denylist entry`);
  });
}
// file names that should never be committed
for (const f of files(args)) if (/(^|\/)(\.dev\.vars|\.env(\..+)?|secrets\.env|.*\.profile\.json|setup-code\.txt)$/.test(f) && !/\.example$/.test(f) && !f.startsWith("web/demo/")) problems.push(`${f}  private file type must not be committed`);

if (!deny.length) console.warn("privacy-guard: no private denylist loaded (set HT_DENYLIST or HT_DENYLIST_FILE). Secret patterns still checked.");
if (problems.length) {
  console.error("privacy-guard: blocked\n" + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log(`privacy-guard: ok (${deny.length} denylist entries, ${SECRET_PATTERNS.length} secret patterns)`);
