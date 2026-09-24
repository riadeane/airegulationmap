"""Static SVG charts for the monthly trend piece (PRD 12).

Hand-built with the standard library, so the pipeline needs no plotting
dependency and the typography stays under our control. Two chart forms
cover the piece: a line chart (bloc maturity over the trailing quarter) and
a diverging bar chart (net dimension movement, and the largest movers).

The charts are embedded in the monthly JSON and rendered inline on
``changes.html``, so they must read in both themes without knowing which
one is active:

* every piece of text and every rule uses ``currentColor``, with opacity for
  hierarchy (the page sets the colour to its primary text token);
* series colours are hexes computed from the map legend's OKLCH endpoints
  (``--score-low`` / ``--score-high`` in ``src/styles/_tokens.css``) at their
  mid lightness, which clears 3:1 against both the light and the dark
  background;
* end dots carry the ``mark-ring`` class, which the page strokes with its
  background colour (the surface ring that keeps a dot legible over a line).

Every value a chart shows is also in its table (built by ``monthly.py``), so
nothing is readable only from the picture.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from html import escape

# Drawn at the width the changes page gives them (its 68ch column), so text
# renders at its nominal size; the page scrolls them sideways on phones.
WIDTH = 520
FONT_FAMILY = "Geist, -apple-system, 'Segoe UI', sans-serif"
FONT_SIZE = 12
TICK_SIZE = 11
NOTE_SIZE = 10
# Average advance width of Geist at these sizes, in em. Slightly generous so
# measured columns never clip; there is no font metrics table in the stdlib.
_CHAR_EM = 0.58

# Text hierarchy as opacity over currentColor. 0.66 keeps 11px tick labels
# above 4.5:1 against either theme's background.
PRIMARY = "1"
SECONDARY = "0.8"
TERTIARY = "0.66"
GRID_OPACITY = "0.14"
RULE_OPACITY = "0.45"

# The map legend's endpoints (dark-theme tokens). Their lightness sits
# mid-range, so one hex works on both backgrounds.
SCORE_LOW = (0.58, 0.16, 28.0)
SCORE_HIGH = (0.62, 0.13, 245.0)

MINUS = "−"
_MONTHS = (
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
)


# -- colour ----------------------------------------------------------------------


def oklch_to_hex(lightness: float, chroma: float, hue: float) -> str:
    """sRGB hex for an OKLCH colour. Out-of-gamut colours keep their
    lightness and hue and lose chroma until they fit (a binary search), the
    same mapping CSS Color 4 recommends."""
    rgb = _oklch_to_srgb(lightness, chroma, hue)
    if not _in_gamut(rgb):
        low, high = 0.0, chroma
        for _ in range(24):
            mid = (low + high) / 2
            if _in_gamut(_oklch_to_srgb(lightness, mid, hue)):
                low = mid
            else:
                high = mid
        rgb = _oklch_to_srgb(lightness, low, hue)
    return "#" + "".join(f"{round(_clamp01(_encode(c)) * 255):02x}" for c in rgb)


def _oklch_to_srgb(lightness: float, chroma: float, hue: float) -> tuple[float, float, float]:
    """OKLCH -> linear sRGB (Björn Ottosson's OKLab matrices)."""
    a = chroma * math.cos(math.radians(hue))
    b = chroma * math.sin(math.radians(hue))
    l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def _in_gamut(rgb: tuple[float, float, float]) -> bool:
    return all(-1e-4 <= c <= 1 + 1e-4 for c in rgb)


def _encode(linear: float) -> float:
    """Linear light -> sRGB transfer curve."""
    if linear <= 0.0031308:
        return 12.92 * linear
    return 1.055 * linear ** (1 / 2.4) - 0.055


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def ramp(count: int) -> list[str]:
    """``count`` colours stepped from the legend's low endpoint to its high
    endpoint. Interpolated in OKLCH along the shorter hue arc (red, magenta,
    violet, blue) rather than in Lab as the continuous legend is: Lab greys
    out the middle of a red-blue ramp, and a grey line reads as "no data"."""
    if count <= 0:
        return []
    if count == 1:
        return [oklch_to_hex(*SCORE_HIGH)]
    (l0, c0, h0), (l1, c1, h1) = SCORE_LOW, SCORE_HIGH
    turn = (h1 - h0 + 180) % 360 - 180  # signed shorter arc
    colours = []
    for i in range(count):
        t = i / (count - 1)
        colours.append(oklch_to_hex(l0 + (l1 - l0) * t, c0 + (c1 - c0) * t, (h0 + turn * t) % 360))
    return colours


RISE = oklch_to_hex(*SCORE_HIGH)
FALL = oklch_to_hex(*SCORE_LOW)
# A mid grey for series without an identity colour; same lightness band.
NEUTRAL = oklch_to_hex(0.6, 0.0, 0.0)


# -- formatting ------------------------------------------------------------------


def signed(value: float, digits: int = 2) -> str:
    """'+0.25', '−0.50' (a true minus sign), or '0.00' for no change."""
    text = f"{value:+.{digits}f}"
    if float(text) == 0:
        return f"{0:.{digits}f}"
    return text.replace("-", MINUS)


def fixed(value: float | None, digits: int = 2) -> str:
    return "none" if value is None else f"{value:.{digits}f}"


def short_date(day: date) -> str:
    """'1 Jul'."""
    return f"{day.day} {_MONTHS[day.month - 1][:3]}"


def long_date(day: date) -> str:
    """'30 September 2026'."""
    return f"{day.day} {_MONTHS[day.month - 1]} {day.year}"


def month_name(month: int) -> str:
    return _MONTHS[month - 1]


def text_width(text: str, size: float = FONT_SIZE) -> float:
    return len(text) * size * _CHAR_EM


# -- SVG primitives --------------------------------------------------------------


def _num(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _attrs(attrs: dict[str, object]) -> str:
    parts = []
    for key, value in attrs.items():
        if value is None:
            continue
        if isinstance(value, float):
            value = _num(value)
        parts.append(f'{key}="{escape(_clean(str(value)), quote=True)}"')
    return (" " + " ".join(parts)) if parts else ""


def _el(tag: str, attrs: dict[str, object] | None = None, *children: str) -> str:
    inner = "".join(children)
    if not inner:
        return f"<{tag}{_attrs(attrs or {})}/>"
    return f"<{tag}{_attrs(attrs or {})}>{inner}</{tag}>"


# Characters XML 1.0 forbids even escaped; one would make the SVG ill-formed.
_XML_ILLEGAL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")


def _clean(content: str) -> str:
    return _XML_ILLEGAL.sub("", content)


def _text(content: str) -> str:
    return escape(_clean(content), quote=False)


@dataclass(frozen=True)
class ChartIds:
    """Element ids for a chart's ``<title>`` and ``<desc>``. Unique per
    page: the monthly piece prefixes them with its month."""

    title: str
    desc: str


def _svg(height: float, ids: ChartIds, title: str, desc: str, body: str) -> str:
    return _el(
        "svg",
        {
            "xmlns": "http://www.w3.org/2000/svg",
            "viewBox": f"0 0 {WIDTH} {_num(height)}",
            "width": WIDTH,
            "height": _num(height),
            "role": "img",
            "aria-labelledby": f"{ids.title} {ids.desc}",
            "font-family": FONT_FAMILY,
            "font-size": FONT_SIZE,
            "fill": "currentColor",
        },
        _el("title", {"id": ids.title}, _text(title)),
        _el("desc", {"id": ids.desc}, _text(desc)),
        body,
    )


def _label(x: float, y: float, content: str, **attrs: object) -> str:
    """A text line vertically centred on ``y`` (baseline shifted by a third
    of the font size; dominant-baseline is unreliable across renderers)."""
    size = attrs.pop("size", FONT_SIZE)
    return _el(
        "text",
        {"x": float(x), "y": float(y + size * 0.35), "font-size": None if size == FONT_SIZE else size, **attrs},
        _text(content),
    )


def message_svg(message: str, *, ids: ChartIds, title: str) -> str:
    """A one-line chart body for an empty series ("nothing moved")."""
    height = 56
    return _svg(height, ids, title, message, _label(0, height / 2, message, **{"fill-opacity": SECONDARY}))


# -- line chart ------------------------------------------------------------------


@dataclass(frozen=True)
class Series:
    label: str
    values: tuple[float | None, ...]
    colour: str
    end_label: str  # the value text beside the line end, e.g. '3.38 +0.05'
    hover: str  # the native tooltip on the line


def line_chart_svg(
    dates: Sequence[date],
    series: Sequence[Series],
    *,
    ids: ChartIds,
    title: str,
    desc: str,
    markers: Sequence[tuple[date, str, str]] = (),
    empty: str = "No data for this period.",
) -> str:
    """One line per series over ``dates``, labelled at the right end.

    End labels that would collide are spread apart and tied back to their
    line with a hairline leader, so identity never rests on colour alone.
    ``markers`` are ``(date, label, hover)`` vertical rules, used for
    calibration breaks.
    """
    values = [v for s in series for v in s.values if v is not None]
    if not dates or not values:
        return message_svg(empty, ids=ids, title=title)

    lo, hi, step = _y_domain(min(values), max(values))
    top, plot_h, bottom = 22.0, 220.0, 30.0
    left = max(text_width(_tick(hi, step), TICK_SIZE), text_width(_tick(lo, step), TICK_SIZE)) + 10
    swatch, gap = 14.0, 5.0
    label_w = max(text_width(f"{s.label} {s.end_label}") for s in series) + swatch + gap + 8
    plot_x0 = left
    plot_x1 = max(WIDTH - label_w - 18, plot_x0 + 200)  # labels may overhang, never the plot
    height = top + plot_h + bottom

    first, last = dates[0], dates[-1]
    span = max((last - first).days, 1)

    def x_at(day: date) -> float:
        return plot_x0 + (day - first).days / span * (plot_x1 - plot_x0)

    def y_at(value: float) -> float:
        return top + (hi - value) / (hi - lo) * plot_h

    parts: list[str] = []
    # Horizontal gridlines with their tick values.
    ticks = _ticks(lo, hi, step)
    for tick in ticks:
        y = y_at(tick)
        parts.append(_el("line", {
            "x1": plot_x0, "x2": plot_x1, "y1": y, "y2": y, "stroke": "currentColor",
            "stroke-opacity": RULE_OPACITY if tick == lo else GRID_OPACITY, "stroke-width": 1,
        }))
        parts.append(_label(plot_x0 - 8, y, _tick(tick, step), size=TICK_SIZE, **{
            "text-anchor": "end", "fill-opacity": TERTIARY,
        }))
    # Date labels: the first point of each month and the last point.
    for index in _date_label_indices(dates):
        anchor = "end" if index == len(dates) - 1 else ("start" if index == 0 else "middle")
        parts.append(_label(x_at(dates[index]), top + plot_h + 16, short_date(dates[index]), size=TICK_SIZE, **{
            "text-anchor": anchor, "fill-opacity": TERTIARY,
        }))
    for day, label, hover in markers:
        if not first <= day <= last:
            continue
        x = x_at(day)
        parts.append(_el(
            "g", {},
            _el("title", {}, _text(hover)),
            _el("line", {
                "x1": x, "x2": x, "y1": top - 4, "y2": top + plot_h, "stroke": "currentColor",
                "stroke-opacity": RULE_OPACITY, "stroke-width": 1,
            }),
            _label(x, top - 12, label, size=NOTE_SIZE, **{"text-anchor": "middle", "fill-opacity": TERTIARY}),
        ))

    # Lines, then end dots, so no line crosses a dot.
    ends: list[tuple[int, float, float]] = []
    lines: list[str] = []
    dots: list[str] = []
    for i, s in enumerate(series):
        path = _line_path([(x_at(d), y_at(v)) if v is not None else None for d, v in zip(dates, s.values, strict=True)])
        if not path:
            continue
        lines.append(_el(
            "g", {},
            _el("title", {}, _text(s.hover)),
            # A wide transparent twin makes the 2px line easy to hover.
            _el("path", {"d": path, "fill": "none", "stroke": "currentColor", "stroke-opacity": "0", "stroke-width": 10}),
            _el("path", {
                "d": path, "fill": "none", "stroke": s.colour, "stroke-width": 2,
                "stroke-linecap": "round", "stroke-linejoin": "round",
            }),
        ))
        last_index = max(j for j, v in enumerate(s.values) if v is not None)
        end_x, end_y = x_at(dates[last_index]), y_at(s.values[last_index])  # type: ignore[arg-type]
        dots.append(_el("circle", {
            "class": "mark-ring", "cx": end_x, "cy": end_y, "r": 4, "fill": s.colour, "stroke-width": 2,
        }))
        ends.append((i, end_x, end_y))
    parts.extend(lines)
    parts.extend(dots)

    # End labels, spread apart where they would collide.
    placed = dodge([y for _, _, y in ends], gap=15.0, lo=8.0, hi=height - 8)
    label_x = plot_x1 + 18
    for (i, end_x, end_y), y in zip(ends, placed, strict=True):
        s = series[i]
        if abs(y - end_y) > 1.5:
            parts.append(_el("line", {
                "x1": end_x + 6, "y1": end_y, "x2": label_x - 3, "y2": y, "stroke": "currentColor",
                "stroke-opacity": "0.35", "stroke-width": 1,
            }))
        parts.append(_el("line", {
            "x1": label_x, "x2": label_x + swatch, "y1": y, "y2": y, "stroke": s.colour,
            "stroke-width": 2, "stroke-linecap": "round",
        }))
        parts.append(_el(
            "text", {"x": label_x + swatch + gap, "y": y + FONT_SIZE * 0.35},
            _text(s.label + " "),
            _el("tspan", {"fill-opacity": TERTIARY}, _text(s.end_label)),
        ))

    return _svg(height, ids, title, desc, "".join(parts))


def _y_domain(low: float, high: float) -> tuple[float, float, float]:
    """A tick step and a domain on its grid that holds the data, inside 1-5.
    A flat series gets one step either side where the scale allows."""
    spread = high - low
    step = 0.5 if spread > 1.2 else 0.25 if spread > 0.4 else 0.1
    lo = round(math.floor(low / step + 1e-9) * step, 4)
    hi = round(math.ceil(high / step - 1e-9) * step, 4)
    if hi - lo < step - 1e-9:
        if lo - step >= 1.0 - 1e-9:
            lo = round(lo - step, 4)
        if hi + step <= 5.0 + 1e-9:
            hi = round(hi + step, 4)
    return max(1.0, lo), min(5.0, hi), step


def _ticks(lo: float, hi: float, step: float) -> list[float]:
    count = int(math.floor((hi - lo) / step + 1e-9))
    return [round(lo + i * step, 4) for i in range(count + 1)]


def _tick(value: float, step: float) -> str:
    return f"{value:.1f}" if step >= 0.1 and round(step * 10) == step * 10 else f"{value:.2f}"


def _date_label_indices(dates: Sequence[date]) -> list[int]:
    last = len(dates) - 1
    candidates = [i for i in range(len(dates)) if i == 0 or dates[i].month != dates[i - 1].month]
    kept = [last]
    for i in reversed(candidates):
        if kept[-1] - i >= 3:
            kept.append(i)
    return sorted(kept)


def _line_path(points: Sequence[tuple[float, float] | None]) -> str:
    """Straight segments through the points; a gap (None) lifts the pen."""
    commands: list[str] = []
    pen_down = False
    for point in points:
        if point is None:
            pen_down = False
            continue
        x, y = point
        commands.append(f"{'L' if pen_down else 'M'}{_num(x)} {_num(y)}")
        pen_down = True
    return " ".join(commands)


def dodge(targets: Sequence[float], *, gap: float, lo: float, hi: float) -> list[float]:
    """Positions as close to ``targets`` as possible, at least ``gap`` apart
    and inside ``[lo, hi]`` where they fit. Overlapping labels merge into
    clusters centred on the mean of their targets, so a pile-up spreads
    evenly around where the lines end instead of drifting in one direction."""
    order = sorted(range(len(targets)), key=lambda i: targets[i])
    clusters: list[tuple[list[int], float]] = []
    for index in order:
        clusters.append(([index], targets[index]))
        while len(clusters) > 1:
            (a_members, a_start), (b_members, b_start) = clusters[-2], clusters[-1]
            if b_start >= a_start + len(a_members) * gap:
                break
            members = a_members + b_members
            mean = sum(targets[m] for m in members) / len(members)
            clusters[-2:] = [(members, mean - (len(members) - 1) * gap / 2)]
    flat = [(m, start + k * gap) for members, start in clusters for k, m in enumerate(members)]
    placed = [y for _, y in flat]
    floor = lo
    for k in range(len(placed)):
        placed[k] = max(placed[k], floor)
        floor = placed[k] + gap
    ceiling = hi
    for k in reversed(range(len(placed))):
        placed[k] = min(placed[k], ceiling)
        ceiling = placed[k] - gap
    result = [0.0] * len(targets)
    for (member, _), y in zip(flat, placed, strict=True):
        result[member] = y
    return result


# -- diverging bars ----------------------------------------------------------------


@dataclass(frozen=True)
class BarRow:
    label: str
    rise: float  # >= 0, drawn right of the baseline
    fall: float  # <= 0, drawn left of it
    rise_label: str  # text at the rise bar's tip ('' for none)
    fall_label: str
    note: str  # the right-hand column, e.g. 'net +1.25 · 5 up, 1 down'
    hover: str


def bar_chart_svg(
    rows: Sequence[BarRow],
    *,
    ids: ChartIds,
    title: str,
    desc: str,
    empty: str = "Nothing moved.",
    row_height: float = 30.0,
    bar_height: float = 14.0,
) -> str:
    """Horizontal bars growing both ways from one baseline: rises right in
    the legend's high colour, falls left in its low colour. One scale for
    both sides. Values sit at the bar tips; the note column carries the
    net figure."""
    if not rows:
        return message_svg(empty, ids=ids, title=title)

    max_rise = max(r.rise for r in rows)
    max_fall = -min(r.fall for r in rows)
    legend_h = 26.0
    label_w = max(text_width(r.label) for r in rows) + 14
    note_w = max(text_width(r.note) for r in rows) + 12
    tip_right = max((text_width(r.rise_label, TICK_SIZE) for r in rows if r.rise_label), default=0) + 6
    tip_left = max((text_width(r.fall_label, TICK_SIZE) for r in rows if r.fall_label), default=0) + 6
    span_x0 = label_w + (tip_left if max_fall else 0)
    span_x1 = max(WIDTH - note_w - (tip_right if max_rise else 0), span_x0 + 80)
    total = max_rise + max_fall
    if total == 0:
        baseline = (span_x0 + span_x1) / 2
        scale = 0.0
    else:
        scale = (span_x1 - span_x0) / total
        baseline = span_x0 + max_fall * scale
    height = legend_h + len(rows) * row_height + 6

    parts = [_legend([("Rises", RISE), ("Falls", FALL)], x=label_w, y=9)]
    rows_top = legend_h
    parts.append(_el("line", {
        "x1": baseline, "x2": baseline, "y1": rows_top - 2, "y2": rows_top + len(rows) * row_height,
        "stroke": "currentColor", "stroke-opacity": RULE_OPACITY, "stroke-width": 1,
    }))
    for i, row in enumerate(rows):
        centre = rows_top + i * row_height + row_height / 2
        bar_top = centre - bar_height / 2
        cells = [
            _el("title", {}, _text(row.hover)),
            _el("rect", {
                "x": 0, "y": centre - row_height / 2, "width": WIDTH, "height": row_height,
                "fill": "currentColor", "fill-opacity": "0",
            }),
            _label(0, centre, row.label, **{"fill-opacity": SECONDARY}),
        ]
        if row.rise > 0:
            tip = baseline + row.rise * scale
            cells.append(_el("path", {"d": _bar_path(baseline, tip, bar_top, bar_height), "fill": RISE}))
            if row.rise_label:
                cells.append(_label(tip + 5, centre, row.rise_label, size=TICK_SIZE, **{"fill-opacity": TERTIARY}))
        if row.fall < 0:
            tip = baseline + row.fall * scale
            cells.append(_el("path", {"d": _bar_path(baseline, tip, bar_top, bar_height), "fill": FALL}))
            if row.fall_label:
                cells.append(_label(tip - 5, centre, row.fall_label, size=TICK_SIZE, **{
                    "text-anchor": "end", "fill-opacity": TERTIARY,
                }))
        cells.append(_label(WIDTH, centre, row.note, **{"text-anchor": "end", "fill-opacity": SECONDARY}))
        parts.append(_el("g", {}, *cells))
    return _svg(height, ids, title, desc, "".join(parts))


def _bar_path(base: float, tip: float, top: float, height: float, radius: float = 4.0) -> str:
    """A bar square at the baseline with a rounded data end."""
    length = abs(tip - base)
    r = min(radius, length, height / 2)
    bottom = top + height
    if tip >= base:
        return (
            f"M{_num(base)} {_num(top)} H{_num(tip - r)} "
            f"A{_num(r)} {_num(r)} 0 0 1 {_num(tip)} {_num(top + r)} V{_num(bottom - r)} "
            f"A{_num(r)} {_num(r)} 0 0 1 {_num(tip - r)} {_num(bottom)} H{_num(base)} Z"
        )
    return (
        f"M{_num(base)} {_num(top)} H{_num(tip + r)} "
        f"A{_num(r)} {_num(r)} 0 0 0 {_num(tip)} {_num(top + r)} V{_num(bottom - r)} "
        f"A{_num(r)} {_num(r)} 0 0 0 {_num(tip + r)} {_num(bottom)} H{_num(base)} Z"
    )


def _legend(keys: Sequence[tuple[str, str]], *, x: float, y: float) -> str:
    parts = []
    for label, colour in keys:
        parts.append(_el("rect", {"x": x, "y": y - 5, "width": 10, "height": 10, "rx": 2, "fill": colour}))
        parts.append(_label(x + 15, y, label, size=TICK_SIZE, **{"fill-opacity": SECONDARY}))
        x += 15 + text_width(label, TICK_SIZE) + 18
    return _el("g", {}, *parts)
