import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = (file, env = {}) => { try { execFileSync("node", ["scripts/privacy-guard.mjs", file], { env: { ...process.env, ...env }, stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
const tmp = mkdtempSync(join(tmpdir(), "guard-"));

test("guard blocks denylisted strings (case-insensitive, word-bounded)", () => {
  const f = join(tmp, "a.js"); writeFileSync(f, "const host = 'casa.EXAMPLE-private.test';\n");
  assert.equal(run(f, { HT_DENYLIST: "example-private.test" }), 1);
  assert.equal(run(f, { HT_DENYLIST: "unrelated-term" }), 0);
});
test("guard blocks secret-looking values", () => {
  const f = join(tmp, "b.js"); writeFileSync(f, "OPENROUTER=" + "sk-or-v1-" + "a".repeat(40) + "\n");
  assert.equal(run(f), 1);
});
test("guard blocks private file types", () => {
  const f = join(tmp, "mine.profile.json"); writeFileSync(f, "{}\n");
  assert.equal(run(f), 1);
});
