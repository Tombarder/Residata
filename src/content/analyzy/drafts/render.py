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
    head = (("| Okres | Predané | Podiel na predaji | Dosiahnutá cena €/m² s DPH |"
             "\n|---|---:|---:|---:|") if lang == "sk" else
            ("| District | Sold | Share of sales | Achieved €/m² incl. VAT |"
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
