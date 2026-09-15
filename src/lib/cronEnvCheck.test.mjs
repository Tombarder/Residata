// The build-time guard that tells a deploy it is shipping inert cron jobs.
//
// Pinned because the check is only ever seen when it matters, which is the
// worst time to discover it was inverted: the bug it exists for produced no
// output at all for five months.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const SCRIPT = fileURLToPath(new URL("../../scripts/check-cron-env.mjs", import.meta.url));

function run(env) {
  // A clean env each time: inheriting the developer's own CRON_SECRET would
  // make the "missing" cases pass for the wrong reason.
  const res = execFileSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res;
}

function runCapturingStderr(env) {
  let out = "";
  try {
    out = execFileSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(`script exited non-zero: ${e.status}\n${e.stderr}`);
  }
  return out;
}

test("warns when production ships crons with no CRON_SECRET", () => {
  let stderr = "";
  const res = execFileSync(
    process.execPath,
    ["-e", `const {execFileSync}=require("child_process");
      try{
        execFileSync(process.execPath,[${JSON.stringify(SCRIPT)}],{
          env:{PATH:process.env.PATH,VERCEL:"1",VERCEL_ENV:"production"},
          encoding:"utf8",stdio:["ignore","pipe","pipe"]});
      }catch(e){process.stdout.write("THREW");process.exit(0);}
      process.stdout.write("OK");`],
    { encoding: "utf8" }
  );
  assert.equal(res.trim(), "OK", "the guard must never fail the build");
});

test("the warning names every scheduled path, so none is overlooked", () => {
  const declared = JSON.parse(
    readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
  ).crons;
  assert.ok(declared.length > 0, "this test is meaningless if nothing is scheduled");

  const proc = execFileSync(
    process.execPath,
    ["-e", `const {spawnSync}=require("child_process");
      const r=spawnSync(process.execPath,[${JSON.stringify(SCRIPT)}],{
        env:{PATH:process.env.PATH,VERCEL:"1",VERCEL_ENV:"production"},encoding:"utf8"});
      process.stdout.write(r.stderr);`],
    { encoding: "utf8" }
  );
  for (const c of declared) {
    assert.ok(proc.includes(c.path), `warning must name ${c.path}`);
    assert.ok(proc.includes(c.schedule), `warning must name schedule ${c.schedule}`);
  }
  assert.ok(
    /app_secrets/.test(proc),
    "the warning must say why a database copy is not enough — that is the actual trap"
  );
});

test("silent when the secret is configured", () => {
  const out = runCapturingStderr({
    VERCEL: "1",
    VERCEL_ENV: "production",
    CRON_SECRET: "x".repeat(40),
  });
  assert.match(out, /CRON_SECRET present/);
});

test("silent off Vercel, so a local build is never nagged", () => {
  assert.equal(run({}).trim(), "");
});

test("silent on preview — Vercel only runs crons against production", () => {
  assert.equal(run({ VERCEL: "1", VERCEL_ENV: "preview" }).trim(), "");
});

test("prebuild actually runs the check", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  );
  assert.match(
    pkg.scripts.prebuild,
    /check-cron-env\.mjs/,
    "a guard nobody invokes is not a guard"
  );
});
