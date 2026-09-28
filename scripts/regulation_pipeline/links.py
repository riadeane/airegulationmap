"""Source link checks: drop dead cited URLs before they are published, and
read each live page's title on the way (#92, #143).

A link check of the committed data (September 2026) found 102 of 739 cited
URLs dead, including every ``oecd.ai/en/dashboards/countries/<Name>`` URL,
whose slugs the model guessed. :class:`LinkChecker` fetches each cited URL
once per run (GET, redirects followed, the first 64 KB of an HTML body
read) and sorts it into one of three states:

* ``dead`` - HTTP 404 or 410, a redirect that lands on a not-found page, a
  200 whose title says the page was not found, or a known-bad URL pattern
  (checked without a request). Dead URLs are dropped from the result.
* ``ok`` - any other 2xx or 3xx answer. The page title (``og:title``, else
  ``<title>``) is kept for the sources database.
* ``unknown`` - everything else: 401/403 and 429 (usually bot blocking),
  5xx, timeouts, TLS and connection errors. Unknown URLs are kept: a site
  that blocks the checker is not evidence that the page is gone.

Dropping a URL re-validates the result, so a result left with no source is
capped at low confidence exactly like an unsourced one
(``ResearchResult._cap_unsourced_confidence``).

``python -m regulation_pipeline.links report`` checks every URL in
``regulation_data.csv`` and prints the dead ones as Markdown (the monthly
link-check workflow opens an issue with it); ``titles`` fills
``sources.title`` in Supabase for rows that have none.
"""

from __future__ import annotations

import csv
import html
import logging
import os
import re
import sys
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx
import typer

from .models import ResearchResult
from .sources import classify_source, classify_sources

logger = logging.getLogger(__name__)

OK = "ok"
DEAD = "dead"
UNKNOWN = "unknown"

# URL patterns known to be dead, dropped without a request. The OECD.AI
# country dashboards moved; the old slugs 404 for every country.
BLOCKED_PATTERNS = (
    re.compile(r"^(?:https?://)?(?:www\.)?oecd\.ai/en/dashboards/countries/", re.IGNORECASE),
)

DEAD_STATUSES = frozenset({404, 410})

# A redirect whose final path names a not-found page ("/page-not-found",
# "/404.html", "/en/not-found").
_NOT_FOUND_PATH_RE = re.compile(
    r"(?:^|/)(?:404|page-?not-?found|pagenotfound|not-?found|error-?404)(?:$|[/.?#])",
    re.IGNORECASE,
)
# A 200 page whose title says it is a not-found page. Anchored at the start
# so a title that merely mentions "404" further in is not caught.
_NOT_FOUND_TITLE_RE = re.compile(
    r"^\s*(?:404\b|error 404|page not found|not found|page introuvable|"
    r"p[aá]gina no encontrada|pagina non trovata|seite nicht gefunden|"
    r"pagina niet gevonden|p[aá]gina n[aã]o encontrada)",
    re.IGNORECASE,
)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)
_META_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_ATTR_RE = re.compile(r"""([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")

# Enough of an HTML page to reach its <head>.
MAX_BODY_BYTES = 64 * 1024
MAX_TITLE_CHARS = 300
# httpx's timeout bounds each connect and read; the body read also stops at
# this total per URL, so a server trickling bytes cannot hold a check. With
# 8 workers and ~5 URLs per country, a run's check stays within minutes
# even when many hosts hang.
TIMEOUT_SECONDS = 10.0
WORKERS = 8
# A browser-like agent: many government sites answer 403 to unknown bots,
# which the checker would have to treat as unknown.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0 Safari/537.36 (AI Regulation Map link check; +https://airegulationmap.org)"
)


@dataclass(frozen=True)
class LinkStatus:
    """One URL's check: ``state`` is :data:`OK`, :data:`DEAD` or
    :data:`UNKNOWN`; ``reason`` says why; ``title`` is the page title when
    the page answered with HTML."""

    url: str
    state: str
    reason: str
    title: str | None = None


def is_blocked(url: str) -> bool:
    return any(pattern.search(url.strip()) for pattern in BLOCKED_PATTERNS)


def page_title(body: str) -> str | None:
    """The page's ``og:title``, else its ``<title>``, unescaped and with
    whitespace collapsed; ``None`` when it has neither."""
    for tag in _META_RE.findall(body):
        attrs = {m.group(1).lower(): m.group(2) if m.group(2) is not None else m.group(3)
                 for m in _ATTR_RE.finditer(tag)}
        if (attrs.get("property") or attrs.get("name") or "").lower() == "og:title" and attrs.get("content"):
            return _clean_title(attrs["content"])
    match = _TITLE_RE.search(body)
    return _clean_title(match.group(1)) if match else None


def _clean_title(text: str) -> str | None:
    title = " ".join(html.unescape(text).split())
    return title[:MAX_TITLE_CHARS] or None


class LinkChecker:
    """Checks URLs over one ``httpx.Client``, each URL at most once per
    instance. ``client`` is injectable so tests use ``httpx.MockTransport``."""

    def __init__(self, client: httpx.Client | None = None, *, workers: int = WORKERS):
        self._client = client or httpx.Client(
            follow_redirects=True,
            timeout=TIMEOUT_SECONDS,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"},
        )
        self._workers = workers
        self._cache: dict[str, LinkStatus] = {}

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> LinkChecker:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def check(self, urls: Iterable[str]) -> dict[str, LinkStatus]:
        """Check each URL (in parallel, cached), keyed by URL."""
        wanted = list(dict.fromkeys(urls))
        todo = [url for url in wanted if url not in self._cache]
        if todo:
            with ThreadPoolExecutor(max_workers=self._workers) as pool:
                for status in pool.map(self._check_one, todo):
                    self._cache[status.url] = status
        return {url: self._cache[url] for url in wanted}

    def filter_result(self, result: ResearchResult) -> tuple[ResearchResult, list[LinkStatus]]:
        """``result`` without its dead URLs, with the live pages' titles
        attached (``ResearchResult.source_titles``), and the dropped
        statuses. A result that loses a URL is re-validated, so one left
        with no source is capped at low confidence."""
        urls = [source.url for source in classify_sources(result.sources)]
        statuses = self.check(urls)
        dead = [statuses[url] for url in urls if statuses[url].state == DEAD]
        titles = {url: s.title for url, s in statuses.items() if s.state == OK and s.title}
        if dead:
            dead_urls = {s.url for s in dead}
            kept = " | ".join(url for url in urls if url not in dead_urls)
            filtered = ResearchResult.model_validate({**result.model_dump(), "sources": kept})
            filtered.with_provenance(result.provenance)
            result = filtered
        return result.with_source_titles(titles), dead

    def _check_one(self, url: str) -> LinkStatus:
        if is_blocked(url):
            return LinkStatus(url, DEAD, "known-bad URL pattern")
        target = url if "://" in url else f"https://{url}"
        try:
            with self._client.stream("GET", target) as response:
                return _classify(url, response)
        except httpx.TimeoutException:
            return LinkStatus(url, UNKNOWN, "timeout")
        except (httpx.HTTPError, ValueError) as exc:
            return LinkStatus(url, UNKNOWN, type(exc).__name__)


def _classify(url: str, response: httpx.Response) -> LinkStatus:
    status = response.status_code
    if status in DEAD_STATUSES:
        return LinkStatus(url, DEAD, f"HTTP {status}")
    if status >= 400:
        return LinkStatus(url, UNKNOWN, f"HTTP {status}")
    final = response.url
    if response.history and _NOT_FOUND_PATH_RE.search(final.path or ""):
        return LinkStatus(url, DEAD, f"redirects to {final}")
    title = None
    if "html" in response.headers.get("content-type", "").lower():
        title = page_title(_read_head(response))
    if title and _NOT_FOUND_TITLE_RE.match(title):
        return LinkStatus(url, DEAD, f"not-found page ({title})")
    return LinkStatus(url, OK, f"HTTP {status}", title)


def _read_head(response: httpx.Response) -> str:
    chunks: list[bytes] = []
    size = 0
    deadline = time.monotonic() + TIMEOUT_SECONDS
    for chunk in response.iter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= MAX_BODY_BYTES or time.monotonic() > deadline:
            break
    raw = b"".join(chunks)[:MAX_BODY_BYTES]
    return raw.decode(response.encoding or "utf-8", errors="replace")


# -- CLI -------------------------------------------------------------------------

app = typer.Typer(add_completion=False, help=__doc__.split("\n\n")[0])


@app.command()
def report(
    path: str = typer.Option("public/regulation_data.csv", help="The regulation CSV to check"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Check every cited URL and print the dead ones as Markdown. Exits 0
    with no output when none is dead."""
    from .cli import configure_logging

    configure_logging(verbose)
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_country = {row["Country"]: [s.url for s in classify_sources(row.get("Sources"))] for row in rows}
    with LinkChecker() as checker:
        statuses = checker.check(url for urls in by_country.values() for url in urls)
    print(render_report(by_country, statuses), end="")


def render_report(by_country: dict[str, list[str]], statuses: dict[str, LinkStatus]) -> str:
    """Markdown list of the dead URLs per country, plus a count of the
    unknown ones; empty when nothing is dead."""
    dead_by_country = {
        country: [statuses[url] for url in urls if statuses[url].state == DEAD]
        for country, urls in sorted(by_country.items())
    }
    dead_by_country = {c: d for c, d in dead_by_country.items() if d}
    if not dead_by_country:
        return ""
    total = len(statuses)
    dead = sum(1 for s in statuses.values() if s.state == DEAD)
    unknown = sum(1 for s in statuses.values() if s.state == UNKNOWN)
    left_bare = [
        country for country, urls in sorted(by_country.items())
        if urls and all(statuses[url].state == DEAD for url in urls)
    ]
    out = [
        f"{dead} of {total} cited URLs are dead (404, 410, a not-found page, or a known-bad pattern). "
        f"{unknown} could not be checked (blocked, timed out or erroring) and are not listed.",
        "",
    ]
    if left_bare:
        out += [f"Countries with no working source: {', '.join(left_bare)}.", ""]
    for country, statuses_ in dead_by_country.items():
        out.append(f"- **{country}**")
        for status in statuses_:
            out.append(f"  - {status.url} ({status.reason})")
    return "\n".join(out) + "\n"


@app.command()
def titles(
    limit: int = typer.Option(2000, help="At most this many sources per run"),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Fill ``sources.title`` for rows that have none (needs SUPABASE_URL and
    SUPABASE_SERVICE_KEY). Dead and unreachable URLs stay untitled."""
    from .cli import configure_logging
    from .db.client import SupabaseClient

    configure_logging(verbose)
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        raise typer.Exit(code=1)
    with SupabaseClient(url, key) as db, LinkChecker() as checker:
        filled = fill_titles(db, checker, limit=limit)
    logger.info("titles: %d sources titled", filled)


def fill_titles(db, checker: LinkChecker, *, limit: int) -> int:
    """Title up to ``limit`` untitled ``sources`` rows; returns how many.
    The rows are upserted on ``url`` with the classifier's ``domain`` and
    ``source_type`` (the values the mirror writes), so only ``title``
    changes and ``first_seen``/``last_seen`` are left alone."""
    rows = db.select_all("sources", {"select": "url", "title": "is.null", "order": "id"})[:limit]
    statuses = checker.check(row["url"] for row in rows)
    titled = []
    for status in statuses.values():
        if status.state != OK or not status.title:
            continue
        source = classify_source(status.url)
        titled.append({
            "url": status.url, "domain": source.domain,
            "source_type": source.source_type, "title": status.title,
        })
    if titled:
        db.upsert("sources", titled, on_conflict="url")
    return len(titled)


def main() -> None:  # pragma: no cover - exercised via python -m
    app()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
