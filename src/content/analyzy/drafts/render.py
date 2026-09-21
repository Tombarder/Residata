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
    v = {
        "asOf": sk_date(rep["asOf"]),
        "rankThreshold": RANK_MIN_STOCK,
        "restMedian": sk_int(scope["rest"]["medianM2"]),
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
        "baPrice": sk_int(ba["medianPrice"]),
        "baArea": sk_dec(ba["medianArea"]),
        "baShift": sk_int(abs(ba["shiftExBiggest"])),
        "baShiftPct": sk_dec(shift_pct("Bratislava")),
        "bbBiggestPct": sk_dec(bb["biggestPct"], 0),
        "bbProjects": bb["projects"],
        "bbMedian": sk_int(bb["medianM2"]),
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
        "nrPrice": sk_int(towns["Nitra"]["medianPrice"]),
        "poPrice": sk_int(towns["Prešov"]["medianPrice"]),
        "bbPrice": sk_int(bb["medianPrice"]),
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
        "ourSupplyComparable": sk_int(rep["reconciliation"]["ourSupplyComparable"]),
        "ourMeanPrice": sk_int(rep["reconciliation"]["ourMeanPrice"]),
        "supplyDeltaPct": sk_dec(abs(rep["reconciliation"]["supplyDeltaPct"])),
        "meanPriceDeltaPct": sk_dec(abs(rep["reconciliation"]["meanPriceDeltaPct"])),
        "townTable": town_table(rep, "sk"),
        "townTableEn": town_table(rep, "en"),
        "asOfEn": en_date(rep["asOf"]),
        "windowFromEn": en_date(rep["window"]["sk"]["from"]),
        "covMissingPctEn": en_dec(
            100 * rep["externalCoverageCheck"]["freeUnitsNotTracked"] / tot["available"]),
        "supplyDeltaPctEn": en_dec(abs(rep["reconciliation"]["supplyDeltaPct"])),
        "meanPriceDeltaPctEn": en_dec(abs(rep["reconciliation"]["meanPriceDeltaPct"])),
        "slug": rep["slug"],
    }
    return v


def town_table(rep: dict, lang: str = "sk") -> str:
    """The map itself. Every town with a new-build on offer, so a reader can find
    their own and a journalist can lift one row. Sorted by stock, because that is
    the order in which the towns matter to the market rather than alphabetically."""
    head = (("| Mesto | Voľné byty | Projekty | Podiel najväčšieho projektu | "
             "Medián €/m² s DPH | Medián ceny bytu |") if lang == "sk" else
            ("| Town | Available | Projects | Largest project's share | "
             "Median €/m² incl. VAT | Median flat price |"))
    head += "\n|---|---:|---:|---:|---:|---:|"
    rows = []
    for t in rep["nationalMap"]["towns"]:
        m2 = f"{sk_int(t['medianM2'])} €" if t["medianM2"] else "—"
        pr = f"{sk_int(t['medianPrice'])} €" if t["medianPrice"] else "—"
        share = (f"{sk_dec(t['biggestPct'], 0)} %" if lang == "sk"
                 else f"{en_dec(t['biggestPct'], 0)}%")
        rows.append(f"| {t['city']} | {sk_int(t['available'])} | {t['projects']} | "
                    f"{share} | {m2} | {pr} |")
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
