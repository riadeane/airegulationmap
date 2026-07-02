"""Adapter for the OECD.AI Policy Navigator (GAIIN) initiatives API.

Live shape (verified 2026-07 against both endpoints, which are the same
backend): paginated envelope ``{data, currentPage, lastPage, total,
perPage}``; the API supports NO server-side filtering or sorting (unknown
query params are silently ignored), so a sync always walks every page and
delta-detection happens client-side against ``updated_at``. Field notes:

* ``extentBinding`` — "Binding" | "Non-binding" | null (NOT ``binding``).
* ``gaiinCountry.code`` is ISO3; the rest of ``gaiinCountry``'s metadata
  (income group, population, language) is unreliable and never ingested.
* IGO-level records carry ``intergovernmentalOrganisation`` instead of a
  country (e.g. the EU's initiatives).
* ``overview`` is HTML.
* ``initiativeType``/``principles``/``tags`` are objects/arrays of objects.

Malformed records are logged and counted, never silently dropped.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import httpx

from .htmlstrip import strip_html
from .records import InitiativeRecord

logger = logging.getLogger(__name__)

# oecd.ai's own frontend calls this host.
OFFICIAL_ENDPOINT = "https://api.oecdai.org/policy-initiatives"
# Older deployment of the same backend; kept as a fallback.
WRAPPER_ENDPOINT = "https://oecd-ai.case-api.buddyweb.fr/policy-initiatives"

CANDIDATE_ENDPOINTS = (OFFICIAL_ENDPOINT, WRAPPER_ENDPOINT)


class OecdGaiinAdapter:
    name = "oecd"

    def __init__(self, http: httpx.Client, endpoint: str = OFFICIAL_ENDPOINT):
        self._http = http
        self._endpoint = endpoint
        self.malformed = 0

    def fetch_all(self) -> Iterator[InitiativeRecord]:
        page = 1
        last_page = 1
        while page <= last_page:
            resp = self._http.get(self._endpoint, params={"page": page})
            resp.raise_for_status()
            envelope = resp.json()
            last_page = int(envelope.get("lastPage") or 1)
            for raw in envelope.get("data", []):
                record = self._map(raw)
                if record is not None:
                    yield record
            if page == 1:
                logger.info(
                    "oecd: %s total initiatives across %d pages (%s)",
                    envelope.get("total"), last_page, self._endpoint,
                )
            page += 1

    def _map(self, raw: dict) -> InitiativeRecord | None:
        external_id = raw.get("id")
        name = raw.get("englishName")
        if external_id is None or not name:
            self.malformed += 1
            logger.warning("oecd: skipping malformed record (id=%r, keys=%s)", external_id, sorted(raw)[:8])
            return None

        country = raw.get("gaiinCountry") or {}
        igo = raw.get("intergovernmentalOrganisation") or {}
        initiative_type = raw.get("initiativeType") or {}
        relevant_urls = raw.get("relevantUrls") or []

        return InitiativeRecord(
            source=self.name,
            external_id=str(external_id),
            name=name,
            category=raw.get("category"),
            initiative_type=initiative_type.get("name") if isinstance(initiative_type, dict) else None,
            binding=raw.get("extentBinding"),
            status=raw.get("status"),
            start_year=raw.get("startYear"),
            end_year=raw.get("endYear"),
            description=raw.get("description"),
            overview=strip_html(raw.get("overview")),
            source_url=raw.get("website") or (relevant_urls[0] if relevant_urls else None),
            principles=tuple(p.get("name") for p in raw.get("principles") or [] if isinstance(p, dict) and p.get("name")),
            tags=tuple(t.get("name") for t in raw.get("tags") or [] if isinstance(t, dict) and t.get("name")),
            country_iso3=country.get("code") if isinstance(country, dict) else None,
            country_name=(country.get("name") if isinstance(country, dict) and country.get("name") else None)
                or (igo.get("name") if isinstance(igo, dict) else None),
            updated_at=raw.get("updatedAt"),
            raw=raw,
        )
