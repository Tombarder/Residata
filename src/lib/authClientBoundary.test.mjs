/**
 * The AUTH Supabase client is for signing in and out — nothing else.
 *
 * Every request on it first waits for gotrue's auth lock (auth.getSession()).
 * On 2026-10-06 that lock wedged after a token refresh and every save that went
 * through this client — the admin tier change, profile, articles, dashboards,
 * map areas, report subscriptions, the activity log — waited forever without a
 * word (lib/authStateHandler.js). Reads had been moved off it in July for the
 * same reason; the writes were left behind. Now all data traffic, reads AND
 * writes, goes through supabaseData (lock-free token) or supabasePublic, and this
 * test keeps it that way: only these files may import the auth client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = new Set(["lib/supabase.js", "lib/useAuth.jsx"]);

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) yield p;
  }
}

test("only the sign-in code imports the auth client", () => {
  const offenders = [];
  for (const file of sources(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/supabase["']/g)) {
      if (m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).includes("supabase")) offenders.push(rel);
    }
    if (/import\(\s*["'][^"']*\/supabase["']\s*\)/.test(text) && /\{\s*supabase\s*[,}]/.test(text)) offenders.push(`${rel} (dynamic)`);
  }
  assert.deepEqual(offenders, [], "use supabaseData (signed-in data) or supabasePublic (public data) instead");
});

test("useAuth sends no data request through the auth client", () => {
  const text = readFileSync(join(SRC, "lib/useAuth.jsx"), "utf8");
  assert.doesNotMatch(text, /\bsupabase\.(from|rpc|storage)\b/, "the profile read belongs on supabaseData");
});
