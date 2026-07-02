"""One-shot seed: bootstrap the Supabase database from the static files.

Reads the four stores (via the same :class:`Dataset` loader and
canonicalization the pipeline uses) plus ``country_iso.json``, and produces
the full initial contents of the ``countries`` / ``country_scores`` /
``country_summaries`` / ``score_history`` / ``sources`` /
``country_sources`` tables under a single ``research_runs(trigger='seed')``
provenance row.

Two output modes:

* ``--emit-sql DIR`` — write chunked, **idempotent** SQL files
  (``insert … on conflict do update``; foreign keys resolved by
  name/url subselects, so no client-side UUIDs). This is the path used
  where only privileged SQL execution is available (e.g. the Supabase MCP
  ``execute_sql`` tool). Re-emitting from unchanged data produces
  byte-identical files.
* ``--direct`` — apply through :class:`~regulation_pipeline.db.client.
  SupabaseClient` with ``SUPABASE_URL``/``SUPABASE_SERVICE_KEY`` env vars
  (two-phase: upsert parents, read back ids, upsert children).

The seed run id is a *deterministic* UUID so re-applying never duplicates
the provenance row.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

import typer

from ..config import Settings
from ..names import CountryNames
from ..repository import Dataset
from ..sources import classify_sources

logger = logging.getLogger(__name__)

SEED_RUN_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "airegulationmap/seed/v1"))

# History snapshots carry their date in the snapshot_date column; everything
# else in the file snapshot goes into the scores jsonb verbatim.
_SNAPSHOT_DATE_KEY = "date"


@dataclass
class SeedData:
    countries: list[dict] = field(default_factory=list)
    run: dict = field(default_factory=dict)
    scores: list[dict] = field(default_factory=list)        # keyed by 'country' name
    summaries: list[dict] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)       # unique by url
    links: list[dict] = field(default_factory=list)         # (country, url, dimension)


def _num(value) -> float | None:
    if value in (None, "", "NA"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _confidence(value) -> str | None:
    v = (value or "").strip().lower()
    return v if v in ("high", "medium", "low") else None


def build_seed(settings: Settings, names: CountryNames) -> SeedData:
    dataset = Dataset.load(settings, names)
    iso = json.loads(settings.country_iso_json.read_text(encoding="utf-8"))["countries"]
    history = json.loads(settings.history_json.read_text(encoding="utf-8"))["countries"]
    subscores = json.loads(settings.subscores_json.read_text(encoding="utf-8"))["countries"]

    # country_names.json maps alias -> canonical; the countries table wants
    # the reverse (canonical -> [aliases]).
    aliases_by_canonical: dict[str, list[str]] = {}
    raw_aliases = json.loads(settings.country_names_json.read_text(encoding="utf-8")).get("aliases", {})
    for alias, canonical in raw_aliases.items():
        aliases_by_canonical.setdefault(canonical, []).append(alias)

    seed = SeedData()
    seed.run = {
        "id": SEED_RUN_ID,
        "trigger": "seed",
        "notes": "Initial seed from the static files in public/.",
    }

    seen_urls: set[str] = set()
    for country in dataset.countries():
        codes = iso.get(country) or {}
        seed.countries.append({
            "name": country,
            "iso3": codes.get("iso3"),
            "iso2": codes.get("iso2"),
            "iso_numeric": codes.get("numeric"),
            "aliases": sorted(aliases_by_canonical.get(country, [])),
        })

        srow = dataset.scores_row(country) or {}
        rrow = dataset.regulation_row(country) or {}
        seed.scores.append({
            "country": country,
            "regulation_status": _num(srow.get("Regulation Status")),
            "policy_lever": _num(srow.get("Policy Lever")),
            "governance_type": _num(srow.get("Governance Type")),
            "actor_involvement": _num(srow.get("Actor Involvement")),
            "enforcement_level": _num(srow.get("Enforcement Level")),
            "avg_score": _num(srow.get("Average Score")),
            "subscores": subscores.get(country),
            "confidence": _confidence(rrow.get("Confidence")),
            "data_version": int(srow.get("Data Version") or 1),
            "scored_at": srow.get("Last Updated") or None,
        })
        seed.summaries.append({
            "country": country,
            "regulation_status_text": rrow.get("Regulation Status") or None,
            "policy_lever_text": rrow.get("Policy Lever") or None,
            "governance_type_text": rrow.get("Governance Type") or None,
            "actor_involvement_text": rrow.get("Actor Involvement") or None,
            "enforcement_level_text": rrow.get("Enforcement Level") or None,
            "specific_laws": rrow.get("Specific Laws") or None,
            "sources_raw": rrow.get("Sources") or None,
            "summarized_at": rrow.get("Last Updated") or None,
        })

        for snap in history.get(country, []):
            seed.history.append({
                "country": country,
                "snapshot_date": snap[_SNAPSHOT_DATE_KEY],
                "scores": {k: v for k, v in snap.items() if k != _SNAPSHOT_DATE_KEY},
            })

        for src in classify_sources(rrow.get("Sources")):
            if src.url not in seen_urls:
                seen_urls.add(src.url)
                seed.sources.append({
                    "url": src.url,
                    "domain": src.domain,
                    "source_type": src.source_type,
                })
            seed.links.append({"country": country, "url": src.url, "dimension": "general"})

    return seed


# -- SQL emission ---------------------------------------------------------------


def _sql_str(value: str | None) -> str:
    if value is None:
        return "null"
    return "'" + value.replace("'", "''") + "'"


def _sql_num(value) -> str:
    return "null" if value is None else str(value)


def _sql_jsonb(value) -> str:
    if value is None:
        return "null"
    return _sql_str(json.dumps(value, ensure_ascii=False, sort_keys=True)) + "::jsonb"


def _sql_text_array(values: list[str]) -> str:
    if not values:
        return "'{}'::text[]"
    return "array[" + ", ".join(_sql_str(v) for v in values) + "]::text[]"


def emit_sql(seed: SeedData) -> list[str]:
    """Every statement needed, in dependency order, each idempotent."""
    stmts: list[str] = []

    stmts.append(
        "insert into research_runs (id, trigger, finished_at, notes)\n"
        f"values ({_sql_str(seed.run['id'])}, {_sql_str(seed.run['trigger'])}, now(), {_sql_str(seed.run['notes'])})\n"
        "on conflict (id) do nothing;"
    )

    for c in seed.countries:
        stmts.append(
            "insert into countries (name, iso3, iso2, iso_numeric, aliases)\n"
            f"values ({_sql_str(c['name'])}, {_sql_str(c['iso3'])}, {_sql_str(c['iso2'])}, "
            f"{_sql_str(c['iso_numeric'])}, {_sql_text_array(c['aliases'])})\n"
            "on conflict (name) do update set iso3 = excluded.iso3, iso2 = excluded.iso2, "
            "iso_numeric = excluded.iso_numeric, aliases = excluded.aliases, updated_at = now();"
        )

    for s in seed.scores:
        stmts.append(
            "insert into country_scores (country_id, regulation_status, policy_lever, governance_type, "
            "actor_involvement, enforcement_level, avg_score, subscores, confidence, data_version, run_id, scored_at)\n"
            f"select id, {_sql_num(s['regulation_status'])}, {_sql_num(s['policy_lever'])}, "
            f"{_sql_num(s['governance_type'])}, {_sql_num(s['actor_involvement'])}, "
            f"{_sql_num(s['enforcement_level'])}, {_sql_num(s['avg_score'])}, {_sql_jsonb(s['subscores'])}, "
            f"{_sql_str(s['confidence'])}, {s['data_version']}, {_sql_str(SEED_RUN_ID)}, {_sql_str(s['scored_at'])}\n"
            f"from countries where name = {_sql_str(s['country'])}\n"
            "on conflict (country_id) do update set regulation_status = excluded.regulation_status, "
            "policy_lever = excluded.policy_lever, governance_type = excluded.governance_type, "
            "actor_involvement = excluded.actor_involvement, enforcement_level = excluded.enforcement_level, "
            "avg_score = excluded.avg_score, subscores = excluded.subscores, confidence = excluded.confidence, "
            "data_version = excluded.data_version, run_id = excluded.run_id, scored_at = excluded.scored_at, "
            "updated_at = now();"
        )

    for s in seed.summaries:
        stmts.append(
            "insert into country_summaries (country_id, regulation_status_text, policy_lever_text, "
            "governance_type_text, actor_involvement_text, enforcement_level_text, specific_laws, "
            "sources_raw, run_id, summarized_at)\n"
            f"select id, {_sql_str(s['regulation_status_text'])}, {_sql_str(s['policy_lever_text'])}, "
            f"{_sql_str(s['governance_type_text'])}, {_sql_str(s['actor_involvement_text'])}, "
            f"{_sql_str(s['enforcement_level_text'])}, {_sql_str(s['specific_laws'])}, "
            f"{_sql_str(s['sources_raw'])}, {_sql_str(SEED_RUN_ID)}, {_sql_str(s['summarized_at'])}\n"
            f"from countries where name = {_sql_str(s['country'])}\n"
            "on conflict (country_id) do update set regulation_status_text = excluded.regulation_status_text, "
            "policy_lever_text = excluded.policy_lever_text, governance_type_text = excluded.governance_type_text, "
            "actor_involvement_text = excluded.actor_involvement_text, "
            "enforcement_level_text = excluded.enforcement_level_text, specific_laws = excluded.specific_laws, "
            "sources_raw = excluded.sources_raw, run_id = excluded.run_id, "
            "summarized_at = excluded.summarized_at, updated_at = now();"
        )

    for h in seed.history:
        stmts.append(
            "insert into score_history (country_id, snapshot_date, scores, run_id)\n"
            f"select id, {_sql_str(h['snapshot_date'])}, {_sql_jsonb(h['scores'])}, {_sql_str(SEED_RUN_ID)}\n"
            f"from countries where name = {_sql_str(h['country'])}\n"
            "on conflict (country_id, snapshot_date) do update set scores = excluded.scores;"
        )

    for s in seed.sources:
        stmts.append(
            "insert into sources (url, domain, source_type)\n"
            f"values ({_sql_str(s['url'])}, {_sql_str(s['domain'])}, {_sql_str(s['source_type'])})\n"
            "on conflict (url) do update set domain = excluded.domain, "
            "source_type = excluded.source_type, last_seen = now();"
        )

    for link in seed.links:
        stmts.append(
            "insert into country_sources (country_id, source_id, dimension, run_id)\n"
            f"select c.id, s.id, {_sql_str(link['dimension'])}, {_sql_str(SEED_RUN_ID)}\n"
            f"from countries c, sources s where c.name = {_sql_str(link['country'])} and s.url = {_sql_str(link['url'])}\n"
            "on conflict (country_id, source_id, dimension) do update set last_cited = now();"
        )

    return stmts


def write_sql_chunks(stmts: list[str], out_dir: Path, max_chars: int = 90_000) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[list[str]] = [[]]
    size = 0
    for stmt in stmts:
        if size + len(stmt) > max_chars and chunks[-1]:
            chunks.append([])
            size = 0
        chunks[-1].append(stmt)
        size += len(stmt)

    paths: list[Path] = []
    for i, chunk in enumerate(chunks, start=1):
        path = out_dir / f"seed_{i:04d}.sql"
        path.write_text("\n\n".join(chunk) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


# -- direct application -----------------------------------------------------------


def apply_direct(seed: SeedData, client) -> None:
    """Two-phase apply through PostgREST: upsert parents (no ids sent — see
    SupabaseClient.upsert), read the generated ids back, then upsert children
    with resolved foreign keys."""
    client.upsert("research_runs", [seed.run], on_conflict="id")
    client.upsert("countries", seed.countries, on_conflict="name")
    client.upsert("sources", seed.sources, on_conflict="url")

    country_ids = {r["name"]: r["id"] for r in client.select("countries", {"select": "id,name"})}
    source_ids = {r["url"]: r["id"] for r in client.select("sources", {"select": "id,url", "limit": "100000"})}

    def with_country(rows: list[dict]) -> list[dict]:
        out = []
        for row in rows:
            row = dict(row)
            row["country_id"] = country_ids[row.pop("country")]
            row["run_id"] = SEED_RUN_ID
            out.append(row)
        return out

    client.upsert("country_scores", with_country(seed.scores), on_conflict="country_id")
    client.upsert("country_summaries", with_country(seed.summaries), on_conflict="country_id")
    client.upsert("score_history", with_country(seed.history), on_conflict="country_id,snapshot_date")
    client.upsert(
        "country_sources",
        [
            {
                "country_id": country_ids[link["country"]],
                "source_id": source_ids[link["url"]],
                "dimension": link["dimension"],
                "run_id": SEED_RUN_ID,
            }
            for link in seed.links
        ],
        on_conflict="country_id,source_id,dimension",
    )


# -- CLI ---------------------------------------------------------------------------

app = typer.Typer(add_completion=False)


@app.command()
def main(
    emit_sql_dir: Annotated[
        Path | None,
        typer.Option("--emit-sql", help="Write chunked idempotent SQL files here instead of applying."),
    ] = None,
    direct: bool = typer.Option(False, "--direct", help="Apply via PostgREST using SUPABASE_URL/SUPABASE_SERVICE_KEY."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Build and report counts, write/apply nothing."),
) -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = Settings().validate()
    names = CountryNames.load(settings.country_names_json)
    seed = build_seed(settings, names)
    logger.info(
        "seed: %d countries, %d score rows, %d summaries, %d history snapshots, %d sources, %d links",
        len(seed.countries), len(seed.scores), len(seed.summaries),
        len(seed.history), len(seed.sources), len(seed.links),
    )
    if dry_run:
        return
    if emit_sql_dir is not None:
        paths = write_sql_chunks(emit_sql(seed), emit_sql_dir)
        logger.info("wrote %d SQL chunks to %s", len(paths), emit_sql_dir)
        return
    if direct:
        from .client import SupabaseClient

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise typer.BadParameter("--direct needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment")
        with SupabaseClient(url, key) as client:
            apply_direct(seed, client)
        logger.info("seed applied directly")
        return
    raise typer.BadParameter("choose one of --emit-sql DIR, --direct, or --dry-run")


if __name__ == "__main__":
    app()
