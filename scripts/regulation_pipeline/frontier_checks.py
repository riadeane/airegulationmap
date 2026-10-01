"""Checks on the Frontier Risk Governance lens (PRD 15, requirements 7, 15
and 16). None of them runs in the weekly pipeline; each is a one-off the
maintainer runs before launch and after a change to the lens.

* ``sensitivity`` - how much the gold countries' scores and order move
  between arithmetic, geometric and capped aggregation (the OECD/JRC
  Handbook's audit step). Pure: reads ``gold_set.json`` and the public
  lists, no API call.
* ``behaviour`` - re-research the gold countries with the frontier anchors
  in reverse order, or with a paraphrased frontier section, and report how
  many frontier sub-indicators move against a baseline run with the
  production prompt. LLM coders follow label order and wording more than
  definitions (He et al. 2026); this measures how much. Costs one baseline
  and one variant research pass per gold country.
* ``crossval`` - Spearman correlation of the published frontier scores with
  other indices (the OECD.AI AI Safety Institute network flag, GIRAI Trust
  and Safety, Oxford Insights Resilience), read from a CSV the maintainer
  supplies. A high correlation would mean the lens re-measures readiness.

``python -m regulation_pipeline.frontier_checks sensitivity|behaviour|crossval``
"""

from __future__ import annotations

import csv
import json
import logging
import math
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import typer

from .config import Settings
from .frontier import FrontierContext
from .models import (
    COMPUTED_SUBINDICATORS,
    FRONTIER_SUBINDICATORS,
    NA,
    FrontierRecord,
    applies,
)
from .prompt import FRONTIER_ANCHORS, FRONTIER_STANDARD

logger = logging.getLogger(__name__)

app = typer.Typer(add_completion=False, help=__doc__.split("\n\n")[0])


# -- sensitivity (requirement 7) ---------------------------------------------------


def arithmetic(values: list[int]) -> float:
    return round(sum(values) / len(values), 2)


def geometric(values: list[int]) -> float:
    return round(math.exp(sum(math.log(v) for v in values) / len(values)), 2)


def capped(values: list[int]) -> float:
    return round(min(sum(values) / len(values), min(values) + 1), 2)


AGGREGATIONS: dict[str, Callable[[list[int]], float]] = {
    "arithmetic": arithmetic, "geometric": geometric, "capped": capped,
}


def ranks(scores: Mapping[str, float]) -> dict[str, float]:
    """1 = highest score; ties share the mean of their positions."""
    ordered = sorted(scores, key=lambda c: -scores[c])
    out: dict[str, float] = {}
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and scores[ordered[j + 1]] == scores[ordered[i]]:
            j += 1
        for k in range(i, j + 1):
            out[ordered[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(x: Mapping[str, float], y: Mapping[str, float]) -> tuple[float | None, int]:
    """Spearman's rank correlation over the keys both share (Pearson on
    average ranks, so ties are handled), and the number of pairs."""
    keys = sorted(set(x) & set(y))
    if len(keys) < 3:
        return None, len(keys)
    rx, ry = ranks({k: x[k] for k in keys}), ranks({k: y[k] for k in keys})
    mx, my = sum(rx.values()) / len(keys), sum(ry.values()) / len(keys)
    cov = sum((rx[k] - mx) * (ry[k] - my) for k in keys)
    sx = math.sqrt(sum((rx[k] - mx) ** 2 for k in keys))
    sy = math.sqrt(sum((ry[k] - my) ** 2 for k in keys))
    if sx == 0 or sy == 0:
        return None, len(keys)
    return round(cov / (sx * sy), 3), len(keys)


@dataclass(frozen=True)
class SensitivityRow:
    country: str
    track: str
    values: tuple[int, ...]
    scores: dict[str, float]


def gold_frontier_values(gold_path: Path, context: FrontierContext) -> dict[str, tuple[str, list[int]]]:
    """``country -> (track, applicable values)`` for every gold country with a
    frontier block: its gold scores plus the computed
    ``international_coordination``."""
    data = json.loads(gold_path.read_text(encoding="utf-8"))
    out: dict[str, tuple[str, list[int]]] = {}
    for entry in data.get("countries", []):
        block = entry.get("frontier")
        if not block:
            continue
        track = block["track"]
        values = []
        for name in FRONTIER_SUBINDICATORS:
            if not applies(name, track):
                continue
            if name in COMPUTED_SUBINDICATORS:
                values.append(context.international(entry["country"])[0])
            else:
                values.append(int(block["subscores"][name]))
        out[entry["country"]] = (track, values)
    return out


def sensitivity(values: Mapping[str, tuple[str, list[int]]]) -> tuple[list[SensitivityRow], dict]:
    """The three aggregations per country, and per method the Spearman
    correlation with the capped order and the largest rank move."""
    rows = [
        SensitivityRow(country, track, tuple(v), {name: fn(v) for name, fn in AGGREGATIONS.items()})
        for country, (track, v) in values.items()
    ]
    base = ranks({r.country: r.scores["capped"] for r in rows})
    summary: dict[str, dict] = {}
    for name in AGGREGATIONS:
        method = {r.country: r.scores[name] for r in rows}
        rank = ranks(method)
        moves = {c: abs(rank[c] - base[c]) for c in rank}
        summary[name] = {
            "spearman_vs_capped": spearman(method, {r.country: r.scores["capped"] for r in rows})[0],
            "max_rank_move": max(moves.values(), default=0),
            "countries_moved": sum(1 for m in moves.values() if m),
        }
    return rows, summary


def sensitivity_markdown(rows: list[SensitivityRow], summary: dict) -> str:
    out = [
        "## Frontier Risk Governance: aggregation sensitivity", "",
        "Gold countries' frontier scores under three aggregations of the applicable "
        "sub-indicators (international coordination computed). Ranks are within the gold set.",
        "", "| Country | Track | Values | Arithmetic | Geometric | Capped |",
        "|---------|-------|--------|------------|-----------|--------|",
    ]
    for r in sorted(rows, key=lambda r: -r.scores["capped"]):
        out.append(
            f"| {r.country} | {r.track} | {', '.join(map(str, r.values))} | "
            f"{r.scores['arithmetic']:.2f} | {r.scores['geometric']:.2f} | {r.scores['capped']:.2f} |"
        )
    out += ["", "| Method | Spearman vs capped | Largest rank move | Countries moved |",
            "|--------|--------------------|-------------------|-----------------|"]
    for name, s in summary.items():
        rho = "n/a" if s["spearman_vs_capped"] is None else f"{s['spearman_vs_capped']:.3f}"
        out.append(f"| {name} | {rho} | {s['max_rank_move']:g} | {s['countries_moved']} |")
    return "\n".join(out) + "\n"


@app.command("sensitivity")
def _sensitivity_cli() -> None:
    """Compare arithmetic, geometric and capped aggregation on the gold set."""
    settings = Settings()
    context = FrontierContext.load(settings)
    if context is None:
        raise typer.Exit(code=1)
    rows, summary = sensitivity(gold_frontier_values(settings.gold_set_json, context))
    typer.echo(sensitivity_markdown(rows, summary))


# -- behavioural checks (requirement 15) -------------------------------------------


def reverse_anchor_order(prompt: str) -> str:
    """The prompt with each frontier anchor list in reverse order (5 first),
    every definition unchanged."""
    for text in FRONTIER_ANCHORS.values():
        if text not in prompt:
            continue
        levels = [part.strip() for part in text.split("; ") if part[:1].isdigit()]
        prompt = prompt.replace(text, "; ".join(reversed(levels)))
    return prompt


# The lens's opening and rules in other words, same content. Kept apart from
# prompt.py so the production prompt has one wording.
PARAPHRASE = {
    "This lens rates " + FRONTIER_STANDARD + ".": (
        "Here you judge how well the national government is placed to detect, evaluate and "
        "halt a hazardous frontier AI model: how the state governs the risk of catastrophe from "
        "the most powerful general-purpose models (CBRN misuse, offensive cyber capability, loss "
        "of control, harmful manipulation), measured against a declared standard taken from "
        "the frontier AI safety governance literature."
    ),
    "Every score above 2 names the instrument, body or agreement in its rationale.": (
        "Whenever you give more than 2, the rationale must cite the law, institution or "
        "agreement concerned."
    ),
    'Voluntary frameworks or commitments support at most 2 on developer_obligations.': (
        "Commitments and frameworks that are not binding cannot take developer_obligations "
        "above 2."
    ),
}


def paraphrase(prompt: str) -> str:
    """The prompt with the lens's opening and two rules reworded."""
    flat = " ".join(prompt.split("\n"))
    for original, other in PARAPHRASE.items():
        flat = flat.replace(" ".join(original.split()), other)
    return flat


VARIANTS: dict[str, Callable[[str], str]] = {"reversed": reverse_anchor_order, "paraphrased": paraphrase}


def apply_variant(params: dict, variant: Callable[[str], str]) -> dict:
    """A copy of request ``params`` with ``variant`` applied to the prompt."""
    message = dict(params["messages"][0])
    message["content"] = variant(message["content"])
    return {**params, "messages": [message]}


def moved(baseline: Mapping[str, FrontierRecord], variant: Mapping[str, FrontierRecord]) -> dict:
    """How many researched frontier sub-indicators differ between two runs,
    over the countries both returned."""
    compared = changed = 0
    by_country: dict[str, list[str]] = {}
    for country in sorted(set(baseline) & set(variant)):
        for name in FRONTIER_SUBINDICATORS:
            if name in COMPUTED_SUBINDICATORS:
                continue
            a, b = baseline[country].subscores[name], variant[country].subscores[name]
            if a == NA:
                continue
            compared += 1
            if a != b:
                changed += 1
                by_country.setdefault(country, []).append(f"{name} {a} -> {b}")
    return {"compared": compared, "changed": changed, "by_country": by_country}


@app.command("behaviour")
def _behaviour_cli(
    model: str = typer.Option(..., "--model", help="Claude model to research with"),
    variant: str = typer.Option("reversed", "--variant", help="reversed or paraphrased"),
) -> None:
    """Re-research the gold countries with a prompt variant and report how
    many frontier sub-indicators move against the production prompt.
    Synchronous; needs ANTHROPIC_API_KEY. Writes nothing."""
    import anthropic

    from .api import ResearchClient, parse_message
    from .gold import load_gold_set
    from .models import ResearchResult
    from .names import CountryNames
    from .repository import Dataset
    from .retry import call_with_retries

    if variant not in VARIANTS:
        raise typer.BadParameter(f"variant must be one of {sorted(VARIANTS)}")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise typer.Exit(code=1)
    settings = Settings(default_model=model)
    context = FrontierContext.load(settings)
    if context is None:
        raise typer.Exit(code=1)
    gold = load_gold_set(settings.gold_set_json)
    dataset = Dataset.load(settings, CountryNames.load(settings.country_names_json))
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    research = ResearchClient(client, model=model, today=date.today(), frontier=context)

    runs: dict[str, dict[str, FrontierRecord]] = {"baseline": {}, variant: {}}
    for country in gold.frontier_names():
        params = research.request(country, dataset.regulation_row(country), use_search=True).params
        for label, sent in (("baseline", params), (variant, apply_variant(params, VARIANTS[variant]))):
            message = call_with_retries(lambda p=sent: client.messages.create(**p), label=country)
            message = research.resume(sent, message, country) if message is not None else None
            raw = parse_message(message, country) if message is not None else None
            if raw is None:
                continue
            answer = ResearchResult.parse(raw).frontier_answer()
            if answer is not None:
                runs[label][country] = context.assemble(country, answer)
    report = moved(runs["baseline"], runs[variant])
    typer.echo(json.dumps({"variant": variant, "model": model, **report}, indent=2))


# -- cross-validation (requirement 16) ---------------------------------------------


def read_index_csv(path: Path) -> dict[str, dict[str, float]]:
    """``column -> {country -> value}`` from a CSV with a ``country`` column
    and one numeric column per index. Empty cells are skipped."""
    out: dict[str, dict[str, float]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            country = (row.pop("country", "") or "").strip()
            for column, value in row.items():
                if country and value not in (None, ""):
                    out.setdefault(column, {})[country] = float(value)
    return out


def published_frontier(scores_csv: Path) -> dict[str, float]:
    """``country -> Frontier Risk`` from scores.csv, numeric cells only."""
    with scores_csv.open(newline="", encoding="utf-8") as f:
        return {
            row["Country"]: float(row["Frontier Risk"])
            for row in csv.DictReader(f) if (row.get("Frontier Risk") or "").strip()
        }


@app.command("crossval")
def _crossval_cli(
    indices: str = typer.Option(..., "--indices", help="CSV: country plus one column per external index"),
) -> None:
    """Spearman correlation of the published frontier scores with each
    external index column, as a Markdown table for the methodology page."""
    frontier = published_frontier(Settings().scores_csv)
    typer.echo("| Index | Spearman rho | Countries |\n|-------|--------------|-----------|")
    for column, values in read_index_csv(Path(indices)).items():
        rho, n = spearman(frontier, values)
        typer.echo(f"| {column} | {'n/a' if rho is None else f'{rho:.3f}'} | {n} |")


def main() -> None:
    app()


if __name__ == "__main__":  # pragma: no cover - exercised via python -m
    main()
