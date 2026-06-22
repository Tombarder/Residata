// POST /api/admin/geocode   { q: "<address or place>" }
//
// Admin-only. Forward-geocodes an address to candidate coordinates via
// OpenStreetMap Nominatim (free, no API key). Restricted to SK/CZ for accuracy.
//
// Server-side (not a browser fetch) so we can send a proper identifying
// User-Agent — Nominatim's usage policy REQUIRES one — and so the geocoding
// provider stays swappable behind this one endpoint without touching the UI.
//
// Same security model as the other /api/admin endpoints: trusted origin +
// caller must be tier='admin' (verified server-side via the Supabase token).

import { createClient } from "@supabase/supabase-js";
import { isTrustedOrigin as checkTrustedOrigin } from "../_lib/origin.js";

export const maxDuration = 10;

const TRUSTED_ORIGINS = [
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",
  "http://localhost:3000",
];
const isTrustedOrigin = (req) => checkTrustedOrigin(req, TRUSTED_ORIGINS);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

    const URL_ = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!URL_ || !KEY) return res.status(500).json({ error: "server misconfigured" });

    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "authentication required" });

    const admin = createClient(URL_, KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: "invalid token" });

    const { data: caller } = await admin
      .from("user_profiles").select("tier").eq("id", user.id).maybeSingle();
    if (caller?.tier !== "admin") return res.status(403).json({ error: "admin only" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
    }
    const q = String(body?.q || "").trim();
    if (q.length < 3) return res.status(400).json({ error: "query too short" });

    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      limit: "6",
      "accept-language": "sk",
      countrycodes: "sk,cz",
      q,
    });
    const r = await fetch("https://nominatim.openstreetmap.org/search?" + params.toString(), {
      headers: {
        "User-Agent": "Residata-LocationManager/1.0 (residata@proton.me)",
        Accept: "application/json",
      },
    });
    if (!r.ok) return res.status(502).json({ error: "geocoder unavailable", status: r.status });

    const arr = await r.json();
    const results = (Array.isArray(arr) ? arr : [])
      .map((x) => ({
        label: x.display_name,
        lat: Number(x.lat),
        lng: Number(x.lon),
        type: x.type,
        category: x.category || x.class,
      }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    console.error("[geocode] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
