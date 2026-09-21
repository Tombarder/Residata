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

    def rooms_table(lang: str) -> str:
        names = ROOM_SK if lang == "sk" else ROOM_EN
        head = (("| Dispozícia | V ponuke | Priemerná cena €/m² s DPH | "
                 "Priemerná cena bytu | Priemerná výmera | Predaných |"
                 "\n|---|---:|---:|---:|---:|---:|") if lang == "sk" else
                ("| Disposition | On offer | Average €/m² incl. VAT | "
                 "Average flat price | Average floor area | Sold |"
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
        head = (("| Štvrťrok | Ponuka | Projekty | Predaj | Priemerná cena €/m² s DPH | Zdroj |"
                 "\n|---|---:|---:|---:|---:|---|") if lang == "sk" else
                ("| Quarter | Supply | Projects | Sales | Average €/m² incl. VAT | Source |"
                 "\n|---|---:|---:|---:|---:|---|"))
        rows = []
        for r in pub["quarters"]:
            rows.append(f"| {r['q']} | {sk_int(r['supply'])} | {r['projects'] or '—'} | "
                        f"{sk_int(r['sales'])} | {sk_int(r['meanM2Rebased'])} | {pub['source']} |")
        # Our row says what it is: a quarter-to-date while the quarter is open.
        label = ours["q"] if ours["complete"] else (
            f"{ours['q']}*" )
        sales = sk_int(ours["sales"]) if ours["complete"] else (
            f"{sk_int(ours['sales'])}*")
        rows.append(f"| **{label}** | **{sk_int(ours['supply'])}** | **{ours['projects']}** | "
                    f"**{sales}** | **{sk_int(ours['meanM2'])}** | **Residata** |")
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
        "qD1": br["districts"][0]["district"],
        "qD1Loc": locative(br["districts"][0]["district"]),
        "qD2Loc": (locative(br["districts"][1]["district"])
                   if len(br["districts"]) > 1 else ""),
        "qD1Then": sk_int(br["districts"][0]["soldThen"]),
        "qD1Now": sk_int(br["districts"][0]["soldNow"]),
        "qD2": br["districts"][1]["district"] if len(br["districts"]) > 1 else "",
        "qD2Then": sk_int(br["districts"][1]["soldThen"]) if len(br["districts"]) > 1 else "",
        "qD2Now": sk_int(br["districts"][1]["soldNow"]) if len(br["districts"]) > 1 else "",
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
        "avgQuarterSales": sk_int(
            sum(r["sales"] for r in pub["quarters"][-4:] ) / 4),
        "cqSupply": sk_int(ours["supply"]), "cqProjects": ours["projects"],
        "cqM2": sk_int(ours["meanM2"]), "cqPrice": sk_int(ours["meanPrice"]),
        "cqArea": sk_dec(ours["meanArea"]), "cqAreaEn": en_dec(ours["meanArea"]),
        "cqSales": sk_int(ours["sales"]), "cqRunRate": sk_int(ours["salesRunRate"]),
        # What was actually observed before the quarter was closed on the pace.
        "cqSalesObserved": sk_int(ours.get("preliminary", {}).get("salesObserved", ours["sales"])),
        "cqDaysObs": ours["daysObserved"], "cqDaysTot": ours["daysTotal"],
        "cqSoldM2": sk_int(ours["soldM2"]), "cqSoldPrice": sk_int(ours["soldPrice"]),
        "cqSoldArea": sk_dec(ours["soldArea"]), "cqSoldAreaEn": en_dec(ours["soldArea"]),
        "pqLabel": vp["q"], "yqLabel": vy["q"],
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
        # the U-shape, computed
        "dearestM2Room": ROOM_SK[max(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]].lower(),
        "cheapestM2Room": ROOM_SK[min(qt["byRooms"], key=lambda r: r["meanM2"])["disp"]].lower(),
        "roomSpreadPct": sk_dec(
            100 * (max(r["meanM2"] for r in qt["byRooms"])
                   / min(r["meanM2"] for r in qt["byRooms"]) - 1)),
        "roomSpreadPctEn": en_dec(
            100 * (max(r["meanM2"] for r in qt["byRooms"])
                   / min(r["meanM2"] for r in qt["byRooms"]) - 1)),
        "r1M2": sk_int(rooms["1"]["meanM2"]), "r1Price": sk_int(rooms["1"]["meanPrice"]),
        "r1Area": sk_dec(rooms["1"]["meanArea"]), "r1AreaEn": en_dec(rooms["1"]["meanArea"]),
        "r1N": sk_int(rooms["1"]["n"]), "r1Sold": sk_int(sold_rooms["1"]["n"]),
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


BARE_NUMBER = re.compile(r"(?<![\w{/.\-])\d[\d .,]{2,}(?![\w}])")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    slug = sys.argv[1]
    rep = json.loads((DATA / f"report-{slug}.json").read_text(encoding="utf-8"))
    vars_ = build_vars(rep)

    for lang in ("sk", "en"):
        src = HERE / f"{slug}.{lang}.md.tmpl"
        if not src.exists():
            continue
        tmpl = src.read_text(encoding="utf-8")
        # A typed figure looks like a bare number. Catch it here rather than in print.
        stray = [m.group(0) for m in BARE_NUMBER.finditer(tmpl)
                 if m.group(0) not in {"2026", "2025", "2024"}]
        if stray:
            print(f"REFUSING: {src.name} contains typed numbers: {stray}", file=sys.stderr)
            return 1
        try:
            out = tmpl.format(**vars_)
        except KeyError as e:
            print(f"REFUSING: {src.name} asks for {e}, which the report does not provide",
                  file=sys.stderr)
            return 1
        path = HERE / f"{slug}.{lang}.md"
        path.write_text(out, encoding="utf-8")
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
