"""The monthly trend piece (PRD 12): direction, where the weekly digest
reports events.

On the first scheduled run of a calendar month, the digest step also writes
``public/digest/YYYY-MM.json`` for the month just ended, next to the week
files, and lists it in ``index.json`` and the Atom feed with them:

* three static SVG charts (:mod:`regulation_pipeline.charts`), computed from
  ``history.json``: each bloc's mean maturity index over the 13 weeks to the
  month's last day, the net movement of each dimension across all countries
  during the month, and the ten largest month-over-month movers;
* a lead and a few sections from one Claude request over the month's weekly
  digest items and the chart data, under the digest's source rule: a section
  that cites a URL no digest item of the month cited is dropped;
* one sentence on the month's gold-set drift checks, when there were any.

Reading ``history.json`` as a time series needs care. It stores change
points, and re-researching a country without a change *advances the last
snapshot's date* (``history.py``), so a snapshot's date is the last day it was
confirmed, not the day it took effect. A plain "latest snapshot on or before
the date" lookup would put most changes in the wrong month. Here
(:func:`country_steps`) a change is dated, in order of preference, on the run
whose weekly digest reported the country's score change, on a calibration
break between the two snapshots, or else on the first known run after the
previous snapshot's date. The last is an estimate: a run where the gate held
the change or the research failed leaves the date where it was, so without a
digest such a change is dated one run early.

Score changes dated on a calibration break (``history.json`` ``breaks``) are
a re-measurement, not policy movement: the bloc chart marks the break, and
the month's movement leaves those changes out.

``python -m regulation_pipeline.digest --monthly YYYY-MM`` regenerates a
piece from the stored week files and ``history.json``.
"""

from __future__ import annotations

import bisect
import json
import logging
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, ConfigDict, ValidationError

from . import charts
from .api import parse_message
from .charts import fixed, long_date, short_date, signed
from .config import Settings
from .digest import _plain, _write, load_weeks, rebuild_listing
from .errors import DigestError
from .gold import WARN_WITHIN_ONE
from .models import ResearchResult, strip_titles
from .retry import call_with_retries

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
# Recorded in every monthly file so prose can be traced to the prompt that
# produced it. Bump when the prompt changes.
MONTHLY_PROMPT_VERSION = "monthly-v1-2026-09"

WINDOW_WEEKS = 13
MAX_MOVERS = 10
_MAX_TOKENS = 8192

MATURITY = "averageScore"
DIMENSION_KEYS: tuple[str, ...] = tuple(dim.history_key for dim in ResearchResult.DIMENSIONS)
SCORE_KEYS: tuple[str, ...] = (*DIMENSION_KEYS, MATURITY)
LABELS: dict[str, str] = {
    **{dim.history_key: dim.column for dim in ResearchResult.DIMENSIONS},
    MATURITY: "Maturity Index",
}

# Each bloc keeps one step of the legend ramp (charts.ramp(8)) from month to
# month; colour follows the bloc, never its rank. The slots were chosen with
# the dataviz palette validator so blocs that sit next to each other on the
# maturity scale (AU, ASEAN, BRICS+, G20, OECD, NATO, G7, EU) are at least
# 18 ΔE (OKLab x100) apart. One ramp cannot separate them under
# deuteranopia, so every line is also labelled at its end.
BLOC_SLOTS: dict[str, int] = {
    "AU": 4, "ASEAN": 0, "BRICS": 5, "G20": 1, "OECD": 6, "NATO": 2, "G7": 7, "EU": 3,
}
_RAMP_SIZE = 8

_QUIET_LEAD = "No country's scores moved in {month}, and the weekly digests carry no sourced changes."
_QUIET_BREAK_LEAD = (
    "No policy-driven score changes in {month}, and the weekly digests carry no sourced changes. "
    "Scores were recalibrated on {days}, a re-measurement the month's movement leaves out."
)


# -- months ------------------------------------------------------------------


_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


@dataclass(frozen=True, order=True)
class Month:
    year: int
    month: int

    @classmethod
    def parse(cls, text: str) -> Month:
        match = _MONTH_RE.match(text.strip())
        if not match:
            raise ValueError(f"not a YYYY-MM month: {text!r}")
        return cls(int(match[1]), int(match[2]))

    @classmethod
    def of(cls, day: date) -> Month:
        return cls(day.year, day.month)

    @property
    def key(self) -> str:
        return f"{self.year}-{self.month:02d}"

    @property
    def label(self) -> str:
        return f"{charts.month_name(self.month)} {self.year}"

    @property
    def first_day(self) -> date:
        return date(self.year, self.month, 1)

    @property
    def last_day(self) -> date:
        return self.next().first_day - timedelta(days=1)

    def next(self) -> Month:
        return Month(self.year + self.month // 12, self.month % 12 + 1)

    def previous(self) -> Month:
        return Month(self.year - 1, 12) if self.month == 1 else Month(self.year, self.month - 1)

    def __contains__(self, day: object) -> bool:
        return isinstance(day, date) and (day.year, day.month) == (self.year, self.month)


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


# -- history as a step function ---------------------------------------------------


@dataclass(frozen=True)
class Step:
    """One history snapshot as a step of a country's scores. ``since`` is
    the day it took effect; ``None`` for the first snapshot, which is carried
    back to the start of time as the app's timeline does."""

    since: date | None
    scores: Mapping[str, float | None]


def known_run_dates(
    history: Mapping[str, Any], weeks: Iterable[Mapping], drift_checks: Iterable[Mapping] = (),
) -> list[date]:
    """Every day a run is known to have happened: history snapshot dates,
    week-file dates, calibration breaks and drift-check rows. Sorted."""
    days: set[date | None] = set()
    for snapshots in history.get("countries", {}).values():
        days.update(_parse_date(s.get("date")) for s in snapshots)
    days.update(_parse_date(w.get("date")) for w in weeks)
    days.update(_parse_date(b.get("date")) for b in history.get("breaks", []))
    days.update(_parse_date(c.get("date")) for c in drift_checks)
    return sorted(d for d in days if d is not None)


def country_steps(
    snapshots: Iterable[Mapping],
    run_dates: Sequence[date],
    *,
    reported: Iterable[date] = (),
    breaks: Iterable[date] = (),
) -> list[Step]:
    """A country's snapshots as steps, oldest first.

    Snapshot ``k`` took effect after snapshot ``k-1``'s date (its last
    confirmation) and no later than its own date. Within that interval the
    change is dated on the first of: a run whose week file reported this
    country's score change (``reported``, exact); a calibration break
    (``breaks``: an ungated run applies every change); the first known run
    (``run_dates``, sorted), which is one run early when the gate held the
    change or the research failed on that run.
    """
    evidence = (sorted(set(reported)), sorted(set(breaks)), list(run_dates))
    dated = sorted(
        ((day, s) for s in snapshots if (day := _parse_date(s.get("date"))) is not None),
        key=lambda pair: pair[0],
    )
    steps: list[Step] = []
    confirmed: date | None = None
    for day, snapshot in dated:
        since: date | None = None
        if confirmed is not None:
            since = next(
                (found for days in evidence if (found := _first_between(days, confirmed, day))), day,
            )
        steps.append(Step(since, {key: _score(snapshot.get(key)) for key in SCORE_KEYS}))
        confirmed = day
    return steps


def _first_between(days: Sequence[date], after: date, until: date) -> date | None:
    """The first of the sorted ``days`` in ``(after, until]``."""
    i = bisect.bisect_right(days, after)
    return days[i] if i < len(days) and days[i] <= until else None


def reported_changes(weeks: Iterable[Mapping]) -> dict[str, list[date]]:
    """Country -> the run dates whose week file reported a score change for
    it. Calibration-break runs report none (``digest.select_changes``)."""
    reported: dict[str, list[date]] = {}
    for week in weeks:
        day = _parse_date(week.get("date"))
        if day is None:
            continue
        for change in week.get("changes", []):
            if isinstance(change, dict) and change.get("scores") and isinstance(change.get("country"), str):
                reported.setdefault(change["country"], []).append(day)
    return reported


def _score(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def value_at(steps: Sequence[Step], day: date, key: str) -> float | None:
    """The step function's value for ``key`` on ``day``."""
    value = None
    for step in steps:
        if step.since is not None and step.since > day:
            break
        value = step.scores.get(key)
    return value


# -- the month's movement -------------------------------------------------------


@dataclass(frozen=True)
class CountryMove:
    """A country's summed score changes during the month (non-zero keys
    only), with its scores at the end of the previous month and of this one."""

    country: str
    deltas: Mapping[str, float]
    start: Mapping[str, float | None]
    end: Mapping[str, float | None]


def month_moves(
    steps_by_country: Mapping[str, Sequence[Step]], month: Month, break_days: Iterable[date] = (),
) -> list[CountryMove]:
    """Every country whose scores changed during ``month``, by name. Changes
    dated on a calibration break are a re-measurement and are left out."""
    breaks = set(break_days)
    before = month.first_day - timedelta(days=1)
    moves: list[CountryMove] = []
    for country in sorted(steps_by_country):
        steps = steps_by_country[country]
        totals: dict[str, float] = {}
        for previous, step in zip(steps, steps[1:], strict=False):
            if step.since not in month or step.since in breaks:
                continue
            for key in SCORE_KEYS:
                old, new = previous.scores.get(key), step.scores.get(key)
                if old is None or new is None or old == new:
                    continue
                totals[key] = totals.get(key, 0.0) + new - old
        deltas = {key: round(total, 4) for key, total in totals.items() if round(total, 4) != 0}
        if deltas:
            moves.append(CountryMove(
                country=country,
                deltas=deltas,
                start={key: value_at(steps, before, key) for key in SCORE_KEYS},
                end={key: value_at(steps, month.last_day, key) for key in SCORE_KEYS},
            ))
    return moves


@dataclass(frozen=True)
class DimensionMovement:
    key: str
    label: str
    rise: float  # sum of the countries' rises, >= 0
    fall: float  # sum of their falls, <= 0
    up: int
    down: int

    @property
    def net(self) -> float:
        return round(self.rise + self.fall, 4)


def dimension_movement(moves: Iterable[CountryMove]) -> list[DimensionMovement]:
    """Net movement of each scored dimension across all countries."""
    moves = list(moves)
    rows = []
    for key in DIMENSION_KEYS:
        deltas = [m.deltas[key] for m in moves if key in m.deltas]
        rows.append(DimensionMovement(
            key=key,
            label=LABELS[key],
            rise=round(sum(d for d in deltas if d > 0), 4),
            fall=round(sum(d for d in deltas if d < 0), 4),
            up=sum(1 for d in deltas if d > 0),
            down=sum(1 for d in deltas if d < 0),
        ))
    return rows


def top_movers(moves: Iterable[CountryMove], limit: int = MAX_MOVERS) -> list[CountryMove]:
    """The countries whose maturity index moved most, largest first. Ties
    go to the larger total movement across dimensions, then to the name."""
    moved = [m for m in moves if m.deltas.get(MATURITY)]
    moved.sort(key=lambda m: (
        -abs(m.deltas[MATURITY]),
        -sum(abs(v) for k, v in m.deltas.items() if k != MATURITY),
        m.country,
    ))
    return moved[:limit]


# -- blocs -------------------------------------------------------------------


@dataclass(frozen=True)
class BlocSeries:
    key: str
    name: str
    members: int
    scored: int
    values: tuple[float | None, ...]

    @property
    def first(self) -> float | None:
        return next((v for v in self.values if v is not None), None)

    @property
    def last(self) -> float | None:
        return next((v for v in reversed(self.values) if v is not None), None)

    @property
    def change(self) -> float | None:
        if self.first is None or self.last is None:
            return None
        return round(self.last - self.first, 4)


def load_blocs(path: Path) -> dict[str, dict]:
    """``blocs.json`` without its ``_comment``: code -> {name, members}."""
    if not path.exists():
        logger.warning("digest: %s not found; the bloc chart will be empty", path.name)
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        key: {"name": str(value.get("name") or key), "members": list(value.get("members") or [])}
        for key, value in raw.items()
        if not key.startswith("_") and isinstance(value, dict)
    }


def window_dates(month: Month) -> list[date]:
    """Fourteen weekly points: the start of the 13-week window and the end
    of each week, the last on the month's last day."""
    end = month.last_day
    return [end - timedelta(weeks=WINDOW_WEEKS - i) for i in range(WINDOW_WEEKS + 1)]


def bloc_series(
    blocs: Mapping[str, Mapping], steps_by_country: Mapping[str, Sequence[Step]], dates: Sequence[date],
) -> list[BlocSeries]:
    """Each bloc's mean maturity index over its members with a score, at
    each of ``dates``, in ``blocs.json`` order."""
    series = []
    for key, bloc in blocs.items():
        members = [m for m in bloc["members"] if m in steps_by_country]
        values: list[float | None] = []
        for day in dates:
            scores = [v for m in members if (v := value_at(steps_by_country[m], day, MATURITY)) is not None]
            values.append(round(sum(scores) / len(scores), 3) if scores else None)
        series.append(BlocSeries(key, bloc["name"], len(bloc["members"]), len(members), tuple(values)))
    return series


def bloc_colours(keys: Sequence[str]) -> dict[str, str]:
    """A fixed ramp step per bloc (:data:`BLOC_SLOTS`). A bloc added to
    ``blocs.json`` later is drawn in a neutral grey (still labelled at its
    line end) until it is given a slot: a ninth colour squeezed out of the
    same ramp would be indistinguishable from its neighbours."""
    palette = charts.ramp(_RAMP_SIZE)
    return {key: palette[BLOC_SLOTS[key]] if key in BLOC_SLOTS else charts.NEUTRAL for key in keys}


def _short_bloc(series: BlocSeries) -> str:
    return series.name if len(series.name) <= 6 else series.key


# -- gold-set drift ---------------------------------------------------------------


def drift_summary(checks: Iterable[Mapping], month: Month, *, href: str, label: str) -> dict | None:
    """One sentence on the month's gold-set drift checks, or ``None`` when
    none ran. Computed, not written by the model, so the numbers are exact."""
    shares = [
        float(c["within_one"]) for c in checks
        if _parse_date(c.get("date")) in month
        and isinstance(c.get("within_one"), int | float) and not isinstance(c.get("within_one"), bool)
    ]
    if not shares:
        return None
    runs = {1: "once", 2: "twice"}.get(len(shares), f"{len(shares)} times")
    low, high = min(shares), max(shares)
    if len(shares) == 1:
        spread = f"{_pct(low)} of sub-indicators were"
    elif _pct(low) == _pct(high):
        spread = f"in each run {_pct(low)} of sub-indicators were"
    else:
        spread = f"between {_pct(low)} and {_pct(high)} of sub-indicators were"
    text = (
        f"The gold-set drift check ran {runs} in {month.label}: {spread} within one point "
        "of the hand-checked scores"
    )
    below = sum(1 for s in shares if s < WARN_WITHIN_ONE)
    if below:
        who = "the run" if len(shares) == 1 else ("one run" if below == 1 else f"{below} runs")
        text += f", and {who} fell below the {_pct(WARN_WITHIN_ONE)} warning threshold"
    return {"text": text + ".", "href": href, "label": label, "runs": len(shares), "within_one": {
        "min": low, "max": high,
    }}


def _pct(share: float) -> str:
    """'92%', '79.5%': one decimal when it matters, so a share just under the
    warning threshold never prints as the threshold itself."""
    return f"{share * 100:.1f}".rstrip("0").rstrip(".") + "%"


def drift_link(settings: Settings) -> tuple[str, str]:
    """The drift dashboard (PRD 11) once it exists, else the drift record."""
    if (settings.root / "drift.html").exists() or (settings.root / "public" / "drift.html").exists():
        return "/drift.html", "Drift dashboard"
    return "/data/drift.json", "Drift record"


# -- digest items -------------------------------------------------------------------


@dataclass(frozen=True)
class MonthItem:
    week: str
    date: str
    country: str
    headline: str
    summary: str
    sources: tuple[str, ...]


def month_weeks(weeks: Iterable[Mapping], month: Month) -> list[Mapping]:
    """The week files whose run date falls in ``month``, oldest first."""
    return sorted((w for w in weeks if _parse_date(w.get("date")) in month), key=lambda w: w.get("date", ""))


def month_items(weeks: Iterable[Mapping]) -> list[MonthItem]:
    items = []
    for week in weeks:
        for item in week.get("items", []):
            items.append(MonthItem(
                week=str(week.get("week", "")),
                date=str(week.get("date", "")),
                country=str(item.get("country", "")),
                headline=str(item.get("headline", "")),
                summary=str(item.get("summary", "")),
                sources=tuple(u.strip() for u in item.get("sources", []) if isinstance(u, str) and u.strip()),
            ))
    return items


def allowed_sources(items: Iterable[MonthItem]) -> list[str]:
    """Every URL the month's digest items cited, first-seen order."""
    return list(dict.fromkeys(url for item in items for url in item.sources))


# -- gathering the month ---------------------------------------------------------------


@dataclass(frozen=True)
class MonthInputs:
    """Everything the piece is built from, computed once."""

    month: Month
    weeks: list[Mapping]
    items: list[MonthItem]
    dates: list[date]
    blocs: list[BlocSeries]
    movement: list[DimensionMovement]
    moves: list[CountryMove]
    movers: list[CountryMove]
    breaks: list[dict] = field(default_factory=list)  # calibration breaks inside the window
    drift: dict | None = None
    # Each bloc's mean at the end of the previous month and of this one,
    # for the prompt: the chart's series spans the 13-week window.
    bloc_month: list[BlocSeries] = field(default_factory=list)

    @property
    def month_breaks(self) -> list[dict]:
        return [b for b in self.breaks if _parse_date(b.get("date")) in self.month]


def gather(settings: Settings, month: Month) -> MonthInputs:
    history = _load_json(settings.history_json, {"schema_version": 1, "countries": {}})
    weeks = load_weeks(settings.digest_dir)
    checks = _load_json(settings.drift_json, {}).get("checks", [])
    runs = known_run_dates(history, weeks, checks)
    all_breaks = [b for b in history.get("breaks", []) if _parse_date(b.get("date"))]
    break_days = [_parse_date(b["date"]) for b in all_breaks]
    reported = reported_changes(weeks)
    steps = {
        country: country_steps(snaps, runs, reported=reported.get(country, ()), breaks=break_days)  # type: ignore[arg-type]
        for country, snaps in history.get("countries", {}).items()
    }
    dates = window_dates(month)
    breaks = [dict(b) for b in all_breaks if dates[0] < _parse_date(b["date"]) <= dates[-1]]  # type: ignore[operator]
    moves = month_moves(steps, month, break_days)  # type: ignore[arg-type]
    ours = month_weeks(weeks, month)
    blocs = load_blocs(settings.blocs_json)
    href, label = drift_link(settings)
    return MonthInputs(
        month=month,
        weeks=ours,
        items=month_items(ours),
        dates=dates,
        blocs=bloc_series(blocs, steps, dates),
        movement=dimension_movement(moves),
        moves=moves,
        movers=top_movers(moves),
        breaks=breaks,
        drift=drift_summary(checks, month, href=href, label=label),
        bloc_month=bloc_series(blocs, steps, [month.first_day - timedelta(days=1), month.last_day]),
    )


def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


# -- charts ------------------------------------------------------------------------


@dataclass(frozen=True)
class Chart:
    id: str
    title: str
    caption: str
    svg: str
    table: dict
    data: dict

    def to_json(self) -> dict:
        return {
            "id": self.id, "title": self.title, "caption": self.caption, "svg": self.svg,
            "table": self.table, "data": self.data,
        }


def build_charts(inputs: MonthInputs) -> list[Chart]:
    return [bloc_chart(inputs), movement_chart(inputs), movers_chart(inputs)]


def _ids(month: Month, chart_id: str) -> charts.ChartIds:
    prefix = f"trend-{month.key}-{chart_id}"
    return charts.ChartIds(title=f"{prefix}-title", desc=f"{prefix}-desc")


def _break_note(breaks: Sequence[Mapping]) -> str:
    if not breaks:
        return ""
    days = ", ".join(long_date(_parse_date(b["date"])) for b in breaks)  # type: ignore[arg-type]
    return f" Score changes dated on the recalibration of {days} are a re-measurement and are left out."


def bloc_chart(inputs: MonthInputs) -> Chart:
    dates, month = inputs.dates, inputs.month
    title = f"Maturity index by bloc, {WINDOW_WEEKS} weeks to {long_date(dates[-1])}"
    drawn = sorted((s for s in inputs.blocs if s.last is not None), key=lambda s: -s.last)  # type: ignore[operator]
    colours = bloc_colours([s.key for s in inputs.blocs])
    lines = [
        charts.Series(
            label=s.name,
            values=s.values,
            colour=colours[s.key],
            end_label=f"{fixed(s.last)} {signed(s.change or 0)}",
            hover=(
                f"{s.name}: {fixed(s.first)} on {short_date(dates[0])}, {fixed(s.last)} on "
                f"{short_date(dates[-1])} ({signed(s.change or 0)}). {s.scored} of {s.members} members scored."
            ),
        )
        for s in drawn
    ]
    markers = [
        (_parse_date(b["date"]), "Recalibration", f"Recalibration on {long_date(_parse_date(b['date']))}: {b.get('reason', '')}")
        for b in inputs.breaks
    ]
    if drawn:
        desc = f"One line per bloc, weekly from {short_date(dates[0])} to {short_date(dates[-1])}. " + "; ".join(
            f"{s.name} {fixed(s.last)} ({signed(s.change or 0)})" for s in drawn
        ) + "."
    else:
        desc = "No bloc has a scored member in this period."
    svg = charts.line_chart_svg(
        dates, lines, ids=_ids(month, "bloc-maturity"), title=title, desc=desc,
        markers=markers,  # type: ignore[arg-type]
        empty="No bloc has a scored member in this period.",
    )
    caption = (
        f"Mean maturity index (1 to 5) of each bloc's scored members at weekly points from "
        f"{long_date(dates[0])}. Each line ends with its latest value and its change over the "
        f"{WINDOW_WEEKS} weeks."
    )
    if inputs.breaks:
        caption += " A vertical rule marks a recalibration: a line that moves there moved because the scale was re-measured."
    table = {
        "columns": ["Date", *(_short_bloc(s) for s in inputs.blocs)],
        "rows": [
            [long_date(day), *("" if s.values[i] is None else fixed(s.values[i]) for s in inputs.blocs)]
            for i, day in enumerate(dates)
        ],
    }
    data = {
        "dates": [d.isoformat() for d in dates],
        "series": [
            {"key": s.key, "name": s.name, "members": s.members, "scored": s.scored,
             "colour": colours[s.key], "values": list(s.values)}
            for s in inputs.blocs
        ],
    }
    return Chart("bloc-maturity", title, caption, svg, table, data)


def _countries(n: int) -> str:
    return f"{n} {'country' if n == 1 else 'countries'}"


def movement_chart(inputs: MonthInputs) -> Chart:
    month = inputs.month
    title = f"Net score movement by dimension, {month.label}"
    rows = [
        charts.BarRow(
            label=m.label,
            rise=m.rise,
            fall=m.fall,
            rise_label=signed(m.rise) if m.rise else "",
            fall_label=signed(m.fall) if m.fall else "",
            note=f"net {signed(m.net)}",
            hover=(
                f"{m.label}: {_countries(m.up)} rose ({signed(m.rise)} in total), "
                f"{_countries(m.down)} fell ({signed(m.fall)}); net {signed(m.net)}."
            ),
        )
        for m in inputs.movement
    ]
    moved = any(m.up or m.down for m in inputs.movement)
    if moved:
        desc = "; ".join(f"{m.label} net {signed(m.net)}, {m.up} up and {m.down} down" for m in inputs.movement) + "."
    else:
        desc = f"No dimension score moved in {month.label}."
    svg = charts.bar_chart_svg(rows, ids=_ids(month, "dimension-movement"), title=title, desc=desc)
    caption = (
        f"The sum of every country's score change in each dimension during {month.label}, in points on "
        "the 1 to 5 scale: rises to the right, falls to the left. Governance type and actor involvement "
        "are descriptive scales, so a rise there is not an improvement." + _break_note(inputs.month_breaks)
    )
    table = {
        "columns": ["Dimension", "Rises", "Falls", "Net", "Countries up", "Countries down"],
        "rows": [
            [m.label, signed(m.rise), signed(m.fall), signed(m.net), str(m.up), str(m.down)]
            for m in inputs.movement
        ],
    }
    data = {"rows": [
        {"key": m.key, "label": m.label, "rise": m.rise, "fall": m.fall, "net": m.net, "up": m.up, "down": m.down}
        for m in inputs.movement
    ]}
    return Chart("dimension-movement", title, caption, svg, table, data)


def movers_chart(inputs: MonthInputs) -> Chart:
    month, previous = inputs.month, inputs.month.previous()
    title = f"Largest movers on the maturity index, {month.label}"
    recalibrated = bool(inputs.month_breaks)
    rows = []
    for m in inputs.movers:
        delta, start, end = m.deltas[MATURITY], m.start.get(MATURITY), m.end.get(MATURITY)
        # Across a recalibration the start and end values include the
        # re-measurement, so only the end value is shown beside the change.
        note = f"now {fixed(end)}" if recalibrated else f"{fixed(start)} → {fixed(end)}"
        rows.append(charts.BarRow(
            label=m.country,
            rise=max(delta, 0.0),
            fall=min(delta, 0.0),
            rise_label=signed(delta) if delta > 0 else "",
            fall_label=signed(delta) if delta < 0 else "",
            note=note,
            hover=f"{m.country}: maturity index {signed(delta)} in {month.label}, now {fixed(end)}.",
        ))
    empty = f"No country's maturity index moved in {month.label}."
    desc = "; ".join(f"{m.country} {signed(m.deltas[MATURITY])}" for m in inputs.movers) + "." if rows else empty
    svg = charts.bar_chart_svg(
        rows, ids=_ids(month, "top-movers"), title=title, desc=desc, empty=empty,
        row_height=26.0, bar_height=12.0,
    )
    if not rows:
        caption = f"Countries ranked by the change in their maturity index during {month.label}: none moved."
    else:
        who = (
            "The one country whose maturity index moved" if len(rows) == 1
            else f"The {len(rows)} countries whose maturity index moved most"
        )
        order = "" if len(rows) == 1 else ", largest first"
        when = (
            "the end of the month" if recalibrated
            else f"the end of {previous.label} and of {month.label}"
        )
        caption = f"{who} during {month.label}{order}, with the index at {when}." + _break_note(inputs.month_breaks)
    if recalibrated:
        # The boundary values straddle the re-measurement; only the end
        # value sits beside a change that leaves it out.
        table = {
            "columns": ["Country", f"End of {month.label}", "Change excluding the recalibration"],
            "rows": [
                [m.country, fixed(m.end.get(MATURITY)), signed(m.deltas[MATURITY])] for m in inputs.movers
            ],
        }
    else:
        table = {
            "columns": ["Country", f"End of {previous.label}", f"End of {month.label}", "Change"],
            "rows": [
                [m.country, fixed(m.start.get(MATURITY)), fixed(m.end.get(MATURITY)), signed(m.deltas[MATURITY])]
                for m in inputs.movers
            ],
        }
    data = {"rows": [
        {"country": m.country, "start": m.start.get(MATURITY), "end": m.end.get(MATURITY),
         "change": m.deltas[MATURITY]}
        for m in inputs.movers
    ]}
    return Chart("top-movers", title, caption, svg, table, data)


# -- structured output -------------------------------------------------------------


class MonthlySection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str
    text: str
    sources: list[str]


class MonthlyText(BaseModel):
    """What Claude returns: the lead and a few sourced sections."""

    model_config = ConfigDict(extra="forbid")

    lead: str
    sections: list[MonthlySection]

    @classmethod
    def output_schema(cls) -> dict[str, Any]:
        return strip_titles(cls.model_json_schema())


# -- prompt ------------------------------------------------------------------------


MONTHLY_PROMPT = """You write the monthly trend piece for the AI Regulation Map, a reference tracker of AI regulation in 196 countries. Readers are policy researchers and journalists who will quote it, so every claim needs a source.

Month: {month} ({start} to {end})

You get two inputs, both below:
1. Chart data computed from the tracker's score history: each bloc's mean maturity index over the {weeks} weeks to {end}, the net movement of each scoring dimension across all countries during the month, and the countries whose maturity index moved most during the month.
2. Every item from the month's weekly digests, with the source URLs each item cited.

Scores run from 1 to 5. The maturity index is the mean of regulation status, policy lever and enforcement level. Governance type and actor involvement are descriptive scales: a higher score is neither better nor worse.

Return:
- "lead": two or three sentences, at most 70 words, that state the direction of movement in the month: which blocs and dimensions moved during the month and by how much, taken from the chart data. Use a bloc's figures within the month for the month, and its 13-week figures only when you say they cover the 13 weeks.
- "sections": up to four sections that explain the movement with the digest items behind it, each with:
  - "heading": at most 8 words.
  - "text": two to four sentences, at most 110 words. Name the countries and instruments from the digest items and give the score changes.
  - "sources": one or more URLs from the source list below that support the section.
  Return an empty list when there are no digest items.

Rules:
- Every claim must come from the chart data or the digest items below. Do not add facts, dates, law names or institutions that are not in them.
- Copy URLs exactly from the source list. Do not invent, shorten or alter a URL, and cite a URL only for the country item it is listed under.
- Write in British English.
- Do not use em dashes. Use commas or full stops.
- Do not use adjectives or adverbs that the data cannot verify (for example "landmark", "sweeping", "major", "notably", "significant").
- Do not forecast, give opinions or recommend anything.
{break_rule}
Chart data:
{chart_data}
Digest items:
{items}
Source list:
{sources}
"""

_BREAK_RULE = (
    "- The tracker recalibrated its scores on {days} ({reasons}). Score changes on those dates are a "
    "re-measurement, not policy change: they are left out of the month's movement, and a bloc line "
    "that moves on that date moved because of the recalibration. Say so if you mention it.\n"
)


def render_prompt(inputs: MonthInputs) -> str:
    month, dates = inputs.month, inputs.dates
    break_rule = ""
    if inputs.breaks:
        break_rule = _BREAK_RULE.format(
            days=", ".join(b["date"] for b in inputs.breaks),
            reasons="; ".join(str(b.get("reason", "calibration reset")) for b in inputs.breaks),
        )
    sources = allowed_sources(inputs.items)
    return MONTHLY_PROMPT.format(
        month=month.label,
        start=month.first_day.isoformat(),
        end=month.last_day.isoformat(),
        weeks=WINDOW_WEEKS,
        break_rule=break_rule,
        chart_data=_chart_block(inputs, dates),
        items=_items_block(inputs.items),
        sources="".join(f"- {url}\n" for url in sources) or "none\n",
    )


def _p(value: float | None) -> str:
    """A signed number for the prompt, ASCII minus; '0.00' for no change."""
    if value is None:
        return "none"
    return "0.00" if round(value, 2) == 0 else f"{value:+.2f}"


def _chart_block(inputs: MonthInputs, dates: Sequence[date]) -> str:
    month = inputs.month
    recalibrated = bool(inputs.month_breaks)
    lines = [
        f"Bloc mean maturity index (members scored): over the {WINDOW_WEEKS} weeks "
        f"{dates[0].isoformat()} to {dates[-1].isoformat()}, and within {month.label}"
        + (" (the month's figures include the recalibration)" if recalibrated else "") + ":"
    ]
    in_month = {s.key: s for s in inputs.bloc_month}
    for s in inputs.blocs:
        if s.last is None:
            lines.append(f"- {s.name}: no scored members")
            continue
        line = f"- {s.name} ({s.scored}): {WINDOW_WEEKS} weeks {fixed(s.first)} -> {fixed(s.last)} ({_p(s.change)})"
        month_series = in_month.get(s.key)
        if month_series is not None and month_series.change is not None:
            line += (
                f"; {month.label} {fixed(month_series.first)} -> {fixed(month_series.last)} "
                f"({_p(month_series.change)})"
            )
        lines.append(line)
    lines.append(f"\nNet movement by dimension across all countries in {month.label}:")
    for m in inputs.movement:
        lines.append(
            f"- {m.label}: rises {_p(m.rise)} in {_countries(m.up)}, falls {_p(m.fall)} in "
            f"{_countries(m.down)}, net {_p(m.net)}"
        )
    lines.append(f"\nLargest movers on the maturity index in {month.label}:")
    if not inputs.movers:
        lines.append("- none")
    for m in inputs.movers:
        other = ", ".join(
            f"{LABELS[k]} {_p(v)}" for k, v in m.deltas.items() if k != MATURITY
        )
        if recalibrated:
            lines.append(
                f"- {m.country}: now {fixed(m.end.get(MATURITY))}, change excluding the recalibration "
                f"{_p(m.deltas[MATURITY])}; {other}"
            )
        else:
            lines.append(
                f"- {m.country}: {fixed(m.start.get(MATURITY))} -> {fixed(m.end.get(MATURITY))} "
                f"({_p(m.deltas[MATURITY])}); {other}"
            )
    return "\n".join(lines) + "\n"


def _items_block(items: Sequence[MonthItem]) -> str:
    if not items:
        return "none\n"
    blocks: list[str] = []
    current = None
    for item in items:
        if item.week != current:
            current = item.week
            blocks.append(f"### {_week_label(item.week)} (run {item.date})")
        blocks.append(f"- {item.country}: {item.headline}. {item.summary}")
        blocks.append(f"  Sources: {', '.join(item.sources) or 'none'}")
    return "\n".join(blocks) + "\n"


def _week_label(week: str) -> str:
    year, _, number = week.partition("-W")
    return f"Week {int(number)}, {year}" if number.isdigit() else week


# -- generation ------------------------------------------------------------------------


def request_params(inputs: MonthInputs, *, model: str) -> dict:
    return {
        "model": model,
        "max_tokens": _MAX_TOKENS,
        "messages": [{"role": "user", "content": render_prompt(inputs)}],
        "output_config": {
            "format": {"type": "json_schema", "schema": MonthlyText.output_schema()}
        },
    }


def generate(client: anthropic.Anthropic, inputs: MonthInputs, *, model: str) -> MonthlyText:
    """One request for the whole narrative. Raises :class:`DigestError`
    when the API gives up or returns something that fails validation."""
    params = request_params(inputs, model=model)
    response = call_with_retries(lambda: client.messages.create(**params), label="monthly")
    if response is None:
        raise DigestError("monthly request failed after retries")
    raw = parse_message(response, "monthly")
    if raw is None:
        raise DigestError("monthly response was not JSON")
    try:
        text = MonthlyText.model_validate(raw)
    except ValidationError as exc:
        raise DigestError(f"monthly response failed validation: {exc}") from exc
    return validate_sections(text, allowed_sources(inputs.items))


def validate_sections(text: MonthlyText, allowed: Iterable[str]) -> MonthlyText:
    """Drop any section that cites no source, or a URL no digest item of
    the month cited. Normalise dashes."""
    urls = set(allowed)
    kept: list[MonthlySection] = []
    for section in text.sections:
        cited = [u.strip() for u in section.sources if u.strip()]
        foreign = [u for u in cited if u not in urls]
        heading, body = _plain(section.heading), _plain(section.text)
        if foreign or not cited or not heading or not body:
            logger.warning(
                "digest: dropped monthly section %r - %s", section.heading,
                f"cites URLs outside the month's digests: {foreign}" if foreign
                else "cites no source" if not cited else "is empty",
            )
            continue
        kept.append(MonthlySection(heading=heading, text=body, sources=list(dict.fromkeys(cited))))
    return MonthlyText(lead=_plain(text.lead), sections=kept)


# -- the piece ------------------------------------------------------------------------


def build_piece(
    inputs: MonthInputs,
    text: MonthlyText,
    *,
    run_id: str | None,
    model: str,
    run_date: date,
    generated_at: datetime,
) -> dict:
    """The ``YYYY-MM.json`` document."""
    month = inputs.month
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "monthly",
        "month": month.key,
        "date": run_date.isoformat(),
        "generated_at": generated_at.isoformat(),
        "run_id": run_id or None,
        "model": model,
        "prompt_version": MONTHLY_PROMPT_VERSION,
        "period": {"start": month.first_day.isoformat(), "end": month.last_day.isoformat()},
        "window": {
            "start": inputs.dates[0].isoformat(), "end": inputs.dates[-1].isoformat(), "weeks": WINDOW_WEEKS,
        },
        "weeks": [str(w.get("week", "")) for w in inputs.weeks],
        "calibration_breaks": inputs.breaks,
        "lead": text.lead,
        "sections": [section.model_dump() for section in text.sections],
        "drift": inputs.drift,
        "charts": [chart.to_json() for chart in build_charts(inputs)],
    }


def _quiet_lead(inputs: MonthInputs) -> str:
    """The fixed lead for a month with no movement and no digest item. A
    recalibration in the month moved every score, so it is named."""
    if inputs.month_breaks:
        days = ", ".join(
            f"{long_date(_parse_date(b['date']))} ({b.get('reason') or 'calibration reset'})"  # type: ignore[arg-type]
            for b in inputs.month_breaks
        )
        return _QUIET_BREAK_LEAD.format(month=inputs.month.label, days=days)
    return _QUIET_LEAD.format(month=inputs.month.label)


def write_monthly(
    settings: Settings,
    month: Month,
    *,
    client: anthropic.Anthropic | None,
    model: str,
    run_date: date,
    run_id: str | None = None,
    now: datetime | None = None,
) -> Path:
    """Build the piece for ``month`` (one request, skipped when nothing
    moved and no digest item exists), write it, and rebuild the index and
    feed."""
    inputs = gather(settings, month)
    if not inputs.weeks:
        logger.warning("digest: no weekly digests for %s; the monthly piece has no sourced sections", month.key)
    if inputs.items or inputs.moves:
        if client is None:
            raise DigestError("an Anthropic client is required for the monthly narrative")
        text = generate(client, inputs, model=model)
    else:
        text = MonthlyText(lead=_quiet_lead(inputs), sections=[])
    piece = build_piece(
        inputs, text, run_id=run_id, model=model, run_date=run_date, generated_at=now or datetime.now(UTC),
    )
    digest_dir = settings.digest_dir
    digest_dir.mkdir(parents=True, exist_ok=True)
    path = digest_dir / f"{month.key}.json"
    _write(path, json.dumps(piece, ensure_ascii=False, indent=2))
    rebuild_listing(digest_dir)
    logger.info(
        "digest: wrote monthly piece %s (%d sections, %d countries moved, %d weekly digests)",
        path.relative_to(settings.root), len(piece["sections"]), len(inputs.moves), len(inputs.weeks),
    )
    return path


def write_monthly_if_due(
    settings: Settings,
    *,
    client: anthropic.Anthropic | None,
    model: str,
    run_date: date,
    run_id: str | None = None,
    now: datetime | None = None,
) -> Path | None:
    """The trigger: on a scheduled run, write the piece for the previous
    month unless it exists. The first scheduled run of a month writes it; a
    later run of the same month retries if that one failed. A month with no
    weekly digest (before the digest existed) is skipped."""
    month = Month.of(run_date).previous()
    path = settings.digest_dir / f"{month.key}.json"
    if path.exists():
        logger.debug("digest: monthly piece %s already written", month.key)
        return None
    if not month_weeks(load_weeks(settings.digest_dir), month):
        logger.info("digest: no weekly digests for %s; monthly piece skipped", month.key)
        return None
    return write_monthly(
        settings, month, client=client, model=model, run_date=run_date, run_id=run_id, now=now,
    )

