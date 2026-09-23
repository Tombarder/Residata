"""Render an issue's Slovak text from its generated figures.

WHY THIS EXISTS
    `SKILL.md`: *"Every figure interpolates from the generated JSON. No number is
    ever typed."* That rule is easy to state and easy to break — a writer who has
    the figure sheet open will retype one. So the draft is a TEMPLATE: the prose
    is written by hand, every number is a named placeholder, and this script is
    the only thing that ever puts the two together.

    It fails on an unknown placeholder rather than leaving `{something}` in the
    text, and it fails on a bare four-digit number in the template, which is the
    shape a typed figure has.

USAGE
    python3 src/content/analyzy/drafts/render.py mapa-novostavieb-2026-09
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

#: A town needs this many available homes before its median is set beside another
#: town's. Below it a "ranking" is a list of individual price lists in size order.
RANK_MIN_STOCK = 90

#: A town is on the map from this many available homes. Mirrors the floor inside
#: market_report's Q_NATIONAL_MAP; the two must say the same number.
MAP_MIN_STOCK = 5

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"

NBSP = " "


MONTHS_SK = ["januára", "februára", "marca", "apríla", "mája", "júna", "júla",
             "augusta", "septembra", "októbra", "novembra", "decembra"]


def sk_date(iso: str) -> str:
    """21. septembra 2026. An ISO date in Slovak body copy reads as machine output."""
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d}. {MONTHS_SK[m - 1]} {y}"


MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"]


def en_date(iso: str) -> str:
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} {MONTHS_EN[m - 1]} {y}"


def en_dec(x, places: int = 1) -> str:
    """The same figure with an English decimal point. The pair exists so one
    number never appears as 5,0 in the Slovak text and 5.0 in a table under it."""
    return f"{x:.{places}f}"


#: Slovak declines place names, and "v Staré Mesto" reads as machine output. The
#: map is explicit rather than rule-based because the rules have too many
#: exceptions; an unknown district fails the render instead of guessing.
LOCATIVE_SK = {
    "Ružinov": "Ružinove", "Staré Mesto": "Starom Meste", "Petržalka": "Petržalke",
    "Nové Mesto": "Novom Meste", "Rača": "Rači", "Dúbravka": "Dúbravke",
    "Lamač": "Lamači", "Devínska Nová Ves": "Devínskej Novej Vsi",
    "Karlova Ves": "Karlovej Vsi", "Vrakuňa": "Vrakuni",
    "Podunajské Biskupice": "Podunajských Biskupiciach",
    "Záhorská Bystrica": "Záhorskej Bystrici", "Vajnory": "Vajnoroch",
    "Devín": "Devíne", "Jarovce": "Jarovciach", "Rusovce": "Rusovciach",
    "Čunovo": "Čunove",
}


def locative(name: str) -> str:
    if name not in LOCATIVE_SK:
        raise KeyError(f"no Slovak locative recorded for district {name!r} — add it "
                       f"to LOCATIVE_SK rather than letting the article decline it wrong")
    return LOCATIVE_SK[name]


MONTHS_SK_NOM = ["január", "február", "marec", "apríl", "máj", "jún", "júl",
                 "august", "september", "október", "november", "december"]


def months_sk(n: int) -> str:
    """päť mesiacov / dva mesiace / jeden mesiac — Slovak counts in three forms."""
    words = {1: "jeden mesiac", 2: "dva mesiace", 3: "tri mesiace", 4: "štyri mesiace"}
    return words.get(n, f"{n} mesiacov")


def genitive_month_sk(ym: str) -> str:
    """"od mája 2026" — a month after `od` takes the genitive."""
    y, m = ym.split("-")
    return f"{MONTHS_SK[int(m) - 1]} {y}"


def direction_sk(pct: float, up: str, down: str, flat: str = "sa nezmenila") -> str:
    """Say which way it went. A neutral "moved by" over a fall reads as evasion."""
    if abs(pct) < 0.05:
        return flat
    return up if pct > 0 else down


def sk_month(ym: str) -> str:
    y, m = ym.split("-")
    return f"{MONTHS_SK_NOM[int(m) - 1]} {y}"


def en_month(ym: str) -> str:
    y, m = ym.split("-")
    return f"{MONTHS_EN[int(m) - 1]} {y}"


def sk_int(n) -> str:
    """4 231 with a non-breaking space, the way Slovak prints thousands."""
    return f"{int(round(n)):,}".replace(",", NBSP)


def sk_dec(x, places: int = 1) -> str:
    """14,4 — comma, never a point. An English decimal mark in Slovak market copy
    identifies the writer as an outsider in one character."""
    return f"{x:.{places}f}".replace(".", ",")


def _u_shape(qt: dict, lang: str) -> str:
    """Describe the actual ordering of price-per-metre by layout."""
    rows = sorted(qt["byRooms"], key=lambda r: r["meanM2"])
    dear = {r["disp"] for r in rows[-2:]}
    cheap = {r["disp"] for r in rows[:2]}
    if dear == {"1", "4+"} and cheap == {"2", "3"}:
        return ("Najdrahšie na meter sú malé a veľké byty, najlacnejší je dvoj- a "
                "trojizbový stred." if lang == "sk" else
                "The dearest metre is in small and large flats, the cheapest in the "
                "two- and three-room middle.")
    names_sk = {"1": "jednoizbové", "2": "dvojizbové", "3": "trojizbové",
                "4+": "štvor- a viacizbové"}
    names_en = {"1": "one-room", "2": "two-room", "3": "three-room",
                "4+": "four-room and larger"}
    n = names_sk if lang == "sk" else names_en
    hi, lo = rows[-1]["disp"], rows[0]["disp"]
    return (f"Najdrahšie na meter sú {n[hi]} byty, najlacnejšie {n[lo]}."
            if lang == "sk" else
            f"The dearest metre is in {n[hi]} flats, the cheapest in {n[lo]} ones.")


def _series_shape(qt: dict, lang: str) -> str:
    """Stagnation is a claim about a range, so it is measured as one."""
    vals = [q["meanM2Rebased"] for q in qt["published"]["quarters"]] + [qt["ours"]["meanM2"]]
    spread = (max(vals) / min(vals) - 1) * 100
    if spread < 5:
        return "stagnácia" if lang == "sk" else "stagnation"
    return "mierny rast" if lang == "sk" else "a mild rise"



def national_table(rep: dict, lang: str) -> str:
    """Every town we track: what is on offer, what it costs, how fast it clears."""
    n = rep["nationalQuarterly"]
    head = (("| Mesto | Ponuka | €/m² s DPH | Priemerný byt | Výmera | Predané | "
             "Mesiacov do vypredania |\n|---|---:|---:|---:|---:|---:|---:|")
            if lang == "sk" else
            ("| Town | On offer | €/m² incl. VAT | Average flat | Floor area | Sold | "
             "Months to clear |\n|---|---:|---:|---:|---:|---:|---:|"))
    rows = []
    for t in n["towns"]:
        m2 = f"{sk_int(t['meanM2'])} €" if t["meanM2"] else "—"
        pr = f"{sk_int(t['meanPrice'])} €" if t["meanPrice"] else "—"
        ar = (f"{sk_dec(t['meanArea'])} m²" if lang == "sk"
              else f"{en_dec(t['meanArea'])} m²") if t["meanArea"] else "—"
        mo = (sk_dec(t["monthsToClear"]) if lang == "sk" else en_dec(t["monthsToClear"])) \
             if t["monthsToClear"] is not None else "—"
        rows.append(f"| {t['city']} | {sk_int(t['stock'])} | {m2} | {pr} | {ar} | "
                    f"{sk_int(t['sold'])} | {mo} |")
    return head + "\n" + "\n".join(rows)


def okres_supply_table(rep: dict, lang: str) -> str:
    """Bratislava's offer by okres — the table Bencont prints, on our numbers."""
    head = (("| Okres | Ponuka | Podiel | Projekty | €/m² s DPH | Priemerný byt | Výmera |"
             "\n|---|---:|---:|---:|---:|---:|---:|") if lang == "sk" else
            ("| District | On offer | Share | Projects | €/m² incl. VAT | Average flat | "
             "Floor area |\n|---|---:|---:|---:|---:|---:|---:|"))
    rows = []
    for o in rep["baByOkres"]["rows"]:
        dec = sk_dec if lang == "sk" else en_dec
        m2 = f"{sk_int(o['meanM2'])} €" if o["meanM2"] else "—"
        pr = f"{sk_int(o['meanPrice'])} €" if o["meanPrice"] else "—"
        ar = f"{dec(o['meanArea'])} m²" if o["meanArea"] else "—"
        rows.append(f"| {o['okres']} | {sk_int(o['stock'])} | {dec(o['sharePct'])} % | "
                    f"{o['projects']} | {m2} | {pr} | {ar} |")
    return head + "\n" + "\n".join(rows)


def okres_sales_table(rep: dict, lang: str) -> str:
    """And what actually sold in each of them."""
    head = (("| Okres | Predané | Podiel na predaji | Posledná cenníková cena €/m² s DPH |"
             "\n|---|---:|---:|---:|") if lang == "sk" else
            ("| District | Sold | Share of sales | Last listed €/m² incl. VAT |"
             "\n|---|---:|---:|---:|"))
    dec = sk_dec if lang == "sk" else en_dec
    rows = [f"| {o['okres']} | {sk_int(o['sold'])} | {dec(o['soldSharePct'])} % | "
            f"{(sk_int(o['soldM2']) + ' €') if o['soldM2'] else '—'} |"
            for o in rep["baByOkres"]["rows"]]
    return head + "\n" + "\n".join(rows)



ROOM_COL_SK = {"1": "1-izbový", "2": "2-izbový", "3": "3-izbový", "4+": "4- a viacizbový"}
ROOM_COL_EN = {"1": "1-room", "2": "2-room", "3": "3-room", "4+": "4-room and larger"}


def city_disposition_table(rep: dict, lang: str, field: str) -> str:
    """What each layout costs, town by town. `field` is medPrice or medM2."""
    cd = rep["cityByDisposition"]
    names = ROOM_COL_SK if lang == "sk" else ROOM_COL_EN
    first = "Mesto" if lang == "sk" else "Town"
    head = ("| " + first + " | " + " | ".join(names[d] for d in cd["dispositions"]) + " |"
            + "\n|---" + "|---:" * len(cd["dispositions"]) + "|")
    rows = []
    for r in cd["rows"]:
        cells = []
        for d in cd["dispositions"]:
            c = r["cells"].get(d)
            cells.append(f"{sk_int(c[field])} €" if c else "—")
        rows.append(f"| {r['city']} | " + " | ".join(cells) + " |")
    return head + "\n" + "\n".join(rows)


def city_change_table(rep: dict, lang: str) -> str:
    """And what the SAME flats did over the quarter. A cell with too small a
    panel prints nothing rather than a number built on a handful of flats."""
    cd = rep["cityByDisposition"]
    names = ROOM_COL_SK if lang == "sk" else ROOM_COL_EN
    first = "Mesto" if lang == "sk" else "Town"
    head = ("| " + first + " | " + " | ".join(names[d] for d in cd["dispositions"]) + " |"
            + "\n|---" + "|---:" * len(cd["dispositions"]) + "|")
    dec = sk_dec if lang == "sk" else en_dec
    rows = []
    for r in cd["rows"]:
        cells = []
        for d in cd["dispositions"]:
            c = r["cells"].get(d) or {}
            if c.get("changePct") is None:
                cells.append("—")
            else:
                sign = "+" if c["changePct"] >= 0 else "−"
                cells.append(f"{sign}{dec(abs(c['changePct']), 2)} %")
            
        rows.append(f"| {r['city']} | " + " | ".join(cells) + " |")
    return head + "\n" + "\n".join(rows)




# ── the Bratislava quarterly overview ────────────────────────────────────
def overview_supply_table(rep: dict, lang: str) -> str:
    """Supply by okres, with what a buyer can actually move into.

    The completion split has three parts, not two, and the third is the point:
    a flat whose developer publishes no completion date at all is NOT the same
    as one known to be under construction, and folding the two together would
    hide the only thing in this table a buyer cannot find elsewhere.
    """
    ov = rep["overview"]
    head = (("| Okres | Byty v ponuke | Podiel | Dokončené | Rozostavané | Termín nezverejnený | Projekty | €/m² s DPH |"
             "\n|---|---:|---:|---:|---:|---:|---:|---:|") if lang == "sk" else
            ("| District | Flats on offer | Share | Finished | Under construction | No date published | Projects | €/m² incl. VAT |"
             "\n|---|---:|---:|---:|---:|---:|---:|---:|"))
    dec = sk_dec if lang == "sk" else en_dec
    rows, tot = [], sum(a["n"] for a in ov["okres_supply"].values())
    for o, a in ov["okres_supply"].items():
        m2 = f"{sk_int(a['m2'])} €" if a["m2"] else "—"
        rows.append(f"| {o} | {sk_int(a['n'])} | {dec(100 * a['n'] / tot)} % | "
                    f"{sk_int(a['done'])} | {sk_int(a['building'])} | "
                    f"{sk_int(a['unknown'])} | {a['projects']} | {m2} |")
    T = {k: sum(a[k] for a in ov["okres_supply"].values())
         for k in ("n", "done", "building", "unknown", "projects")}
    total = "Bratislava"
    rows.append(f"| **{total}** | **{sk_int(T['n'])}** | **100,0 %** | "
                f"**{sk_int(T['done'])}** | **{sk_int(T['building'])}** | "
                f"**{sk_int(T['unknown'])}** | **{T['projects']}** | |")
    return head + "\n" + "\n".join(rows)


def overview_sales_table(rep: dict, lang: str) -> str:
    """What sold in each okres, and at what last listed price."""
    ov = rep["overview"]
    head = (("| Okres | Predané byty | Podiel na predaji | Podiel na ponuke | Posledná cenníková cena €/m² s DPH | Z toho s cenou |"
             "\n|---|---:|---:|---:|---:|---:|") if lang == "sk" else
            ("| District | Flats sold | Share of sales | Share of supply | Last listed €/m² incl. VAT |"
             "\n|---|---:|---:|---:|---:|"))
    dec = sk_dec if lang == "sk" else en_dec
    sold_tot = sum(a["n"] for a in ov["okres_sales"].values())
    sup_tot = sum(a["n"] for a in ov["okres_supply"].values())
    rows = []
    for o, a in ov["okres_sales"].items():
        m2 = f"{sk_int(a['m2'])} €" if a["m2"] else "—"
        sup = ov["okres_supply"].get(o, {}).get("n", 0)
        _np = a.get("n_priced")
        rows.append(f"| {o} | {sk_int(a['n'])} | {dec(100 * a['n'] / sold_tot)} % | "
                    f"{dec(100 * sup / sup_tot)} % | {m2} | "
                    f"{sk_int(_np) if _np is not None else '—'} |")
    total = "Bratislava"
    _npt = sum(a.get("n_priced") or 0 for a in ov["okres_sales"].values())
    rows.append(f"| **{total}** | **{sk_int(sold_tot)}** | **100,0 %** | **100,0 %** | | "
                f"**{sk_int(_npt)}** |")
    return head + "\n" + "\n".join(rows)


def overview_price_table(rep: dict, lang: str) -> str:
    """€/m² this quarter against last, on the SAME projects in both."""
    ov = rep["overview"]
    # The flats the change rests on, because they differ a lot between okresy:
    # the comparison covers 92 % of one okres and 27 % of another, and a reader
    # judging a +4,6 % needs to know which they are looking at.
    head = (("| Okres | Predchádzajúci štvrťrok | Aktuálny štvrťrok | Zmena | Byty v porovnaní |"
             "\n|---|---:|---:|---:|---:|") if lang == "sk" else
            ("| District | Previous quarter | Current quarter | Change | Flats compared |"
             "\n|---|---:|---:|---:|---:|"))
    dec = sk_dec if lang == "sk" else en_dec
    rows = []
    for o, a in ov["okres_price"].items():
        sign = "+" if a["chg_pct"] >= 0 else "−"
        rows.append(f"| {o} | {sk_int(a['m2_prev'])} € | {sk_int(a['m2_cur'])} € | "
                    f"{sign}{dec(abs(a['chg_pct']))} % | "
                    f"{sk_int(a.get('units') or round((a.get('unit_days') or a.get('n', 0)) / 14))} |")
    return head + "\n" + "\n".join(rows)


def _sales_vs_prev(ov: dict, sold: int) -> str:
    """Sales against the same number of days of the previous quarter.

    🔴 A DIRECTION IS A FIGURE. The verb comes from the two numbers.
    """
    prev = ov.get("prev_period_sales")
    if not prev:
        return ""
    pct = (sold / prev - 1) * 100
    if abs(pct) < 1:
        return "prakticky rovnako ako"
    return ("viac" if pct > 0 else "menej") + f" o {sk_dec(abs(pct))} % než"


def _supply_clause(ov: dict) -> str:
    """Whether the offer grew or shrank, on the same projects at both ends.

    🔴 A DIRECTION IS A FIGURE. "ubudlo" printed over a rise is the mistake this
    series has already made, so the verb is derived from the numbers.
    """
    a, b = ov.get("panel_supply_prev"), ov.get("panel_supply_cur")
    if not a or not b:
        return ""
    pct = (b / a - 1) * 100
    if abs(pct) < 0.5:
        return "zostal prakticky rovnaký"
    verb = "narástol" if pct > 0 else "klesol"
    return f"{verb} o {sk_dec(abs(pct))} %"


def _fraction_sk(pct: float) -> str:
    """A share as a Slovak fraction phrase, computed.

    🔴 A FRACTION IN WORDS IS A FIGURE. "necelá desatina predaja" was published
    while it was false (63 of 575 is 11,0 %), and "viac než polovici" typed over
    53,4 % is the same mistake waiting for the number to move. The phrase is
    derived from the number it describes, so it cannot contradict it.
    """
    bands = [(90, "takmer celej"), (66, "viac než dvom tretinám"),
             (55, "viac než polovici"), (45, "približne polovici"),
             (30, "viac než tretine"), (20, "približne štvrtine"),
             (12, "približne pätine"), (8, "približne desatine"),
             (3, "niekoľkým percentám"), (0, "necelým trom percentám")]
    for lo, phrase in bands:
        if pct >= lo:
            return phrase
    return "žiadnemu"


def _overview_vars(rep: dict) -> dict:
    """Every scalar the overview issue prints. Nothing is typed into the prose."""
    ov = rep["overview"]
    sup, sal, pr = ov["okres_supply"], ov["okres_sales"], ov["okres_price"]
    tot = sum(a["n"] for a in sup.values())
    sold = sum(a["n"] for a in sal.values())
    done = sum(a["done"] for a in sup.values())
    building = sum(a["building"] for a in sup.values())
    unknown = sum(a["unknown"] for a in sup.values())

    by_supply = sorted(sup.items(), key=lambda kv: -kv[1]["n"])
    by_sales = sorted(sal.items(), key=lambda kv: -kv[1]["n"])
    two = by_supply[0][1]["n"] + by_supply[1][1]["n"]

    # 🔴 THE CITY €/m² IS MEASURED, NOT WEIGHTED TOGETHER. Weighting each
    # okres mean by its TOTAL flats overweights okresy with many unpriced ones —
    # it printed 5 987 beside a chart point of 5 722, computed straight over
    # every priced unit. own_quarters holds that same figure, so the prose and
    # the long-run chart cannot disagree.
    _qkey = f"{ov['quarter_start'][:4]}Q{(int(ov['quarter_start'][5:7]) - 1) // 3 + 1}"
    city_m2 = ov["own_quarters"].get(_qkey)

    # the q/q move for the city, on the panel — computed, never the mean of means
    _w = lambda a: a.get("units") or a.get("unit_days") or a.get("n", 0)
    pnum = sum(a["m2_cur"] * _w(a) for a in pr.values())
    pden = sum(a["m2_prev"] * _w(a) for a in pr.values())
    qoq = (pnum / pden - 1) * 100 if pden else 0.0

    lay = {r["k"]: int(float(r["n"])) for r in ov["layout_supply"]}
    lay_tot = sum(v for k, v in lay.items() if k != "(neuvedené)")
    two_three = lay.get("2-izb", 0) + lay.get("3-izb", 0)

    # 🔴 A SHARE MUST CARRY ITS BASE. "72,7 % ponuky" is computed on the flats
    # whose room count is stated (4 019), not on the whole offer (4 053, where
    # it is 72,1 %) — and the sentence did not say so, which is the reader
    # arriving at a different number from the same words.
    _layout_base = sk_int(lay_tot)

    # The completion split's widest okres. The table shows it and the prose
    # ignored it: in one okres more than half the offer has no published
    # completion date at all, in another none of it.
    _unk = sorted(((o, a["unknown"] / a["n"], a["unknown"])
                   for o, a in sup.items() if a["n"]), key=lambda t: -t[1])

    # Read from the SUPPLY table, which is the one this sentence sits beside.
    # The q/q table is restricted to the projects present in both quarters, so
    # its levels differ by design — taking the spread from there put two
    # different measurements in one paragraph.
    _priced = {o: a["m2"] for o, a in sup.items() if a["m2"]}
    # The okres whose share of sales most exceeds its share of supply, and the
    # one where it is most the other way. Both computed: "sells fastest" is a
    # superlative, and a superlative is a figure.
    _tot_s = sum(a["n"] for a in sal.values()) or 1
    _tot_p = sum(a["n"] for a in sup.values()) or 1
    _rel = sorted(((o, 100 * a["n"] / _tot_s - 100 * sup.get(o, {}).get("n", 0) / _tot_p)
                   for o, a in sal.items()), key=lambda t: -t[1])

    dear = max(_priced.items(), key=lambda kv: kv[1])
    cheap = min(_priced.items(), key=lambda kv: kv[1])

    def pair(name, value_sk, value_en=None):
        return {name: value_sk, name + "En": value_en if value_en is not None else value_sk}

    out = {
        "supplyTotal": sk_int(tot),
        # The city figure, not the sum of five independently-rounded okres means.
        "supplyProjects": sum(a["projects"] for a in sup.values()),
        "meanFlatPrice": sk_int(ov["mean_price"]) if ov.get("mean_price") else "—",
        "meanFlatArea": sk_dec(ov["mean_area"]) if ov.get("mean_area") else "—",
        "salesTotal": sk_int(sold),
        "m2Total": sk_int(city_m2) if city_m2 else "—",
        "supplyDone": sk_int(done),
        "supplyDoneShare": sk_dec(100 * done / tot), "supplyDoneShareEn": en_dec(100 * done / tot),
        "supplyBuildingShare": sk_dec(100 * building / tot),
        "supplyBuildingShareEn": en_dec(100 * building / tot),
        "supplyUnknownShare": sk_dec(100 * unknown / tot),
        "supplyUnknownShareEn": en_dec(100 * unknown / tot),
        "topSupplyOkres": by_supply[0][0], "topSupplyN": sk_int(by_supply[0][1]["n"]),
        "topSupplyShare": sk_dec(100 * by_supply[0][1]["n"] / tot),
        "topSupplyShareEn": en_dec(100 * by_supply[0][1]["n"] / tot),
        "topSalesOkres": by_sales[0][0], "topSalesN": sk_int(by_sales[0][1]["n"]),
        "twoOkresShare": sk_dec(100 * two / tot), "twoOkresShareEn": en_dec(100 * two / tot),
        "twoThreeShare": sk_dec(100 * two_three / lay_tot),
        "twoThreeShareEn": en_dec(100 * two_three / lay_tot),
        "panelProjects": ov["panel_projects"],
        "panelUnits": sk_int(ov["panel_units"]) if ov.get("panel_units") else "—",
        "periodDays": ov.get("period_days"),
        "settlingDays": ov.get("sale_settling_days"),
        # Did the offer grow or shrink? Same-panel, because our raw count moves
        # when WE onboard a project — it went 3 399 -> 4 052 between Q2 and Q3
        # while the projects we track went 70 -> 93.
        "panelSupplyPrev": sk_int(ov["panel_supply_prev"]) if ov.get("panel_supply_prev") else "—",
        "panelSupplyCur": sk_int(ov["panel_supply_cur"]) if ov.get("panel_supply_cur") else "—",
        "panelSupplyClause": _supply_clause(ov),
        # The whole clause, not just the figure: "+0,0 %" is honest and reads
        # like a rounding accident, and a bare percentage cannot be slotted into
        # a sentence that also has to work when there is no movement to report.
        "qoqPct": ("prakticky nezmenila" if abs(qoq) < 0.05
                   else "zmenila o " + ("+" if qoq >= 0 else "−")
                        + sk_dec(abs(qoq)) + " %"),
        "qoqPctEn": ("barely at all" if abs(qoq) < 0.05
                     else "by " + ("+" if qoq >= 0 else "−")
                          + en_dec(abs(qoq)) + " %"),
        "okresSpread": f"{sk_int(dear[1] - cheap[1])} €/m²",
        "okresSpreadEn": f"{sk_int(dear[1] - cheap[1])} €/m²",
        "dearestOkres": dear[0], "cheapestOkres": cheap[0],
        "overviewSupplyTable": overview_supply_table(rep, "sk"),
        "overviewSupplyTableEn": overview_supply_table(rep, "en"),
        "overviewSalesTable": overview_sales_table(rep, "sk"),
        "overviewSalesTableEn": overview_sales_table(rep, "en"),
        "layoutBase": _layout_base,
        "noDateOkres": _unk[0][0],
        "noDateOkresPct": sk_dec(100 * _unk[0][1]),
        "noDateOkresN": sk_int(_unk[0][2]),
        "noDateOkresFraction": _fraction_sk(100 * _unk[0][1]),
        "noDateLowClause": ("pri žiadnom byte" if _unk[-1][2] == 0
                            else f"pri {sk_dec(100 * _unk[-1][1])} % ponuky"),
        "noDateLowOkres": _unk[-1][0],
        # "0,0 %" is honest and reads like a printing fault. A share that
        # rounds to nothing is said in words.
        "noDateLowPct": ("ani jeden byt" if _unk[-1][2] == 0
                         else sk_dec(100 * _unk[-1][1]) + " % ponuky"),
        "fastestOkres": _rel[0][0],
        "fastestSalesShare": sk_dec(100 * sal[_rel[0][0]]["n"] / _tot_s),
        "fastestSupplyShare": sk_dec(100 * sup[_rel[0][0]]["n"] / _tot_p),
        "slowestOkres": _rel[-1][0],
        "slowestSalesShare": sk_dec(100 * sal[_rel[-1][0]]["n"] / _tot_s),
        "slowestSupplyShare": sk_dec(100 * sup[_rel[-1][0]]["n"] / _tot_p),
        "overviewPriceTable": overview_price_table(rep, "sk"),
        "overviewPriceTableEn": overview_price_table(rep, "en"),
    }
    # The quarter is named from the report, never typed: an issue re-run for a
    # closed quarter has to rename itself everywhere it appears.
    y, q = ov["quarter_start"][:4], (int(ov["quarter_start"][5:7]) - 1) // 3 + 1
    out["quarterSk"] = f"{q}. štvrťroku {y}"        # locative: "v 3. štvrťroku"
    out["quarterSkAcc"] = f"{q}. štvrťrok {y}"       # accusative: "za 3. štvrťrok"
    out["quarterEn"] = f"Q{q} {y}"
    # 🔴 A WORD CAN BE A FIGURE IN DISGUISE. "od roku 2018" and "za osem rokov"
    # both passed the typed-number check — one is a year, the other is spelt
    # out — and both would have been silently wrong the moment the history
    # module gained a quarter. They are computed like every other figure.
    out["rollingDays"] = ov["rolling_days"]

    # 🔴 A DIRECTION IS A FIGURE. "dearer" printed over a cheaper number is the
    # mistake this series has already made once; the comparison is computed from
    # the last week of the series, with its own magnitude.
    _ps = [r for r in ov["price_series"] if r["m2_done"] and r["m2_building"]]
    if _ps:
        _d, _b = float(_ps[-1]["m2_done"]), float(_ps[-1]["m2_building"])
        _gap = (_d / _b - 1) * 100
        out["doneVsBuildingSk"] = (
            f"o {sk_dec(abs(_gap))} % {'viac' if _gap >= 0 else 'menej'}")
        out["doneVsBuildingEn"] = (
            f"{en_dec(abs(_gap))} % {'more' if _gap >= 0 else 'less'}")
    first = ov["first_published"]
    out["longRunFirstYear"] = first[:4]

    # 🔴 "ZDVOJNÁSOBILA SA" IS A FIGURE. The chart shows the whole span and the
    # prose said only "o koľko sa posunul", which is not a statement. The change
    # is computed on the REBASED first point — comparing a raw Bencont figure
    # with ours would count the denominator difference as a price move.
    _hist = ov.get("published_rebased") or {}
    _f, _l = _hist.get(first), city_m2
    if _f and _l:
        _chg = (_l / _f - 1) * 100
        out["longRunChangePct"] = sk_dec(_chg)
        out["longRunFirstM2"] = sk_int(round(_f))
    span = int(ov["quarter_start"][:4]) - int(first[:4])
    _SK_YEARS = {1: "rok", 2: "dva roky", 3: "tri roky", 4: "štyri roky",
                 5: "päť rokov", 6: "šesť rokov", 7: "sedem rokov",
                 8: "osem rokov", 9: "deväť rokov", 10: "desať rokov"}
    out["longRunSpanSk"] = _SK_YEARS.get(span, f"{span} rokov")
    out["longRunSpanEn"] = "a year" if span == 1 else f"{span} years"

    # 🔴 A QUARTER THAT HAS NOT CLOSED IS NOT A QUARTER. Published on 23
    # September, "za 3. štvrťrok" claims a week of sales that has not happened
    # yet. The phrase is computed from as_of against the quarter end, so the
    # same template re-run on 1 October says the honest thing without anyone
    # remembering to edit it.
    import datetime as _dt
    _a = _dt.date.fromisoformat(ov["as_of"])
    _qe = _dt.date.fromisoformat(ov["quarter_end"])
    _M_SK = ["januára", "februára", "marca", "apríla", "mája", "júna", "júla",
             "augusta", "septembra", "októbra", "novembra", "decembra"]
    if _a >= _qe:
        out["periodSk"] = f"za {q}. štvrťrok {y}"
        out["periodEn"] = f"in Q{q} {y}"
        out["periodClosed"] = "true"
    else:
        _qs = _dt.date.fromisoformat(ov["quarter_start"])
        out["periodSk"] = (f"od {_qs.day}. {_M_SK[_qs.month - 1]} do "
                           f"{_a.day}. {_M_SK[_a.month - 1]} {_a.year}")
        out["periodEn"] = (f"between {_qs.strftime('%-d %B')} and "
                           f"{_a.strftime('%-d %B %Y')}")
        out["periodClosed"] = "false"

    lp = ov.get("last_published", "")
    if lp:
        out["lastPublishedSk"] = f"{lp[5]}Q {lp[:4]}"
        out["lastPublishedEn"] = f"Q{lp[5]} {lp[:4]}"
    return out


def _issue_specific_vars(rep: dict) -> dict:
    """Variables that only exist for the issues whose data the report carries.

    🔴 build_vars() used to compute every variable for every article, so adding a
    block for one issue broke the render of another whose report JSON predated it
    — a KeyError inside a dict literal, on an article that does not use the
    variable at all. A missing section must not be a crash somewhere else; a
    template that actually ASKS for a missing variable still gets the explicit
    "the report does not provide it" refusal, which is the failure we want.
    """
    out: dict = {}
    if "overview" in rep:
        out.update(_overview_vars(rep))
    # Keyed on a field the block actually needs, not on the section: a report
    # generated before these figures existed still HAS a nationalQuarterly
    # section, just without them.
    if "baShareStockPct" in (rep.get("nationalQuarterly") or {}):
        nq = rep["nationalQuarterly"]
        out.update({
            # ── the national table ──────────────────────────────────────────
            "natTable": national_table(rep, "sk"),
            "natTableEn": national_table(rep, "en"),
            "natTowns": rep["nationalQuarterly"]["townCount"],
            "natStock": sk_int(rep["nationalQuarterly"]["totalStock"]),
            "natStockEn": f'{rep["nationalQuarterly"]["totalStock"]:,}'.replace(",", "\u00a0"),
            "natWithClearing": rep["nationalQuarterly"]["withClearing"],
            "natBaShare": sk_dec(rep["nationalQuarterly"]["baShareStockPct"]),
            "natBaShareEn": en_dec(rep["nationalQuarterly"]["baShareStockPct"]),
            "natBaSoldShare": sk_dec(rep["nationalQuarterly"]["baShareSoldPct"]),
            "natBaSoldShareEn": en_dec(rep["nationalQuarterly"]["baShareSoldPct"]),
            "natRestTowns": rep["nationalQuarterly"]["restTowns"],
            "natRestStock": sk_int(rep["nationalQuarterly"]["restStock"]),
            "natRestStockEn": f'{rep["nationalQuarterly"]["restStock"]:,}'.replace(",", "\u00a0"),
            "natDearest": rep["nationalQuarterly"]["dearest"]["city"],
            "natDearestM2": sk_int(rep["nationalQuarterly"]["dearest"]["meanM2"]),
            "natCheapest": rep["nationalQuarterly"]["cheapest"]["city"],
            "natCheapestM2": sk_int(rep["nationalQuarterly"]["cheapest"]["meanM2"]),
            "natPriceSpread": sk_dec(rep["nationalQuarterly"]["priceSpread"]),
            "natPriceSpreadEn": en_dec(rep["nationalQuarterly"]["priceSpread"]),
            # The correlation, stated as a number instead of hedged in prose.
            "natCorr": sk_dec(abs(rep["nationalQuarterly"]["priceVsSpeedR"]), 2),
            "natCorrEn": en_dec(abs(rep["nationalQuarterly"]["priceVsSpeedR"]), 2),
            "natYardstick": sk_int(rep["nationalQuarterly"]["yardstickPrice"]),
            "natYardstickEn": f'{rep["nationalQuarterly"]["yardstickPrice"]:,}'.replace(",", "\u00a0"),
            "natYardstickSqm": rep["nationalQuarterly"]["yardstickSqm"],
            "natBuy1": rep["nationalQuarterly"]["sameMoneyBuys"][0]["city"],
            "natBuy1Sqm": rep["nationalQuarterly"]["sameMoneyBuys"][0]["sqm"],
            "natBuy2": rep["nationalQuarterly"]["sameMoneyBuys"][1]["city"],
            "natBuy2Sqm": rep["nationalQuarterly"]["sameMoneyBuys"][1]["sqm"],
            "natBuy3": rep["nationalQuarterly"]["sameMoneyBuys"][2]["city"],
            "natBuy3Sqm": rep["nationalQuarterly"]["sameMoneyBuys"][2]["sqm"],
            # What share of the offer carries a published price — stated because the
            # price columns are computed on it and the stock column is not.
            "natPricedShare": sk_dec(round(
                100.0 * sum(t["priced"] for t in rep["nationalQuarterly"]["towns"])
                / max(rep["nationalQuarterly"]["totalStock"], 1), 1)),
            "natPricedShareEn": en_dec(round(
                100.0 * sum(t["priced"] for t in rep["nationalQuarterly"]["towns"])
                / max(rep["nationalQuarterly"]["totalStock"], 1), 1)),
            "natMinSales": rep["nationalQuarterly"]["minSalesForClearing"],
            "natFastest": rep["nationalQuarterly"]["fastest"]["city"],
            "natFastestMo": sk_dec(rep["nationalQuarterly"]["fastest"]["monthsToClear"]),
            "natFastestMoEn": en_dec(rep["nationalQuarterly"]["fastest"]["monthsToClear"]),
            "natSlowest": rep["nationalQuarterly"]["slowest"]["city"],
            "natSlowestMo": sk_dec(rep["nationalQuarterly"]["slowest"]["monthsToClear"]),
            "natSlowestMoEn": en_dec(rep["nationalQuarterly"]["slowest"]["monthsToClear"]),
            # The spread is the finding, so it is computed rather than described.
            "natSpread": sk_dec(rep["nationalQuarterly"]["slowest"]["monthsToClear"]
                                / rep["nationalQuarterly"]["fastest"]["monthsToClear"]),
            "natSpreadEn": en_dec(rep["nationalQuarterly"]["slowest"]["monthsToClear"]
                                  / rep["nationalQuarterly"]["fastest"]["monthsToClear"]),
            "natFastestM2": sk_int(rep["nationalQuarterly"]["fastest"]["meanM2"]),
            "natSlowestM2": sk_int(rep["nationalQuarterly"]["slowest"]["meanM2"]),
        })
    if "rows" in (rep.get("cityByDisposition") or {}):
        cd = rep["cityByDisposition"]
        dec = lambda v, n=1: sk_dec(v, n)
        out.update({
            "cdPriceTable": city_disposition_table(rep, "sk", "medPrice"),
            "cdPriceTableEn": city_disposition_table(rep, "en", "medPrice"),
            "cdM2Table": city_disposition_table(rep, "sk", "medM2"),
            "cdM2TableEn": city_disposition_table(rep, "en", "medM2"),
            "cdChangeTable": city_change_table(rep, "sk"),
            "cdChangeTableEn": city_change_table(rep, "en"),
            "cdTowns": cd["townCount"],
            "cdMinCell": cd["minCell"],
            "cdBa1Price": sk_int(cd["ba1RoomPrice"]),
            "cdBa1PriceEn": f'{cd["ba1RoomPrice"]:,}'.replace(",", "\u00a0"),
            "cdBa1Beats": cd["ba1RoomBeats"],
            "cdBa1OutOf": cd["ba1RoomOutOf"],
            "cdCheapest2": cd["cheapest2Room"]["city"],
            "cdCheapest2Price": sk_int(cd["cheapest2Room"]["price"]),
            "cdStepDear": cd["stepDearest"]["city"],
            "cdStepDearPct": sk_dec(cd["stepDearest"]["pct"]),
            "cdStepDearPctEn": en_dec(cd["stepDearest"]["pct"]),
            "cdStepCheap": cd["stepCheapest"]["city"],
            "cdStepCheapPct": sk_dec(cd["stepCheapest"]["pct"]),
            "cdStepCheapPctEn": en_dec(cd["stepCheapest"]["pct"]),
            "cdStepBa": sk_dec(cd["stepBratislava"]),
            "cdM2Down": len(cd["perM2FallsWithSize"]),
            "cdM2Total": len(cd["perM2FallsWithSize"]) + len(cd["perM2RisesWithSize"]),
            "cdM2Up": ", ".join(cd["perM2RisesWithSize"]),
            "cdM2UpN": len(cd["perM2RisesWithSize"]),
            "cdStepBaEn": en_dec(cd["stepBratislava"]),
        })
    if "rows" in (rep.get("baByOkres") or {}):
        out.update({
            # ── Bratislava by okres ─────────────────────────────────────────
            "okresSupplyTable": okres_supply_table(rep, "sk"),
            "okresSupplyTableEn": okres_supply_table(rep, "en"),
            "okresSalesTable": okres_sales_table(rep, "sk"),
            "okresSalesTableEn": okres_sales_table(rep, "en"),
            "okresTop": rep["baByOkres"]["rows"][0]["okres"],
            "okresTopShare": sk_dec(rep["baByOkres"]["rows"][0]["sharePct"]),
            "okresTopShareEn": en_dec(rep["baByOkres"]["rows"][0]["sharePct"]),
            "okresSecond": rep["baByOkres"]["rows"][1]["okres"],
            "okresSecondShare": sk_dec(rep["baByOkres"]["rows"][1]["sharePct"]),
            "okresSecondShareEn": en_dec(rep["baByOkres"]["rows"][1]["sharePct"]),
            "okresTwoShare": sk_dec(rep["baByOkres"]["rows"][0]["sharePct"]
                                    + rep["baByOkres"]["rows"][1]["sharePct"]),
            "okresTwoShareEn": en_dec(rep["baByOkres"]["rows"][0]["sharePct"]
                                      + rep["baByOkres"]["rows"][1]["sharePct"]),
            "okresUnmapped": sk_int(rep["baByOkres"]["unmappedStock"]),
            "okresSold": sk_int(rep["baByOkres"]["totalSold"]),
        })
    return out



def build_vars(rep: dict) -> dict:
    towns = {t["city"]: t for t in rep["nationalMap"]["towns"]}
    tot = rep["nationalMap"]["totals"]
    step = rep["priceStepByScope"]
    ba = towns["Bratislava"]

    def shift_pct(city: str) -> float:
        t = towns[city]
        return abs(t["shiftExBiggest"]) / t["medianM2"] * 100

    # Rank a town's median among the towns big enough to be on the map, before and
    # after its largest project is removed. Computed, because "the third dearest"
    # is exactly the kind of claim that is true the month it is written.
    ranked = sorted([t for t in towns.values()
                     if t["available"] >= RANK_MIN_STOCK and t["medianM2"]],
                    key=lambda t: -t["medianM2"])
    def rank_of(city: str, value: int) -> int:
        others = [t["medianM2"] for t in ranked if t["city"] != city]
        return sum(1 for v in others if v > value) + 1

    bb = towns["Banská Bystrica"]
    scope = rep["nationalMap"]["scope"]
    br = rep["bratislavaReport"]
    qt = rep["quarterly"]
    ours, pub, vp, vy = qt["ours"], qt["published"], qt["vsPrev"], qt["vsYearAgo"]

    QUARTER_SK = {1: "Prvý štvrťrok", 2: "Druhý štvrťrok",
                  3: "Tretí štvrťrok", 4: "Štvrtý štvrťrok"}
    QUARTER_EN = {1: "The first quarter", 2: "The second quarter",
                  3: "The third quarter", 4: "The fourth quarter"}

    ROOM_SK = {"1": "Jednoizbové", "2": "Dvojizbové", "3": "Trojizbové",
               "4+": "Štvor- a viacizbové"}
    ROOM_EN = {"1": "One-room", "2": "Two-room", "3": "Three-room",
               "4+": "Four-room and larger"}
    rooms = {r["disp"]: r for r in qt["byRooms"]}
    sold_rooms = {r["disp"]: r for r in qt["soldByRooms"]}
    # 🔴 THE ROOM GROUPS DO NOT SUM TO THE HEADLINE TOTALS AND MUST NOT BE SET
    # AGAINST THEM. They cover flats with a published price AND a floor area AND
    # a room count — 3 479 of the 4 305 on offer, and 455 of the 575 sales
    # measured. The draft wrote "1 456 z 4 305" and "735 sold" over groups adding
    # to 455; a reader with a calculator finds the gap before we do. So the prose
    # uses SHARES of the classified set, which cannot be subtracted into nonsense,
    # and the table caption states the base.
    rooms_total = sum(r["n"] for r in qt["byRooms"])
    sold_total = sum(r["n"] for r in qt["soldByRooms"])

    def rooms_table(lang: str) -> str:
        names = ROOM_SK if lang == "sk" else ROOM_EN
        # Short headers on purpose: the table sits in the article column and the
        # cells never wrap, so six long ones pushed the last two off the edge
        # behind a horizontal scroll. What each column means is in the caption.
        head = (("| Dispozícia | V ponuke | €/m² s DPH | Cena bytu | Výmera | Predaných |"
                 "\n|---|---:|---:|---:|---:|---:|") if lang == "sk" else
                ("| Disposition | On offer | €/m² | Flat price | Area | Sold |"
                 "\n|---|---:|---:|---:|---:|---:|"))
        rows = []
        for key in ("1", "2", "3", "4+"):
            r, sd = rooms[key], sold_rooms.get(key, {})
            area = (f"{sk_dec(r['meanArea'])} m²" if lang == "sk"
                    else f"{en_dec(r['meanArea'])} m²")
            rows.append(f"| {names[key]} | {sk_int(r['n'])} | {sk_int(r['meanM2'])} € | "
                        f"{sk_int(r['meanPrice'])} € | {area} | "
                        f"{sk_int(sd.get('n', 0))} |")
        return head + "\n" + "\n".join(rows)

    def series_table(lang: str) -> str:
        head = (("| Štvrťrok | Ponuka | Predaj | Priemerná cena €/m² s DPH |"
                 "\n|---|---:|---:|---:|") if lang == "sk" else
                ("| Quarter | Supply | Sales | Average €/m² incl. VAT |"
                 "\n|---|---:|---:|---:|"))
        rows = []
        for r in pub["quarters"]:
            rows.append(f"| {r['q']} | {sk_int(r['supply'])} | "
                        f"{sk_int(r['sales'])} | {sk_int(r['meanM2Rebased'])} |")
        # Our row says what it is: a quarter-to-date while the quarter is open.
        label = ours["q"] if ours["complete"] else (
            f"{ours['q']}*" )
        sales = sk_int(ours["sales"]) if ours["complete"] else (
            f"{sk_int(ours['sales'])}*")
        # The same fortnight figure the prose uses, not the last scrape day —
        # otherwise the table and the paragraph beside it print two supplies.
        rows.append(f"| **{label}** | **{sk_int(ours['supply'])}** | "
                    f"**{sales}** | **{sk_int(ours['meanM2'])}** |")
        return head + "\n" + "\n".join(rows)
    p1, p2 = br["sales"]["p1"], br["sales"]["p2"]

    # Every town the prose names, keyed by its own initials, so a town that
    # leaves the map fails the render instead of quietly printing a placeholder.
    NAMED = {
        "ba": "Bratislava", "nr": "Nitra", "tt": "Trnava", "ke": "Košice",
        "po": "Prešov", "pp": "Poprad", "tn": "Trenčín", "za": "Žilina",
        "bb": "Banská Bystrica", "mt": "Martin", "lc": "Lučenec", "ps": "Piešťany",
    }
    # 🔴 ORDINALS ARE COMPUTED, NEVER COUNTED BY HAND. The first draft called
    # Piešťany "the third cheapest metre" by reading a sorted list on screen; it
    # is the fifth. An ordinal is a figure like any other and decays the same way.
    table_set = [t for t in towns.values()
                 if t["available"] >= TABLE_MIN_STOCK and t["medianPrice"]]
    KRAJ = ["Bratislava", "Trnava", "Trenčín", "Nitra", "Žilina",
            "Banská Bystrica", "Prešov", "Košice"]

    def _ord(city: str, field: str, pool: list, reverse: bool) -> int:
        vals = sorted((t[field] for t in pool), reverse=reverse)
        return vals.index(towns[city][field]) + 1

    v: dict = {}
    for key, name in NAMED.items():
        t = towns[name]
        v[f"{key}Available"] = sk_int(t["available"])
        v[f"{key}M2"] = sk_int(t["medianM2"])
        v[f"{key}Price"] = sk_int(t["medianPrice"])
        v[f"{key}Area"] = sk_dec(t["medianArea"])
        v[f"{key}AreaEn"] = en_dec(t["medianArea"])
    v |= {
        "asOf": sk_date(rep["asOf"]),
        "rankThreshold": RANK_MIN_STOCK,
        "restMedian": sk_int(scope["rest"]["medianM2"]),
        "restPrice": sk_int(scope["rest"]["medianPrice"]),
        "restArea": sk_dec(scope["rest"]["medianArea"]),
        "restAreaEn": en_dec(scope["rest"]["medianArea"]),
        "baScopeArea": sk_dec(scope["bratislava"]["medianArea"]),
        "baScopeAreaEn": en_dec(scope["bratislava"]["medianArea"]),
        "baScopePrice": sk_int(scope["bratislava"]["medianPrice"]),
        "restBelowBaPct": sk_dec(
            100 * (1 - scope["rest"]["medianM2"] / scope["bratislava"]["medianM2"]), 0),
        "restBelowBaPctEn": en_dec(
            100 * (1 - scope["rest"]["medianM2"] / scope["bratislava"]["medianM2"]), 0),
        # The sum of the two scopes, never mixSk.totalSold — that one filters to
        # 1-5 rooms and printed 1 315 above a 762 + 586 that makes 1 348.
        "soldTotal": sk_int(rep["monthsToClear"]["byScope"]["bratislava"]["sold"]
                            + rep["monthsToClear"]["byScope"]["rest"]["sold"]),
        "baSold": sk_int(rep["monthsToClear"]["byScope"]["bratislava"]["sold"]),
        "restSold": sk_int(rep["monthsToClear"]["byScope"]["rest"]["sold"]),
        "baScopeMedian": sk_int(scope["bratislava"]["medianM2"]),
        "towns": tot["towns"],
        "oneProject": tot["oneProjectTowns"],
        "twoOrFewer": tot["twoOrFewerTowns"],
        "fiveOrMore": tot["fiveOrMoreTowns"],
        "noOfferWithoutBiggest": tot["noOfferWithoutBiggest"],
        "totalAvailable": sk_int(tot["available"]),
        "totalProjects": tot["projects"],
        "mapMinStock": MAP_MIN_STOCK,
        "restAvailable": sk_int(tot["available"] - ba["available"]),
        "restTowns": tot["towns"] - 1,
        "baAvailable": sk_int(ba["available"]),
        "baProjects": ba["projects"],
        "baBiggestPct": sk_dec(ba["biggestPct"], 0),
        "baSharePct": sk_dec(100 * ba["available"] / tot["available"], 0),
        "baMedian": sk_int(ba["medianM2"]),
        "baShift": sk_int(abs(ba["shiftExBiggest"])),
        "baShiftPct": sk_dec(shift_pct("Bratislava")),
        "bbBiggestPct": sk_dec(bb["biggestPct"], 0),
        "bbProjects": bb["projects"],
        "bbMedianEx": sk_int(bb["medianM2ExBiggest"]),
        "bbShift": sk_int(abs(bb["shiftExBiggest"])),
        "bbShiftPct": sk_dec(shift_pct("Banská Bystrica")),
        "bbRank": rank_of("Banská Bystrica", bb["medianM2"]),
        "bbRankEx": rank_of("Banská Bystrica", bb["medianM2ExBiggest"]),
        "bbRankedOf": len(ranked),
        "tnShiftPct": sk_dec(shift_pct("Trenčín")),
        "tnBiggestPct": sk_dec(towns["Trenčín"]["biggestPct"], 0),
        "tnProjects": towns["Trenčín"]["projects"],
        "zaShiftPct": sk_dec(shift_pct("Žilina")),
        "keShiftPct": sk_dec(shift_pct("Košice")),
        "keProjects": towns["Košice"]["projects"],
        "poBiggestPct": sk_dec(towns["Prešov"]["biggestPct"], 0),
        "poProjects": towns["Prešov"]["projects"],
        "stepDays": step["days"],
        "baMoves": sk_int(step["bratislava"]["moves"]),
        "baMoveProjects": step["bratislava"]["projects"],
        "baUp": sk_dec(step["bratislava"]["pctUp"]),
        "baStep": sk_dec(step["bratislava"]["medianPct"]),
        "restMoves": sk_int(step["rest"]["moves"]),
        "restMoveProjects": step["rest"]["projects"],
        "restUp": sk_dec(step["rest"]["pctUp"]),
        "restStep": sk_dec(step["rest"]["medianPct"]),
        "stepRatio": sk_dec(step["rest"]["medianPct"] / step["bratislava"]["medianPct"]),
        "windowFrom": sk_date(rep["window"]["sk"]["from"]),
        "windowDays": rep["window"]["sk"]["days"],
        "activeProjects": rep["coverage"]["skActiveProjects"],
        "covIndexProjects": sk_int(rep["externalCoverageCheck"]["indexProjects"]),
        "covSoldOut": rep["externalCoverageCheck"]["indexSoldOut"],
        "covMissingProjects": rep["externalCoverageCheck"]["sellingProjectsNotTracked"],
        "covMissingUnits": rep["externalCoverageCheck"]["freeUnitsNotTracked"],
        "covMissingPct": sk_dec(
            100 * rep["externalCoverageCheck"]["freeUnitsNotTracked"] / tot["available"]),
        "baOtherProjects": ba["projects"] - 1,
        "benchSource": rep["benchmark"]["source"],
        "benchPeriod": rep["benchmark"]["period"],
        "benchSupply": sk_int(rep["benchmark"]["supply"]),
        "benchMeanPrice": sk_int(rep["benchmark"]["meanPrice"]),
        "benchQuarterSales": sk_int(rep["benchmark"]["quarterSales"]),
        "ourSupplyComparable": sk_int(rep["reconciliation"]["ourSupplyComparable"]),
        "ourMeanPrice": sk_int(rep["reconciliation"]["ourMeanPrice"]),
        "supplyDeltaPct": sk_dec(abs(rep["reconciliation"]["supplyDeltaPct"])),
        "meanPriceDeltaPct": sk_dec(abs(rep["reconciliation"]["meanPriceDeltaPct"])),
        "tableMinStock": TABLE_MIN_STOCK,
        "chartMinStock": TABLE_MIN_STOCK,
        "baMonths": rep["monthsToClear"]["byScope"]["bratislava"]["monthsDisplay"],
        "restMonths": rep["monthsToClear"]["byScope"]["rest"]["monthsDisplay"],
        # What Bencont's own published pair implies for Bratislava, computed from
        # their two numbers rather than transcribed from an arithmetic we did once.
        "benchMonths": sk_dec(
            rep["benchmark"]["supply"] / (rep["benchmark"]["quarterSales"] / 3), 0),
        "moves90": sk_int(rep["priceMoves90d"]["moves"]),
        "moveProjects": rep["priceMoves90d"]["projects"],
        "movesUpPct": sk_dec(rep["priceMoves90d"]["pctUp"]),
        "moveMedianPct": sk_dec(rep["priceMoves90d"]["medianPct"]),
        # Where each named town sits, worked out rather than eyeballed.
        "psM2RankAsc": _ord("Piešťany", "medianM2", table_set, False),
        "bbM2RankDesc": _ord("Banská Bystrica", "medianM2", table_set, True),
        "bbKrajRankAsc": _ord("Banská Bystrica", "medianPrice",
                              [towns[c] for c in KRAJ], False),
        "tableTowns": len(table_set),
        "biggestAreaTown": max(table_set, key=lambda t: t["medianArea"])["city"],
        "cheapestM2Town": min(table_set, key=lambda t: t["medianM2"])["city"],
        # ── the quarterly, on Bencont's own metrics ─────────────────────────
        "qSupply": sk_int(br["supply"]),
        "qProjects": br["projects"],
        "qMeanM2": sk_int(br["meanM2"]),
        "qMeanPrice": sk_int(br["meanPrice"]),
        "qMeanArea": sk_dec(br["meanArea"]),
        "qMeanAreaEn": en_dec(br["meanArea"]),
        "qPanelDays": br["panelDays"],
        "qPanelProjects": br["panelProjects"],
        "qPanelSupplyThen": sk_int(br["panelSupplyThen"]),
        "qPanelSupplyNow": sk_int(br["panelSupplyNow"]),
        "qPanelSupplyChange": sk_int(abs(br["panelSupplyChange"])),
        "qPanelSupplyChangePct": sk_dec(abs(br["panelSupplyChangePct"])),
        "qPanelSupplyChangePctEn": en_dec(abs(br["panelSupplyChangePct"])),
        "qPanelM2Then": sk_int(br["panelM2Then"]),
        "qPanelM2Now": sk_int(br["panelM2Now"]),
        "qPanelM2ChangePct": sk_dec(abs(br["panelM2ChangePct"])),
        "qPanelM2ChangePctEn": en_dec(abs(br["panelM2ChangePct"])),
        "qDays": p2["days"],
        "qSalesNow": sk_int(p2["n"]),
        "qSalesThen": sk_int(p1["n"]),
        "qSalesChangePct": sk_dec(abs(br["salesChangePct"])),
        "qSalesChangePctEn": en_dec(abs(br["salesChangePct"])),
        "qSoldM2": sk_int(p2["meanM2"]),
        "qSoldPrice": sk_int(p2["meanPrice"]),
        "qSoldArea": sk_dec(p2["meanArea"]),
        "qSoldAreaEn": en_dec(p2["meanArea"]),
        "qThenDate": sk_date(br["thenDate"]),
        "qThenDateEn": en_date(br["thenDate"]),
        "qTopSeller": br["topSeller"]["name"],
        "qTopSellerN": sk_int(br["topSeller"]["n"]),
        "qD1Sold": sk_int(br["districts"][0]["sold"]),
        "qD1Share": sk_dec(br["districts"][0]["sharePct"]),
        "qD1ShareEn": en_dec(br["districts"][0]["sharePct"]),
        "qD1M2": sk_int(br["districts"][0]["meanM2"]),
        "qD2Sold": sk_int(br["districts"][1]["sold"]) if len(br["districts"]) > 1 else "",
        "qD2Share": sk_dec(br["districts"][1]["sharePct"]) if len(br["districts"]) > 1 else "",
        "qD2ShareEn": en_dec(br["districts"][1]["sharePct"]) if len(br["districts"]) > 1 else "",
        "qD2M2": sk_int(br["districts"][1]["meanM2"]) if len(br["districts"]) > 1 else "",
        "qCityM2": sk_int(br["districts"][0]["cityM2"]),
        "qD1": br["districts"][0]["district"],
        "qD1Loc": locative(br["districts"][0]["district"]),
        "qD2Loc": (locative(br["districts"][1]["district"])
                   if len(br["districts"]) > 1 else ""),
        "qD2": br["districts"][1]["district"] if len(br["districts"]) > 1 else "",
        # the decomposition — the two parts always sum to the observed move
        "pdKeptPct": sk_dec(abs(br["priceDecomposition"]["keptPct"]), 2),
        "pdKeptPctEn": en_dec(abs(br["priceDecomposition"]["keptPct"]), 2),
        "pdRepricePct": sk_dec(abs(br["priceDecomposition"]["repricingPct"]), 2),
        "pdRepricePctEn": en_dec(abs(br["priceDecomposition"]["repricingPct"]), 2),
        "pdMixPct": sk_dec(abs(br["priceDecomposition"]["mixPct"]), 2),
        "pdMixPctEn": en_dec(abs(br["priceDecomposition"]["mixPct"]), 2),
        "pdTotalPct": sk_dec(abs(br["priceDecomposition"]["totalPct"]), 2),
        "pdTotalPctEn": en_dec(abs(br["priceDecomposition"]["totalPct"]), 2),
        "pdKeptUnits": sk_int(br["priceDecomposition"]["keptUnits"]),
        # Share of the SAME base the sentence names, so the reader can divide the
        # two printed numbers and land on the printed percentage.
        "rpShareOfPanel": sk_dec(round(
            100.0 * br["repricing"]["units"] / br["priceDecomposition"]["keptUnits"], 1)),
        "rpShareOfPanelEn": en_dec(round(
            100.0 * br["repricing"]["units"] / br["priceDecomposition"]["keptUnits"], 1)),
        "pdKeptUnitsEn": f'{br["priceDecomposition"]["keptUnits"]:,}'.replace(",", "\u00a0"),
        "pdArrivedM2": sk_int(br["priceDecomposition"]["arrivedM2"]),
        "pdLeftM2": sk_int(br["priceDecomposition"]["leftM2"]),
        "pdThen": sk_int(br["priceDecomposition"]["meanThen"]),
        "pdNow": sk_int(br["priceDecomposition"]["meanNow"]),
        "rpChanges": sk_int(br["repricing"]["changes"]),
        "rpUnits": sk_int(br["repricing"]["units"]),
        "rpProjects": br["repricing"]["projects"],
        "rpTracked": sk_int(br["repricing"]["unitsTracked"]),
        "rpShare": sk_dec(br["repricing"]["pctOfOfferMoved"]),
        "rpShareEn": en_dec(br["repricing"]["pctOfOfferMoved"]),
        "rpUp": sk_dec(br["repricing"]["pctUp"]),
        "rpUpEn": en_dec(br["repricing"]["pctUp"]),
        "rpStep": sk_dec(br["repricing"]["medianStep"]),
        "rpStepEn": en_dec(br["repricing"]["medianStep"]),
        "rpEffect": sk_dec(br["repricing"]["effectOnAverage"], 2),
        "rpEffectEn": en_dec(br["repricing"]["effectOnAverage"], 2),
        "newBelowPct": sk_dec(
            100 * (1 - br["newSupply"]["meanM2"] / br["meanM2"]), 1),
        "newBelowPctEn": en_dec(
            100 * (1 - br["newSupply"]["meanM2"] / br["meanM2"]), 1),
        "qNewUnits": sk_int(br["newSupply"]["units"]),
        "qNewMeanM2": sk_int(br["newSupply"]["meanM2"]),
        # ── the quarterly series ────────────────────────────────────────────
        "cq": ours["q"],
        "cqName": QUARTER_SK[int(ours["q"][1])],
        "cqNameEn": QUARTER_EN[int(ours["q"][1])],
        "cqYear": ours["q"].split()[1],
        # The run of quarters the quote calls "around N a quarter" — averaged, not
        # eyeballed, and it moves with the series.
        # The last four quarters INCLUDING ours. Averaging only the earlier ones
        # printed "sales hold at around 666" two lines under "sales reached 735".
        "avgQuarterSales": sk_int(
            (sum(r["sales"] for r in pub["quarters"][-3:]) + ours["sales"]) / 4),
        # The fortnight figure: market_report now pins ours["supply"] to it and keeps
        # the raw closing day as supplyLastDay. On 21 September that
        # day read 4 305 against 3 920-4 013 on every other day of the preceding
        # three weeks, because Nesto, Olivia Residence and Palais Esterházy all
        # failed to scrape on the 20th and returned on the 21st. The level is the
        # fortnight mean, like every other level in this issue.
        "cqSupply": sk_int(ours["supply"]),
        "cqSupplyEn": f'{ours["supply"]:,}'.replace(",", "\u00a0"),
        "cqProjects": ours["projects"],
        # The only supply CHANGE we can measure: the projects on sale at both ends.
        "spThen": sk_int(br["supplyPanel"]["supplyThen"]),
        "spNow": sk_int(br["supplyPanel"]["supplyNow"]),
        "spThenEn": f'{br["supplyPanel"]["supplyThen"]:,}'.replace(",", "\u00a0"),
        "spNowEn": f'{br["supplyPanel"]["supplyNow"]:,}'.replace(",", "\u00a0"),
        "spPct": sk_dec(abs(br["supplyPanel"]["changePct"])),
        "spPctEn": en_dec(abs(br["supplyPanel"]["changePct"])),
        "spProjects": br["supplyPanel"]["panelProjects"],
        "spDir": "znížil" if br["supplyPanel"]["changePct"] < 0 else "zvýšil",
        "spDirEn": "fell" if br["supplyPanel"]["changePct"] < 0 else "rose",
        "cqM2": sk_int(ours["meanM2"]), "cqPrice": sk_int(ours["meanPrice"]),
        "cqArea": sk_dec(ours["meanArea"]), "cqAreaEn": en_dec(ours["meanArea"]),
        "cqSales": sk_int(ours["sales"]), "cqRunRate": sk_int(ours["salesRunRate"]),
        # What was actually observed before the quarter was closed on the pace.
        "cqSalesObserved": sk_int(ours.get("preliminary", {}).get("salesObserved", ours["sales"])),
        "cqDaysObs": ours["daysObserved"], "cqDaysTot": ours["daysTotal"],
        "cqSoldM2": sk_int(ours["soldM2"]), "cqSoldPrice": sk_int(ours["soldPrice"]),
        "cqSoldArea": sk_dec(ours["soldArea"]), "cqSoldAreaEn": en_dec(ours["soldArea"]),
        # 🔴 DIRECTION IS NOT OPTIONAL. The template printed "nárast len o {pct}"
        # over an absolute value, so the day the price fell the article said it
        # rose. Aligning the price population to the supply definition did exactly
        # that: +0,1 % became −0,3 %.
        "yqM2Dir": "nárast" if vy["m2Pct"] > 0 else "pokles",
        "yqM2DirEn": "an increase" if vy["m2Pct"] > 0 else "a decrease",
        "pqM2Dir": "vzrástla" if vp["m2Pct"] > 0 else "klesla",
        "pdDir": "znížila" if br["priceDecomposition"]["totalPct"] < 0 else "zvýšila",
        "pdDirEn": "fell" if br["priceDecomposition"]["totalPct"] < 0 else "rose",
        # Which of the two forces won, computed rather than assumed.
        "pdWinner": ("zmena zloženia ponuky"
                     if abs(br["priceDecomposition"]["mixPct"])
                        > abs(br["priceDecomposition"]["repricingPct"])
                     else "prehodnotenie cenníkov"),
        "pdWinnerEn": ("the change in composition"
                       if abs(br["priceDecomposition"]["mixPct"])
                          > abs(br["priceDecomposition"]["repricingPct"])
                       else "the repricing"),
        "pqLabel": vp["q"], "yqLabel": vy["q"],
        # "Q2 2026" is a table label. In Slovak prose it reads as machine output,
        # so the paragraphs get the ordinal the market actually says out loud.
        # "oproti" takes the dative: oproti druhému štvrťroku.
        "pqName": {1: "prvému", 2: "druhému", 3: "tretiemu",
                   4: "štvrtému"}[int(vp["q"][1])] + " štvrťroku",
        "pqNameNom": {1: "prvého", 2: "druhého", 3: "tretieho",
                      4: "štvrtého"}[int(vp["q"][1])] + " štvrťroka",
        "seriesSpan": f"{pub['quarters'][0]['q']} – {ours['q']}",
        "pqSupply": sk_int(abs(vp["supply"])), "pqSupplyPct": sk_dec(abs(vp["supplyPct"])),
        "pqSupplyPctEn": en_dec(abs(vp["supplyPct"])),
        "pqM2Pct": sk_dec(abs(vp["m2Pct"])), "pqM2PctEn": en_dec(abs(vp["m2Pct"])),
        "pqSalesPct": sk_dec(abs(vp["salesPct"])), "pqSalesPctEn": en_dec(abs(vp["salesPct"])),
        "yqSupply": sk_int(abs(vy["supply"])), "yqSupplyPct": sk_dec(abs(vy["supplyPct"])),
        "yqSupplyPctEn": en_dec(abs(vy["supplyPct"])),
        "yqM2Pct": sk_dec(abs(vy["m2Pct"])), "yqM2PctEn": en_dec(abs(vy["m2Pct"])),
        "yqSalesPct": sk_dec(abs(vy["salesPct"])), "yqSalesPctEn": en_dec(abs(vy["salesPct"])),
        "pqSales": sk_int(pub["quarters"][-1]["sales"]),
        "yqSales": sk_int(pub["quarters"][-4]["sales"]),
        "pqM2": sk_int(pub["quarters"][-1]["meanM2Rebased"]),
        "yqM2": sk_int(pub["quarters"][-4]["meanM2Rebased"]),
        "srcName": pub["source"],
        "rebaseFactor": sk_dec(qt["rebase"]["factor"], 4),
        "rebaseAnchorDate": sk_date(qt["rebase"]["anchorDate"]),
        "rebaseAnchorDateEn": en_date(qt["rebase"]["anchorDate"]),
        "rebaseOurs": sk_int(qt["rebase"]["anchorOurs"]),
        "rebaseTheirs": sk_int(qt["rebase"]["anchorTheirs"]),
        "roomsTable": rooms_table("sk"),
        "roomsTableEn": rooms_table("en"),
        "panelProjects": qt["panelProjects"],
        "panelFrom": genitive_month_sk(qt["monthlyPanel"][0]["month"]),
        "panelSpan": months_sk(len(qt["monthlyPanel"])),
        "panelM2Dir": direction_sk(qt["panelM2Pct"], "stúpla", "klesla"),
        "panelSupplyDir": direction_sk(qt["panelSupplyPct"], "vzrástla", "klesla"),
        "panelM2DirEn": "rose" if qt["panelM2Pct"] > 0 else "fell",
        "panelSupplyDirEn": "rose" if qt["panelSupplyPct"] > 0 else "fell",
        "dearestM2RoomCap": ROOM_SK[max(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]],
        "panelFromEn": en_month(qt["monthlyPanel"][0]["month"]),
        "panelSupplyFrom": sk_int(qt["panelSupplyFrom"]),
        "panelSupplyTo": sk_int(qt["panelSupplyTo"]),
        "panelSupplyPct": sk_dec(abs(qt["panelSupplyPct"])),
        "panelSupplyPctEn": en_dec(abs(qt["panelSupplyPct"])),
        "panelM2From": sk_int(qt["panelM2From"]),
        "panelM2To": sk_int(qt["panelM2To"]),
        "panelM2Pct": sk_dec(abs(qt["panelM2Pct"])),
        "panelM2PctEn": en_dec(abs(qt["panelM2Pct"])),
        "panelMonthlySales": sk_int(qt["panelMonthlySales"]),
        "panelMonths": len(qt["monthlyPanel"]),
        # 🔴 EVERY DIRECTION AND EVERY SHAPE BELOW IS COMPUTED. Each one of these
        # was a word typed by hand beside a number that could contradict it, and
        # one of them ("necelá desatina") was already false in the published text.
        # A fraction-word is a typed number wearing a coat.
        "qTopSellerShare": sk_dec(br["topSeller"]["sharePct"]),
        "qTopSellerShareEn": en_dec(br["topSeller"]["sharePct"]),
        # C1 — "zdraženie" printed over a fall, because the value was abs()
        "pdKeptDir": ("zdraženie" if br["priceDecomposition"]["keptPct"] >= 0
                      else "zlacnenie"),
        "pdKeptDirEn": ("increase" if br["priceDecomposition"]["keptPct"] >= 0
                        else "decrease"),
        # C2 — "dvíha"/"tlačí nadol" survived having their signs swapped
        "pdRepriceVerb": ("dvíha" if br["priceDecomposition"]["repricingPct"] >= 0
                          else "znižuje"),
        "pdRepriceVerbEn": ("lifts" if br["priceDecomposition"]["repricingPct"] >= 0
                            else "lowers"),
        "pdMixWay": "nadol" if br["priceDecomposition"]["mixPct"] < 0 else "nahor",
        "pdMixWayEn": "down" if br["priceDecomposition"]["mixPct"] < 0 else "up",
        # C3 — the clause explaining the panel move asserted one direction
        "spWhySk": ("z rozbehnutých projektov odišlo viac bytov, než koľko ich do "
                    "nich pribudlo" if br["supplyPanel"]["changePct"] < 0 else
                    "do rozbehnutých projektov pribudlo viac bytov, než koľko ich "
                    "z nich odišlo"),
        "spWhyEn": ("more flats left those projects than were added to them"
                    if br["supplyPanel"]["changePct"] < 0 else
                    "more flats were added to those projects than left them"),
        "spThinSk": "tenčí" if br["supplyPanel"]["changePct"] < 0 else "rozširuje",
        "spThinEn": "thinning" if br["supplyPanel"]["changePct"] < 0 else "growing",
        # C5 — "nezmenená" / "stagnácia" held over a 9 % move in testing
        "yqStableSk": ("ostala prakticky nezmenená" if abs(qt["vsYearAgo"]["m2Pct"]) < 1.5
                       else "sa posunula"),
        "yqStableEn": ("was practically unchanged" if abs(qt["vsYearAgo"]["m2Pct"]) < 1.5
                       else "moved"),
        "seriesShapeSk": _series_shape(qt, "sk"),
        "seriesShapeEn": _series_shape(qt, "en"),
        # B1 — the U-shape was re-asserted by hand one sentence after being computed.
        # Live margins are 0,9 % and 1,2 %; either selection flips on a normal month.
        "uShapeSk": _u_shape(qt, "sk"),
        "uShapeEn": _u_shape(qt, "en"),
        # the U-shape, computed
        "dearestM2Room": ROOM_SK[max(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]].lower(),
        "cheapestM2Room": ROOM_SK[min(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]].lower(),
        # 🔴 The VALUE must come from the same computation as the LABEL. The
        # template paired a computed "cheapest disposition" with a hardcoded
        # three-room price, so the day the two-room became the cheapest the
        # article printed the three-room figure under the two-room name.
        "dearestM2Value": sk_int(max(qt["byRooms"], key=lambda r: r["meanM2"])["meanM2"]),
        "cheapestM2Value": sk_int(min(qt["byRooms"], key=lambda r: r["meanM2"])["meanM2"]),
        "dearestM2RoomEn": ROOM_EN[max(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]].lower(),
        "cheapestM2RoomEn": ROOM_EN[min(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]].lower(),
        "dearestM2ValueEn": f'{max(qt["byRooms"], key=lambda r: r["meanM2"])["meanM2"]:,}'.replace(",", "\u00a0"),
        "cheapestM2ValueEn": f'{min(qt["byRooms"], key=lambda r: r["meanM2"])["meanM2"]:,}'.replace(",", "\u00a0"),
        "roomSpreadPct": sk_dec(
            100 * (max(r["meanM2"] for r in qt["byRooms"])
                   / min(r["meanM2"] for r in qt["byRooms"]) - 1)),
        "roomSpreadPctEn": en_dec(
            100 * (max(r["meanM2"] for r in qt["byRooms"])
                   / min(r["meanM2"] for r in qt["byRooms"]) - 1)),
        "r1M2": sk_int(rooms["1"]["meanM2"]), "r1Price": sk_int(rooms["1"]["meanPrice"]),
        "r1Area": sk_dec(rooms["1"]["meanArea"]), "r1AreaEn": en_dec(rooms["1"]["meanArea"]),
        "roomsTotal": sk_int(rooms_total), "soldTotalRooms": sk_int(sold_total),
        "r1N": sk_int(rooms["1"]["n"]), "r1Sold": sk_int(sold_rooms["1"]["n"]),
        "r1Share": sk_dec(100 * rooms["1"]["n"] / rooms_total),
        "r2Share": sk_dec(100 * rooms["2"]["n"] / rooms_total),
        "r3Share": sk_dec(100 * rooms["3"]["n"] / rooms_total),
        "r4Share": sk_dec(100 * rooms["4+"]["n"] / rooms_total),
        "r1ShareEn": en_dec(100 * rooms["1"]["n"] / rooms_total),
        "r2ShareEn": en_dec(100 * rooms["2"]["n"] / rooms_total),
        "r3ShareEn": en_dec(100 * rooms["3"]["n"] / rooms_total),
        "r4ShareEn": en_dec(100 * rooms["4+"]["n"] / rooms_total),
        "r1SoldShare": sk_dec(100 * sold_rooms["1"]["n"] / sold_total),
        "r2SoldShare": sk_dec(100 * sold_rooms["2"]["n"] / sold_total),
        "r3SoldShare": sk_dec(100 * sold_rooms["3"]["n"] / sold_total),
        "r4SoldShare": sk_dec(100 * sold_rooms["4+"]["n"] / sold_total),
        "r1SoldShareEn": en_dec(100 * sold_rooms["1"]["n"] / sold_total),
        "r2SoldShareEn": en_dec(100 * sold_rooms["2"]["n"] / sold_total),
        "r3SoldShareEn": en_dec(100 * sold_rooms["3"]["n"] / sold_total),
        "r4SoldShareEn": en_dec(100 * sold_rooms["4+"]["n"] / sold_total),
        "r2M2": sk_int(rooms["2"]["meanM2"]), "r2Price": sk_int(rooms["2"]["meanPrice"]),
        "r2Area": sk_dec(rooms["2"]["meanArea"]), "r2AreaEn": en_dec(rooms["2"]["meanArea"]),
        "r2N": sk_int(rooms["2"]["n"]), "r2Sold": sk_int(sold_rooms["2"]["n"]),
        "r3M2": sk_int(rooms["3"]["meanM2"]), "r3Price": sk_int(rooms["3"]["meanPrice"]),
        "r3Area": sk_dec(rooms["3"]["meanArea"]), "r3AreaEn": en_dec(rooms["3"]["meanArea"]),
        "r3N": sk_int(rooms["3"]["n"]), "r3Sold": sk_int(sold_rooms["3"]["n"]),
        "r4M2": sk_int(rooms["4+"]["meanM2"]), "r4Price": sk_int(rooms["4+"]["meanPrice"]),
        "r4Area": sk_dec(rooms["4+"]["meanArea"]), "r4AreaEn": en_dec(rooms["4+"]["meanArea"]),
        "r4N": sk_int(rooms["4+"]["n"]), "r4Sold": sk_int(sold_rooms["4+"]["n"]),
        "seriesTable": series_table("sk"),
        "seriesTableEn": series_table("en"),
        "townTable": town_table(rep, "sk"),
        "townTableEn": town_table(rep, "en"),
        "asOfEn": en_date(rep["asOf"]),
        "baSharePctEn": en_dec(100 * ba["available"] / tot["available"], 0),
        "movesUpPctEn": en_dec(rep["priceMoves90d"]["pctUp"]),
        "moveMedianPctEn": en_dec(rep["priceMoves90d"]["medianPct"]),
        "windowFromEn": en_date(rep["window"]["sk"]["from"]),
        "covMissingPctEn": en_dec(
            100 * rep["externalCoverageCheck"]["freeUnitsNotTracked"] / tot["available"]),
        "supplyDeltaPctEn": en_dec(abs(rep["reconciliation"]["supplyDeltaPct"])),
        "meanPriceDeltaPctEn": en_dec(abs(rep["reconciliation"]["meanPriceDeltaPct"])),
        "slug": rep["slug"],
    }
    v.update(_issue_specific_vars(rep))
    return v


#: A town is in the printed table from this many available homes. Below it the
#: row is a handful of flats and a reader cannot do anything with it.
TABLE_MIN_STOCK = 40


def town_table(rep: dict, lang: str = "sk") -> str:
    """The map itself. Every town with a new-build on offer, so a reader can find
    their own and a journalist can lift one row. Sorted by stock, because that is
    the order in which the towns matter to the market rather than alphabetically."""
    head = (("| Mesto | Voľné byty | Medián ceny bytu | Medián €/m² s DPH | "
             "Medián výmery | Mesiace do vypredania |") if lang == "sk" else
            ("| Town | Available | Median flat price | Median €/m² incl. VAT | "
             "Median floor area | Months to clear |"))
    head += "\n|---|---:|---:|---:|---:|---:|"
    # Months to clear exists only for towns with enough observed sales for the
    # denominator to mean anything; the rest of the column is honestly empty.
    months = {r["city"]: r["monthsDisplay"]
              for r in rep.get("monthsToClear", {}).get("byCity", [])}
    rows = []
    for t in rep["nationalMap"]["towns"]:
        if t["available"] < TABLE_MIN_STOCK or not t["medianPrice"]:
            continue
        area = (f"{sk_dec(t['medianArea'], 0)} m²" if lang == "sk"
                else f"{en_dec(t['medianArea'], 0)} m²")
        mo = months.get(t["city"])
        rows.append(f"| {t['city']} | {sk_int(t['available'])} | "
                    f"{sk_int(t['medianPrice'])} € | {sk_int(t['medianM2'])} € | "
                    f"{area} | {mo if mo else '—'} |")
    return head + "\n" + "\n".join(rows)


# 🔴 ANY digit a human typed, not just long ones. The old pattern needed three
# characters, so `97 projektov`, `30 %` and `9 projektov` all sailed through — and
# this issue carries FOUR two-digit figures (97 projects, 75 panel projects, 63
# flats, 28 projects), every one retypeable without a sound. Its character class
# also held a NON-BREAKING space and not an ordinary one, so whether a figure was
# caught depended on which space key the writer happened to hit.
BARE_NUMBER = re.compile(r"(?<![\w{/.\-])\d[\d  .,]*(?![\w}])")
# A year is prose, not a figure — matched by SHAPE so it cannot expire. The old
# allowlist was the three literals 2024/2025/2026 and would refuse "2027".
LOOKS_LIKE_A_YEAR = re.compile(r"^(?:19|20)\d\d$")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    slug = sys.argv[1]
    rep = json.loads((DATA / f"report-{slug}.json").read_text(encoding="utf-8"))
    vars_ = build_vars(rep)

    # 🔴 CHECK BOTH, FORMAT BOTH, THEN WRITE BOTH. The refusal used to sit inside
    # the loop, after Slovak had already been written — so a fault in the English
    # template left a FRESH Slovak file beside a STALE English one, and to_cms.py
    # pairs them by block count and type without ever comparing a figure.
    rendered = {}
    for lang in ("sk", "en"):
        src = HERE / f"{slug}.{lang}.md.tmpl"
        if not src.exists():
            continue
        tmpl = src.read_text(encoding="utf-8")
        stray = [t for t in (m.group(0).strip() for m in BARE_NUMBER.finditer(tmpl))
                 if t and not LOOKS_LIKE_A_YEAR.match(t)]
        if stray:
            print(f"REFUSING: {src.name} contains typed numbers: {stray}", file=sys.stderr)
            return 1
        try:
            rendered[lang] = (HERE / f"{slug}.{lang}.md", tmpl.format(**vars_))
        except KeyError as e:
            print(f"REFUSING: {src.name} asks for {e}, which the report does not provide",
                  file=sys.stderr)
            return 1
    for path, out in rendered.values():
        path.write_text(out, encoding="utf-8")
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
