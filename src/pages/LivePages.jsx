import { useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { useProjects, useProjectFlats, useEarlyAccessStats } from "../lib/useData";
import { supabase } from "../lib/supabase";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";

/* ───────────────────── LIVE DASHBOARD ───────────────────── */
export function LiveDashboard({ setCurrent, openLogin }) {
  const { user, isPaid } = useAuth();
  const { projects, loading } = useProjects();
  const shown = user ? projects : projects.slice(0, 20);

  const stavLabel = { V: "voľné", P: "predané", R: "rezerv.", PR: "predrez." };

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      <Label>Live dashboard</Label>
      <h1 className="sec-title">Aktuálny stav trhu</h1>
      <p className="sec-desc" style={{ marginBottom: "2.5rem" }}>
        Dáta aktualizované každý deň. Filtruj, preklikni, porovnaj.
        {!user && <> Registrácia odomkne plný detail 1 projektu (zadarmo).</>}
        {user && !isPaid && <> <button onClick={() => setCurrent && setCurrent("Pricing")} style={linkBtn}>Upgrade na paid</button> pre prístup ku všetkým 60 projektom.</>}
      </p>

      {/* Top summary cards */}
      <SummaryCards projects={projects} />

      {/* Projects list */}
      <div style={{ marginTop: "3rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem" }}>
          <div>
            <div style={labelStyle}>Projects</div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {user ? `${projects.length} projektov` : `Top ${Math.min(20, projects.length)} z ${projects.length}`}
            </h2>
          </div>
          {!user && <button className="btn-p" onClick={openLogin}>Registrovať pre plný zoznam</button>}
        </div>

        {loading ? (
          <div style={{ color: dim, padding: "2rem", textAlign: "center" }}>Načítavam…</div>
        ) : (
          <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead style={{ background: "#0e0e10" }}>
                  <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    <th style={th}>Projekt</th>
                    <th style={th}>Okres</th>
                    <th style={{ ...th, textAlign: "right" }}>Bytov</th>
                    <th style={{ ...th, textAlign: "right" }}>Voľné</th>
                    <th style={{ ...th, textAlign: "right" }}>Vypredané</th>
                    <th style={{ ...th, textAlign: "right" }}>% predané</th>
                    <th style={{ ...th, textAlign: "right" }}>€/m²</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(p => (
                    <tr key={p.id} style={{ borderTop: `1px solid ${border}` }}>
                      <td style={td}><strong>{p.name}</strong></td>
                      <td style={{ ...td, color: dim }}>{p.district || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.total_units}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green }}>{p.available_units}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: "#f5a623" }}>{p.sold_units}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.sold_percentage != null ? `${p.sold_percentage}%` : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.avg_price_eur_m2 ? `${Math.round(p.avg_price_eur_m2).toLocaleString("sk-SK")}` : "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button onClick={() => setCurrent && setCurrent(`Project:${p.id}`)} style={miniBtn}>Detail →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!user && projects.length > 20 && (
          <div style={{ textAlign: "center", padding: "1.5rem", color: dim, fontSize: "0.85rem" }}>
            Skrytých {projects.length - 20} projektov. <button onClick={openLogin} style={linkBtn}>Zaregistruj sa zadarmo</button> pre plný zoznam.
          </div>
        )}
      </div>
    </main>
  );
}

function SummaryCards({ projects }) {
  const totals = projects.reduce((acc, p) => {
    acc.total += p.total_units || 0;
    acc.available += p.available_units || 0;
    acc.sold += p.sold_units || 0;
    return acc;
  }, { total: 0, available: 0, sold: 0 });
  const soldOut = projects.filter(p => p.sold_percentage === 100).length;

  const Card = ({ label, value, sub }) => (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: "1.5rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: green, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em", fontFamily: mono }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: dim, marginTop: "0.35rem" }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
      <Card label="Projektov" value={projects.length} sub="aktívne na trhu" />
      <Card label="Bytov celkom" value={totals.total.toLocaleString("sk-SK")} sub="naprieč všetkými projektmi" />
      <Card label="Voľné" value={totals.available.toLocaleString("sk-SK")} sub="aktuálne na trhu" />
      <Card label="Predané" value={totals.sold.toLocaleString("sk-SK")} sub={`vypredaných projektov: ${soldOut}`} />
    </div>
  );
}

/* ───────────────────── PROJECT DETAIL (gated) ───────────────────── */
export function LiveProjectDetail({ projectId, setCurrent, openLogin }) {
  const { user, profile, tier, isPaid, reloadProfile } = useAuth();
  const { flats, loading, error } = useProjectFlats(projectId);
  const { projects } = useProjects();
  const project = projects.find(p => p.id === projectId);

  if (!user) {
    return (
      <GateMessage
        title="Prihlás sa pre detail projektu"
        body="Free účet ti odomkne plný detail ľubovoľného 1 projektu. Paid účet má prístup ku všetkým."
        cta="Prihlásiť sa (free)"
        onCta={openLogin}
        setCurrent={setCurrent}
      />
    );
  }

  // Logged in but not paid and hasn't chosen this project
  const canViewDetail = isPaid || profile?.chosen_project_id === projectId;

  if (!canViewDetail) {
    return (
      <ChooseProjectGate
        projectId={projectId}
        projectName={project?.name || projectId}
        profile={profile}
        reloadProfile={reloadProfile}
        setCurrent={setCurrent}
      />
    );
  }

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      <button onClick={() => setCurrent && setCurrent("Live")} style={{ ...linkBtn, marginBottom: "1rem" }}>← Späť na projekty</button>

      <Label>{project?.district || "Bratislava"}</Label>
      <h1 className="sec-title">{project?.name || projectId}</h1>
      <p className="sec-desc" style={{ marginBottom: "2rem" }}>
        {project ? `${project.total_units} bytov · ${project.available_units} voľných · ${project.sold_percentage ?? "?"}% predané` : ""}
        {!isPaid && <span style={{ display: "block", marginTop: "0.5rem", color: dim, fontSize: "0.85rem" }}>
          ⓘ Zobrazujeme aktuálny snapshot. História a analytika sú súčasťou <button onClick={() => setCurrent && setCurrent("Pricing")} style={linkBtn}>paid tier-u</button>.
        </span>}
      </p>

      {loading ? <div style={{ color: dim }}>Načítavam byty…</div> :
        error ? <div style={{ color: "#ff6b6b" }}>Chyba: {error.message}</div> :
        flats.length === 0 ? <div style={{ color: dim }}>Žiadne dáta.</div> :
        <FlatsTable flats={flats} />}
    </main>
  );
}

function FlatsTable({ flats }) {
  const stavStyle = {
    V: { color: "#00e5a0", bg: "rgba(0,229,160,0.08)" },
    P: { color: "#f5a623", bg: "rgba(245,166,35,0.08)" },
    R: { color: "#888", bg: "rgba(136,136,136,0.08)" },
    PR: { color: "#aaa", bg: "rgba(170,170,170,0.08)" },
  };
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={th}>Byt</th>
              <th style={th}>Budova</th>
              <th style={th}>Posch.</th>
              <th style={th}>Izby</th>
              <th style={{ ...th, textAlign: "right" }}>Interiér</th>
              <th style={{ ...th, textAlign: "right" }}>Exteriér</th>
              <th style={{ ...th, textAlign: "right" }}>Celk.</th>
              <th style={{ ...th, textAlign: "right" }}>Cena</th>
              <th style={th}>Orient.</th>
              <th style={th}>Kolaud.</th>
              <th style={th}>Stav</th>
            </tr>
          </thead>
          <tbody>
            {flats.map(f => (
              <tr key={f.id} style={{ borderTop: `1px solid ${border}` }}>
                <td style={td}><strong>{f.unit_detail || f.unit_id}</strong></td>
                <td style={{ ...td, color: dim }}>{f.budova || "—"}</td>
                <td style={{ ...td, fontFamily: mono }}>{f.poschodie ?? "—"}</td>
                <td style={{ ...td, fontFamily: mono }}>{f.izby ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{f.obytna_plocha ? `${f.obytna_plocha} m²` : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{f.exterier_plocha ? `${f.exterier_plocha}` : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{f.celkova_plocha ? `${f.celkova_plocha}` : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                  {f.cena_s_dph != null ? `${Math.round(f.cena_s_dph).toLocaleString("sk-SK")} €` :
                    f.cena_s_dph_text ? <span style={{ color: dim }}>{f.cena_s_dph_text}</span> : "—"}
                </td>
                <td style={{ ...td, fontFamily: mono, color: dim }}>{f.orientacia || "—"}</td>
                <td style={{ ...td, fontFamily: mono, color: dim }}>{f.kolaudacia || "—"}</td>
                <td style={td}>
                  {f.stav && stavStyle[f.stav] ? (
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontFamily: mono, fontSize: "0.7rem", fontWeight: 600,
                      color: stavStyle[f.stav].color, background: stavStyle[f.stav].bg,
                    }}>{f.stav}</span>
                  ) : <span style={{ color: dim, fontSize: "0.75rem" }}>{f.stav || "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChooseProjectGate({ projectId, projectName, profile, reloadProfile, setCurrent }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const assign = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("user_profiles").update({ chosen_project_id: projectId }).eq("id", profile.id);
    setBusy(false);
    if (error) setErr(error.message);
    else reloadProfile();
  };
  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 720, margin: "0 auto" }}>
      <Label>Free tier gate</Label>
      <h1 className="sec-title">Vyber si 1 projekt</h1>
      <p className="sec-desc" style={{ marginBottom: "1.5rem" }}>
        Free účet ti odomkne plný detail <strong style={{ color: green }}>1 projektu</strong>. Chceš sledovať <strong style={{ color: green }}>{projectName}</strong>?
      </p>
      {profile?.chosen_project_id && (
        <div style={{ padding: "1rem", background: "#1a1a1f", border: `1px solid ${border}`, borderRadius: 8, marginBottom: "1rem", fontSize: "0.85rem", color: dim }}>
          Momentálne máš priradený projekt: <strong style={{ color: "#e8e8ed" }}>{profile.chosen_project_id}</strong>. Touto akciou ho zmeníš.
        </div>
      )}
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <button className="btn-p" onClick={assign} disabled={busy}>{busy ? "Ukladám…" : `Sledovať ${projectName}`}</button>
        <button className="btn-s" onClick={() => setCurrent && setCurrent("Live")}>Späť</button>
      </div>
      {err && <div style={{ color: "#ff6b6b", marginTop: "0.75rem" }}>{err}</div>}
      <p style={{ fontSize: "0.8rem", color: dim, marginTop: "2rem" }}>
        Chceš sledovať všetkých 60 projektov naraz? <button onClick={() => setCurrent && setCurrent("Pricing")} style={linkBtn}>Upgrade na paid</button>.
      </p>
    </main>
  );
}

function GateMessage({ title, body, cta, onCta, setCurrent }) {
  return (
    <main style={{ padding: "6rem 2rem 4rem", maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.75rem" }}>{title}</h1>
      <p style={{ color: dim, fontSize: "1rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>{body}</p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
        <button className="btn-p" onClick={onCta}>{cta}</button>
        <button className="btn-s" onClick={() => setCurrent && setCurrent("Live")}>Späť na dashboard</button>
      </div>
    </main>
  );
}

/* ───────────────────── ANALYTICS (paid only) ───────────────────── */
export function LiveAnalytics({ setCurrent, openLogin }) {
  const { user, isPaid } = useAuth();
  if (!user) {
    return <GateMessage title="Prihlás sa pre analytiku" body="Analytika a trendy sú súčasťou paid účtu." cta="Prihlásiť sa" onCta={openLogin} setCurrent={setCurrent} />;
  }
  if (!isPaid) {
    return (
      <main style={{ padding: "5rem 2rem 4rem", maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📊</div>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 700 }}>Analytika je pre paid tier</h1>
        <p style={{ color: dim, lineHeight: 1.6, marginTop: "0.75rem", marginBottom: "1.5rem" }}>
          Cenové trendy naprieč mesiacmi, heat mapy okresov, top developers, absorption rate,
          monthly PDF reporty — to všetko v paid tier-e.
        </p>
        <button className="btn-p" onClick={() => setCurrent && setCurrent("Pricing")}>Zobraziť cenník</button>
      </main>
    );
  }
  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1000, margin: "0 auto" }}>
      <Label>Analytics</Label>
      <h1 className="sec-title">Trendy a insights</h1>
      <p className="sec-desc">Čoskoro: grafy cien v čase, heat mapy okresov, export dát, monthly reporty.</p>
      <div style={{ marginTop: "2rem", padding: "3rem", border: `1px dashed ${border}`, borderRadius: 12, textAlign: "center", color: dim }}>
        Detailné grafy a trend analytika v príprave — pre včasný prístup napíš na residata@proton.me
      </div>
    </main>
  );
}

/* ───────────────────── ADMIN ───────────────────── */
export function LiveAdmin({ setCurrent }) {
  const { isAdmin, loading } = useAuth();
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("user_profiles").select("*").order("created_at", { ascending: false })
      .then(({ data, error }) => { setUsers(data || []); if (error) setErr(error.message); });
  }, [isAdmin]);

  if (loading) return <main style={{ padding: "5rem 2rem" }}><div style={{ color: dim }}>Loading…</div></main>;
  if (!isAdmin) return <main style={{ padding: "5rem 2rem", textAlign: "center" }}><h1>403</h1><p style={{ color: dim }}>Admin only.</p></main>;

  const setTier = async (id, tier) => {
    const { error } = await supabase.from("user_profiles").update({ tier }).eq("id", id);
    if (error) alert(error.message); else setUsers(u => u.map(x => x.id === id ? { ...x, tier } : x));
  };

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 900, margin: "0 auto" }}>
      <Label>Admin</Label>
      <h1 className="sec-title">User tier management</h1>
      {err && <div style={{ color: "#ff6b6b" }}>{err}</div>}
      <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", marginTop: "1.5rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={th}>Email</th>
              <th style={th}>Tier</th>
              <th style={th}>Project</th>
              <th style={th}>Created</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderTop: `1px solid ${border}` }}>
                <td style={td}>{u.email}</td>
                <td style={td}><TierBadge tier={u.tier} /></td>
                <td style={{ ...td, color: dim }}>{u.chosen_project_id || "—"}</td>
                <td style={{ ...td, color: dim, fontFamily: mono }}>{u.created_at?.slice(0, 10)}</td>
                <td style={td}>
                  <select defaultValue={u.tier} onChange={e => setTier(u.id, e.target.value)}
                    style={{ background: "#0e0e10", color: "#e8e8ed", border: `1px solid ${border}`, padding: "0.3rem 0.5rem", borderRadius: 4, fontSize: "0.8rem" }}>
                    <option value="free">free</option>
                    <option value="paid">paid</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function TierBadge({ tier }) {
  const c = tier === "paid" ? "#00e5a0" : tier === "admin" ? "#f5a623" : dim;
  return <span style={{ fontFamily: mono, fontSize: "0.7rem", color: c, border: `1px solid ${c}`, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", fontWeight: 600 }}>{tier}</span>;
}

/* ───────────────────── EARLY ACCESS BADGE ───────────────────── */
export function EarlyAccessBadge() {
  const { remaining_slots } = useEarlyAccessStats();
  if (remaining_slots <= 0) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "0.5rem",
      padding: "0.4rem 0.9rem", background: "rgba(0,229,160,0.1)",
      border: "1px solid rgba(0,229,160,0.3)", borderRadius: 999,
      fontFamily: mono, fontSize: "0.7rem", color: green, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: green }}></span>
      Early Access — zostáva {remaining_slots} {remaining_slots === 1 ? "miesto" : remaining_slots < 5 ? "miesta" : "miest"} z 9
    </div>
  );
}

/* ───────────────────── SHARED STYLES ───────────────────── */
function Label({ children }) {
  return <div style={{ ...labelStyle, marginBottom: "1rem" }}>{children}</div>;
}
const labelStyle = { fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase" };
const th = { padding: "0.75rem 1rem", fontWeight: 600 };
const td = { padding: "0.75rem 1rem", color: "#e8e8ed" };
const linkBtn = { background: "none", border: "none", color: green, cursor: "pointer", padding: 0, fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline" };
const miniBtn = { background: "transparent", border: `1px solid ${border}`, color: "#e8e8ed", padding: "0.35rem 0.75rem", borderRadius: 6, cursor: "pointer", fontSize: "0.75rem" };
