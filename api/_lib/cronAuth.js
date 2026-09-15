// api/_lib/cronAuth.js
//
// ONE definition of "this request really is our scheduled job", shared by every
// cron endpoint. Not a tidy-up: the two cron endpoints this project had were
// each wrong, in opposite directions, because each decided for itself.
//
// 🔴 WHAT WAS MEASURED (2026-09-15, both against production residata.eu):
//
//  1. `curl -H "x-vercel-cron: 1" .../api/stripe?action=reconcile` → **200**,
//     sent from a laptop. The platform does NOT strip that header, so it is
//     not proof of anything and is not accepted here. Our own 2026 security
//     audit recorded the opposite ("which Vercel strips from client-supplied
//     requests") and that line was simply never tested.
//
//  2. `CRON_SECRET` was sitting in `public.app_secrets` and was absent from the
//     Vercel project environment. **Vercel signs a cron request with
//     `Authorization: Bearer $CRON_SECRET` only when the variable is in the
//     ENV**; a copy in the database is a value no cron can ever present.
//     api/cron/monthly-reports resolved the database copy, concluded a secret
//     was configured, and therefore refused its own cron every month — the last
//     subscriber report went out on 2026-04-22, the day it was set up by hand.
//
// Hence the two rules below, and they are the whole module:
//
//   • **The environment is the only source.** A secret the platform does not
//     know about cannot authenticate anything, so reading one from anywhere
//     else can only ever break the caller we meant to let in.
//   • **No secret means no entry.** These endpoints spend money on our behalf —
//     the reconcile walks the Stripe subscription list, the report endpoint
//     sends mail — so open-by-default is the wrong side to fail on, even though
//     neither one hands an attacker anything of ours.
//
// The cost of failing closed is that a missing CRON_SECRET makes every
// scheduled job inert, which is why that case is logged as an error in its own
// right rather than sharing the ordinary 401.

import { timingSafeEqual } from "node:crypto";

/** Constant-time compare that tolerates different lengths. */
function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Refuse anything that is not Vercel's cron (or a manual run holding the same
 * secret). Returns true when it has already answered the request.
 *
 *   if (rejectIfNotCron(req, res)) return;
 */
export function rejectIfNotCron(req, res, label = "cron") {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Not the same event as a wrong token: nobody can get in, including us.
    console.error(
      `[${label}] CRON_SECRET is not set in the Vercel environment — this scheduled job is INERT ` +
      `and will stay inert until the variable is added to the project (Production) and redeployed.`
    );
    res.status(401).json({ error: "unauthorized" });
    return true;
  }
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (!sameString(header, `Bearer ${secret}`)) {
    res.status(401).json({ error: "unauthorized" });
    return true;
  }
  return false;
}
