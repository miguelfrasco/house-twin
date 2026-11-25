// Lets the tests import browser modules that use the bare "three" specifier (the browser gets it from an import map).
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
const base = ${JSON.stringify(new URL("../web/vendor/", import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (spec === "three") return { url: base + "three.module.js", shortCircuit: true };
  if (spec.startsWith("three/addons/")) return { url: base + "addons/" + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));
