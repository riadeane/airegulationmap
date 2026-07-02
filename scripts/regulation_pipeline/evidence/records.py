"""The normalized evidence record every adapter emits."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class InitiativeRecord(BaseModel):
    """One policy initiative, normalized to the ``policy_initiatives``
    columns. ``raw`` keeps the source's full original record so a future
    mapping fix can re-derive fields without re-fetching."""

    model_config = ConfigDict(frozen=True)

    source: str
    external_id: str
    name: str
    category: str | None = None
    initiative_type: str | None = None
    binding: str | None = None
    status: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    description: str | None = None
    overview: str | None = None          # HTML-stripped plain text
    source_url: str | None = None
    principles: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    # Country hints as received — resolution happens in matching.py.
    country_iso3: str | None = None
    country_name: str | None = None      # country OR IGO label
    updated_at: str | None = None
    raw: dict

    def db_row(self, country_id: str | None) -> dict:
        return {
            "source": self.source,
            "external_id": self.external_id,
            "country_id": country_id,
            "country_raw": self.country_iso3 or self.country_name,
            "name": self.name,
            "category": self.category,
            "initiative_type": self.initiative_type,
            "binding": self.binding,
            "status": self.status,
            "start_year": self.start_year,
            "end_year": self.end_year,
            "description": self.description,
            "overview": self.overview,
            "source_url": self.source_url,
            "principles": list(self.principles),
            "tags": list(self.tags),
            "raw": self.raw,
            "updated_at": self.updated_at,
        }
