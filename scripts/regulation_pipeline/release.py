"""Versioned dataset releases: release notes and the Zenodo DOI lookup behind
``public/data/release.json`` (PRD 10).

The data-release workflow (``.github/workflows/data-release.yml``) tags each
weekly data commit ``data-YYYY-Www``, creates a GitHub release with the four
data files attached, and, once Zenodo has archived the release and minted a
DOI, records the version here::

    {"tag": "data-2026-W39", "date": "2026-09-21",
     "doi": "10.5281/zenodo.1234567", "concept_doi": "10.5281/zenodo.1234566",
     "sandbox": false}

The app's citation formatter (``src/controls/citation.ts``) quotes the tag
and the DOI. ``sandbox`` marks DOIs from the Zenodo sandbox, which never
resolve, so the app names the version without them.

Two commands (``python -m regulation_pipeline.release``):

* ``notes`` prints the release body in Markdown: the data commit, the week's
  digest (``public/digest/<week>.json``) when the run wrote one, the run's
  gold-set drift row, and the update workflow's run summary when the
  workflow handed one over.
* ``doi`` polls the Zenodo API for the record the GitHub integration created
  for the tag and writes ``release.json``. Minting is asynchronous, so it
  retries; when the DOI is still missing after the last attempt it writes the
  file with ``doi: null`` so the citation can at least name the version. It
  exits 0 either way: nothing here may fail a data commit.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import typer

from .config import SITE_URL
from .digest import week_of

logger = logging.getLogger(__name__)

REPO = "riadeane/airegulationmap"
ZENODO_SANDBOX_API = "https://sandbox.zenodo.org/api"
ZENODO_API = "https://zenodo.org/api"
# The files a release attaches; a data commit is one that changes any of them.
DATA_FILES = (
    "public/scores.csv",
    "public/regulation_data.csv",
    "public/history.json",
    "public/data/subscores.json",
)
_SEARCH_PAGE = 50


def week_tag(day: date) -> str:
    """The release tag for a data commit dated ``day``: ``data-YYYY-Www`` (ISO week)."""
    return f"data-{week_of(day)}"


def is_sandbox(api_base: str) -> bool:
    """True for the Zenodo sandbox, whose DOIs (prefix 10.5072) never resolve."""
    return "sandbox" in (urlparse(api_base).netloc or api_base)


# -- Zenodo records ---------------------------------------------------------------


@dataclass(frozen=True)
class ZenodoRecord:
    """The DOIs of one Zenodo record: the version DOI and the concept DOI
    shared by every version."""

    doi: str
    concept_doi: str | None
    version: str | None
    record_id: str | None


def _pid_doi(pids: Any) -> str | None:
    if isinstance(pids, dict):
        doi = pids.get("doi")
        if isinstance(doi, dict) and isinstance(doi.get("identifier"), str):
            return doi["identifier"] or None
    return None


def parse_record(hit: Any) -> ZenodoRecord | None:
    """Read the DOIs off one record. Zenodo has served two serializations
    (the ``doi`` / ``conceptdoi`` keys, and the InvenioRDM ``pids`` /
    ``parent`` tree since 2023); accept both, and reject a hit without a DOI."""
    if not isinstance(hit, dict):
        return None
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    doi = hit.get("doi") or _pid_doi(hit.get("pids")) or metadata.get("doi")
    if not isinstance(doi, str) or not doi:
        return None
    parent = hit.get("parent") if isinstance(hit.get("parent"), dict) else {}
    concept = hit.get("conceptdoi") or _pid_doi(parent.get("pids"))
    version = metadata.get("version")
    record_id = hit.get("id")
    return ZenodoRecord(
        doi=doi,
        concept_doi=concept if isinstance(concept, str) and concept else None,
        version=version if isinstance(version, str) else None,
        record_id=str(record_id) if record_id is not None else None,
    )


def record_matches(hit: Any, tag: str, repo: str = REPO) -> bool:
    """True when ``hit`` is the record the GitHub integration made for ``tag``:
    its version is the tag, or a related identifier is the tag's tree URL
    (the integration adds ``https://github.com/<repo>/tree/<tag>``)."""
    if not isinstance(hit, dict):
        return False
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    if metadata.get("version") == tag:
        return True
    tree = f"https://github.com/{repo}/tree/{tag}"
    related = metadata.get("related_identifiers")
    if not isinstance(related, list):
        return False
    return any(isinstance(rel, dict) and rel.get("identifier") == tree for rel in related)


def match_record(hits: Any, tag: str, repo: str = REPO) -> ZenodoRecord | None:
    """The first hit that is ``tag``'s record and carries a DOI."""
    if not isinstance(hits, list):
        return None
    for hit in hits:
        if record_matches(hit, tag, repo):
            record = parse_record(hit)
            if record:
                return record
    return None


def search_queries(tag: str) -> list[str]:
    """Search strings tried in order. The field that holds the version is named
    differently across Zenodo's serializations, and an unknown field simply
    matches nothing, so the last query is a plain phrase search."""
    return [f'metadata.version:"{tag}"', f'version:"{tag}"', f'"{tag}"']


def concept_record_id(concept_doi: str) -> str:
    """``10.5281/zenodo.1234566`` -> ``1234566`` (the concept record id)."""
    return concept_doi.rsplit(".", 1)[-1]


def _get_json(client: httpx.Client, url: str, params: dict[str, Any] | None = None) -> Any:
    try:
        response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        logger.warning("zenodo: %s: %s", url, exc)
        return None
    if response.status_code != 200:
        logger.warning("zenodo: %s -> HTTP %s", url, response.status_code)
        return None
    try:
        return response.json()
    except ValueError:
        logger.warning("zenodo: %s returned no JSON", url)
        return None


def find_record(
    client: httpx.Client,
    api_base: str,
    tag: str,
    *,
    repo: str = REPO,
    concept_doi: str | None = None,
) -> ZenodoRecord | None:
    """One lookup pass. With a known concept DOI the concept record (which
    resolves to the latest version) is checked first: no search index to
    wait for, and no page limit to fall off after a year of weekly versions.
    The search is the path for the first release."""
    base = api_base.rstrip("/")
    if concept_doi:
        hit = _get_json(client, f"{base}/records/{concept_record_id(concept_doi)}")
        if record_matches(hit, tag, repo):
            record = parse_record(hit)
            if record:
                return record
    for query in search_queries(tag):
        payload = _get_json(
            client,
            f"{base}/records",
            {"q": query, "all_versions": "true", "size": _SEARCH_PAGE},
        )
        hits = payload.get("hits") if isinstance(payload, dict) else None
        record = match_record(hits.get("hits") if isinstance(hits, dict) else None, tag, repo)
        if record:
            return record
    return None


def lookup_doi(
    client: httpx.Client,
    api_base: str,
    tag: str,
    *,
    repo: str = REPO,
    concept_doi: str | None = None,
    attempts: int = 20,
    interval: float = 60.0,
    sleep: Callable[[float], None] = time.sleep,
) -> ZenodoRecord | None:
    """Poll until the record exists or ``attempts`` are spent. Zenodo mints the
    DOI when its GitHub webhook has archived the release, usually within a
    minute or two of the release being published."""
    for attempt in range(1, max(attempts, 1) + 1):
        record = find_record(client, api_base, tag, repo=repo, concept_doi=concept_doi)
        if record:
            logger.info("zenodo: %s -> %s (attempt %d)", tag, record.doi, attempt)
            return record
        if attempt < attempts:
            logger.info(
                "zenodo: no record for %s yet (attempt %d/%d); waiting %ss",
                tag, attempt, attempts, interval,
            )
            sleep(interval)
    return None


# -- release.json ------------------------------------------------------------------


def load_release(path: Path) -> dict | None:
    """The current release.json document, or None when absent or unreadable."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return document if isinstance(document, dict) else None


def release_payload(
    tag: str,
    day: date,
    record: ZenodoRecord | None,
    *,
    sandbox: bool,
    previous: dict | None = None,
) -> dict:
    """The release.json document. Without a record the version DOI is null.
    The concept DOI never changes, so it is carried over from the previous
    file when that came from the same Zenodo instance."""
    concept = record.concept_doi if record else None
    if concept is None and previous and bool(previous.get("sandbox", False)) == sandbox:
        carried = previous.get("concept_doi")
        concept = carried if isinstance(carried, str) and carried else None
    return {
        "tag": tag,
        "date": day.isoformat(),
        "doi": record.doi if record else None,
        "concept_doi": concept,
        "sandbox": sandbox,
    }


def write_release(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# -- release notes -------------------------------------------------------------


def load_week_digest(digest_dir: Path, week: str) -> dict | None:
    """``public/digest/<week>.json`` when the run wrote one."""
    try:
        document = json.loads((digest_dir / f"{week}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return document if isinstance(document, dict) else None


def drift_row_for(drift_path: Path, day: date) -> dict | None:
    """The last gold-set drift row recorded on ``day`` (one per run)."""
    try:
        document = json.loads(drift_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    checks = document.get("checks") if isinstance(document, dict) else None
    if not isinstance(checks, list):
        return None
    rows = [row for row in checks if isinstance(row, dict) and row.get("date") == day.isoformat()]
    return rows[-1] if rows else None


def render_notes(
    tag: str,
    commit: str,
    day: date,
    *,
    digest: dict | None = None,
    drift: dict | None = None,
    summary: str | None = None,
    site: str = SITE_URL,
) -> str:
    """The GitHub release body: what the snapshot is, what changed in it, how
    far the model sat from the gold set, and the update run's own summary."""
    week = tag.removeprefix("data-")
    lines = [
        f"Weekly snapshot of the AI Regulation Map dataset for ISO week {week}: "
        f"data commit `{commit[:7]}` ({day.isoformat()}).",
        "",
        "Attached: `scores.csv`, `regulation_data.csv`, `history.json` and `subscores.json`. "
        "Zenodo archives the repository at this tag, which holds the same files under "
        f"`public/`. How the scores are constructed: {site}/methodology.html.",
    ]
    if digest:
        lead = digest.get("lead")
        lines += ["", "## This week", ""]
        if isinstance(lead, str) and lead:
            lines.append(lead)
        items = digest.get("items")
        if isinstance(items, list) and items:
            lines.append("")
            for item in items:
                if not isinstance(item, dict):
                    continue
                country = item.get("country", "")
                headline = item.get("headline", "")
                lines.append(f"- **{country}**: {headline}".rstrip(": "))
        lines += ["", f"Full digest: {site}/changes.html?week={week}"]
    if drift:
        lines += [
            "",
            "## Drift check",
            "",
            f"Model `{drift.get('model', '?')}`, prompt `{drift.get('prompt_version', '?')}`: "
            f"share of gold-set sub-indicators within one point {drift.get('within_one', '?')}, "
            f"largest deviation {drift.get('max_dev', '?')}.",
        ]
    if summary and summary.strip():
        lines += ["", "## Run summary", "", summary.strip()]
    return "\n".join(lines) + "\n"


# -- CLI ---------------------------------------------------------------------------

app = typer.Typer(add_completion=False, help="Dataset releases: release notes and the Zenodo DOI.")


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise typer.BadParameter(f"expected YYYY-MM-DD, got {value!r}") from exc


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


@app.command("notes")
def _notes(
    tag: str = typer.Option(..., "--tag", help="Release tag, data-YYYY-Www"),
    commit: str = typer.Option(..., "--commit", help="The data commit's SHA"),
    day: str = typer.Option(..., "--date", help="The data commit's date, YYYY-MM-DD"),
    digest_dir: str = typer.Option("public/digest", help="Weekly digest directory"),
    drift: str = typer.Option("public/data/drift.json", help="Gold-set drift file"),
    summary: str = typer.Option("", help="The update run's summary (Markdown) to append"),
) -> None:
    """Print the release body for ``--tag``."""
    when = _parse_day(day)
    summary_text = Path(summary).read_text(encoding="utf-8") if summary else None
    typer.echo(
        render_notes(
            tag, commit, when,
            digest=load_week_digest(Path(digest_dir), tag.removeprefix("data-")),
            drift=drift_row_for(Path(drift), when),
            summary=summary_text,
        ),
        nl=False,
    )


def make_client(
    token: str | None, transport: httpx.BaseTransport | None = None
) -> httpx.Client:
    """The Zenodo HTTP client. The token is optional for reading public records
    but keeps the lookup inside the account's rate limit; the concept record
    URL redirects to the latest version, hence ``follow_redirects``. Tests
    pass a mock ``transport``."""
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(
        timeout=30.0, follow_redirects=True, headers=headers, transport=transport
    )


@app.command("doi")
def _doi(
    tag: str = typer.Option(..., "--tag", help="Release tag, data-YYYY-Www"),
    day: str = typer.Option(..., "--date", help="The data commit's date, YYYY-MM-DD"),
    out: str = typer.Option("public/data/release.json", help="Where to write release.json"),
    api_base: str = typer.Option(
        ZENODO_SANDBOX_API, "--api-base", envvar="ZENODO_API_BASE",
        help="Zenodo API root: the sandbox by default, https://zenodo.org/api in production",
    ),
    token: str = typer.Option("", "--token", envvar="ZENODO_TOKEN", help="Zenodo access token"),
    concept_doi: str = typer.Option(
        "", "--concept-doi", envvar="ZENODO_CONCEPT_DOI",
        help="Known concept DOI (else carried over from the previous release.json)",
    ),
    repo: str = typer.Option(REPO, help="GitHub repository the releases belong to"),
    attempts: int = typer.Option(20, help="Lookup attempts before giving up"),
    interval: float = typer.Option(60.0, help="Seconds between attempts"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose (DEBUG) logging"),
) -> None:
    """Look the release's DOI up on Zenodo and write release.json. Never fails."""
    _configure_logging(verbose)
    when = _parse_day(day)
    path = Path(out)
    sandbox = is_sandbox(api_base)
    previous = load_release(path)
    known_concept = concept_doi or None
    if known_concept is None and previous and bool(previous.get("sandbox", False)) == sandbox:
        carried = previous.get("concept_doi")
        known_concept = carried if isinstance(carried, str) and carried else None
    if not token:
        logger.warning("zenodo: no token (ZENODO_TOKEN); reading public records anonymously")

    with make_client(token or None) as client:
        record = lookup_doi(
            client, api_base, tag,
            repo=repo, concept_doi=known_concept, attempts=attempts, interval=interval,
        )
    payload = release_payload(tag, when, record, sandbox=sandbox, previous=previous)
    write_release(path, payload)

    if record:
        typer.echo(
            f"release: {tag} doi={payload['doi']} concept_doi={payload['concept_doi']} "
            f"sandbox={str(sandbox).lower()} -> {path}"
        )
    else:
        typer.echo(
            f"release: no Zenodo record for {tag} after {attempts} attempt(s); wrote {path} "
            f"with doi null. Re-run the Data Release workflow with tag={tag} once Zenodo "
            "has minted it."
        )
    outputs = os.environ.get("GITHUB_OUTPUT")
    if outputs:
        with open(outputs, "a", encoding="utf-8") as handle:
            handle.write(f"doi={payload['doi'] or ''}\n")
            handle.write(f"concept_doi={payload['concept_doi'] or ''}\n")
            handle.write(f"sandbox={str(sandbox).lower()}\n")


def main() -> None:
    app()


if __name__ == "__main__":  # pragma: no cover - exercised via python -m
    main()
