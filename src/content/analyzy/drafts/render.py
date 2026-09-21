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
        "qNewUnits": sk_int(br["newSupply"]["units"]),
        "qNewMeanM2": sk_int(br["newSupply"]["meanM2"]),
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
