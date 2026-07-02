"""Source-URL classification for the sources database.

Python port of the frontend classifier in ``src/data/sources.ts`` — the
``official``/``other`` *kind* must stay behaviourally identical in both
languages (the shared examples below are asserted by
``tests/pipeline/test_sources_classify.py``; mirror any pattern change in
both files). On top of the kind, this module refines a ``source_type`` for
the ``sources`` table taxonomy:

* ``intergovernmental`` — IGO domains (EU institutions, OECD, UN system, …).
  Note: the frontend still *tags* e.g. ``europa.eu`` as official (it is the
  primary source for EU law); the DB taxonomy separates the IGO layer.
* ``official`` — national government / legislature / regulator hosts.
* ``academic`` — universities (``.edu``, ``.ac.<cc>``).
* ``other`` — everything else. (``news``/``industry`` exist in the DB check
  constraint for future refinement but are not auto-assigned yet.)

Shared classification examples (keep in sync with src/data/sources.ts):
  legislation.gov.uk → official · bmds.bund.de → official ·
  eur-lex.europa.eu → official kind (intergovernmental type) ·
  oecd.ai → other kind (intergovernmental type) · iapp.org → other.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# Mirrors OFFICIAL_HOST_RE in src/data/sources.ts.
_OFFICIAL_HOST_RE = re.compile(
    r"(?:(^|\.)gov(\.[a-z]{2,3})?$)"
    r"|(?:(^|\.)mil$)"
    r"|(?:(^|\.)gouv\.[a-z]{2,3}$)"
    r"|(?:(^|\.)gob\.[a-z]{2,3}$)"
    r"|(?:(^|\.)go\.[a-z]{2,3}$)"
    r"|(?:(^|\.)govt\.[a-z]{2,3}$)"
    r"|(?:(^|\.)gc\.ca$)"
    r"|(?:(^|\.)bund\.de$)"
    r"|(?:(^|\.)admin\.ch$)"
    r"|(?:(^|\.)europa\.eu$)",
    re.IGNORECASE,
)

# Mirrors OFFICIAL_KEYWORD_RE in src/data/sources.ts.
_OFFICIAL_KEYWORD_RE = re.compile(
    r"(^|\.)(parliament|parlament|legislation|legifrance|riksdagen|bundestag"
    r"|assemblee-nationale|camera|senato|gazette|boe)\.",
    re.IGNORECASE,
)

# Intergovernmental-organisation domains (DB taxonomy refinement).
_INTERGOV_SUFFIXES = (
    "europa.eu", "oecd.org", "oecd.ai", "un.org", "unesco.org",
    "worldbank.org", "wto.org", "itu.int", "coe.int", "au.int",
    "asean.org", "nato.int", "imf.org",
)

_ACADEMIC_RE = re.compile(r"(^|\.)(edu|ac\.[a-z]{2,3})$", re.IGNORECASE)

# Mirrors PLACEHOLDER_RE in src/constants.ts — research results occasionally
# emit filler like "N/A" instead of a URL.
_PLACEHOLDER_RE = re.compile(r"^(na|n/a|idem|unknown|none|\s*[-–—]\s*|\.\s*)$", re.IGNORECASE)


@dataclass(frozen=True)
class ClassifiedSource:
    url: str
    domain: str
    kind: str          # 'official' | 'other' — identical to the frontend
    source_type: str   # sources.source_type taxonomy


def _hostname(url: str) -> str | None:
    try:
        host = urlparse(url).hostname
    except ValueError:
        return None
    if not host:
        return None
    return host.lower().removeprefix("www.")


def classify_source(url: str) -> ClassifiedSource:
    host = _hostname(url)
    if host is None:
        return ClassifiedSource(url=url, domain=url, kind="other", source_type="other")

    official = bool(_OFFICIAL_HOST_RE.search(host) or _OFFICIAL_KEYWORD_RE.search(host))
    kind = "official" if official else "other"

    if any(host == s or host.endswith("." + s) for s in _INTERGOV_SUFFIXES):
        source_type = "intergovernmental"
    elif official:
        source_type = "official"
    elif _ACADEMIC_RE.search(host):
        source_type = "academic"
    else:
        source_type = "other"

    return ClassifiedSource(url=url, domain=host, kind=kind, source_type=source_type)


def classify_sources(raw: str | None) -> list[ClassifiedSource]:
    """Split the pipe-separated CSV ``Sources`` field into classified,
    de-duplicated sources — same splitting rules as the frontend."""
    if not raw:
        return []
    seen: set[str] = set()
    out: list[ClassifiedSource] = []
    for part in raw.split("|"):
        url = part.strip()
        if not url or _PLACEHOLDER_RE.match(url) or url in seen:
            continue
        seen.add(url)
        out.append(classify_source(url))
    return out
