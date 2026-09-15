// scripts/check-cron-env.mjs
//
// A cron that is scheduled but cannot authenticate is the one failure this
// project has already paid for: `vercel.json` declared two jobs, `CRON_SECRET`
// lived only in `public.app_secrets`, and every run from 2026-04-22 to
// 2026-09-15 answered 401 to itself. Nothing was broken, nothing was logged
// where anyone looks, and the monthly subscriber report simply stopped.
//
// So the check is deliberately narrow: it does not ask whether a secret is a
// good one, only whether the scheduled jobs in `vercel.json` can possibly be
// let in. Declaring a cron and withholding the key it must present is a
// contradiction the build can see, and the build log is somewhere a person is
// actually looking.
//
// It WARNS rather than fails. Blocking a deploy — a hotfix included — on a
// configuration value only Boss can set would trade a silent cron for a stuck
// release, and the cron endpoints fail closed either way: unset means nobody
// gets in, not that anybody gets in who should not.
//
// Runs only where the answer is meaningful: Vercel exposes project env vars to
// the build, so a local `npm run build` knows nothing and says nothing.

import { readFileSync } from "node:fs";

const onVercel = Boolean(process.env.VERCEL);
const target = process.env.VERCEL_ENV || "";

let crons = [];
try {
  crons = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).crons ?? [];
} catch {
  crons = [];
}

if (!onVercel || target !== "production" || crons.length === 0) {
  process.exit(0);
}

if (process.env.CRON_SECRET) {
  console.log(`[cron-env] CRON_SECRET present — ${crons.length} scheduled job(s) can authenticate.`);
  process.exit(0);
}

const list = crons.map((c) => `      • ${c.schedule}  ${c.path}`).join("\n");
console.error(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ⚠️  THIS DEPLOY SHIPS ${String(crons.length).padEnd(2)} SCHEDULED JOB(S) THAT CANNOT RUN            ║
╚══════════════════════════════════════════════════════════════════════════╝

  CRON_SECRET is not in this project's environment, so Vercel sends no
  Authorization header with a cron request and api/_lib/cronAuth.js refuses
  every one of them. These will answer 401 and do nothing, silently:

${list}

  A copy in public.app_secrets does NOT count — Vercel signs a cron request
  only from the environment. That exact mistake cost this project every
  monthly subscriber report between 2026-04-22 and 2026-09-15.

  Fix (≈30 seconds, then redeploy):

      vercel env add CRON_SECRET production      # paste: openssl rand -base64 48

  Not failing the build on purpose: the endpoints fail closed, so the cost of
  this is jobs that do not run, never a door left open.
`);
process.exit(0);
