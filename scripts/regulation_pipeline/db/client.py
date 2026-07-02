"""A deliberately thin PostgREST client on ``httpx``.

Not ``supabase-py``: the pipeline needs exactly four verbs against a known
schema (select / insert / upsert / delete), and a hand-rolled wrapper keeps
the dependency surface small and the tests honest — a fake
``httpx.MockTransport`` asserts the *exact* request sequence the mirror and
seed produce.

Writes require the service-role key (RLS admits anon SELECT only).
"""

from __future__ import annotations

import json
from typing import Any

import httpx


class SupabaseError(RuntimeError):
    """A non-2xx PostgREST response."""


class SupabaseClient:
    def __init__(
        self,
        url: str,
        key: str,
        *,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ):
        self._http = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> SupabaseClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- verbs -------------------------------------------------------------

    def select(self, table: str, params: dict[str, str] | None = None) -> list[dict]:
        resp = self._http.get(f"/{table}", params=params or {})
        return self._json(resp)

    def insert(self, table: str, rows: list[dict], *, returning: bool = False) -> list[dict]:
        resp = self._http.post(
            f"/{table}",
            content=json.dumps(rows, ensure_ascii=False, default=str),
            headers={"Prefer": "return=representation" if returning else "return=minimal"},
        )
        return self._json(resp) if returning else self._ok(resp)

    def upsert(
        self,
        table: str,
        rows: list[dict],
        *,
        on_conflict: str,
        batch_size: int = 500,
    ) -> None:
        """Idempotent bulk upsert. Callers must NOT include generated columns
        (like ``id``) in ``rows`` — merge-duplicates updates every supplied
        column, and rewriting a primary key would break foreign keys."""
        for start in range(0, len(rows), batch_size):
            batch = rows[start:start + batch_size]
            resp = self._http.post(
                f"/{table}",
                params={"on_conflict": on_conflict},
                content=json.dumps(batch, ensure_ascii=False, default=str),
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )
            self._ok(resp)

    def update(self, table: str, values: dict, filters: dict[str, str]) -> None:
        """PATCH rows matching PostgREST ``filters`` (e.g. ``{"id": "eq.<uuid>"}``)."""
        if not filters:
            raise ValueError("refusing to UPDATE without filters")
        resp = self._http.patch(
            f"/{table}",
            params=filters,
            content=json.dumps(values, ensure_ascii=False, default=str),
            headers={"Prefer": "return=minimal"},
        )
        self._ok(resp)

    def delete(self, table: str, filters: dict[str, str]) -> None:
        """``filters`` are PostgREST operators, e.g. ``{"country_id": "eq.<uuid>"}``.
        Refuses to run unfiltered — a bare DELETE on a PostgREST table is a
        table wipe."""
        if not filters:
            raise ValueError("refusing to DELETE without filters")
        resp = self._http.delete(f"/{table}", params=filters)
        self._ok(resp)

    # -- plumbing ----------------------------------------------------------

    @staticmethod
    def _ok(resp: httpx.Response) -> list[dict]:
        if resp.status_code >= 400:
            raise SupabaseError(f"{resp.request.method} {resp.request.url}: {resp.status_code} {resp.text[:300]}")
        return []

    @classmethod
    def _json(cls, resp: httpx.Response) -> Any:
        cls._ok(resp)
        return resp.json()
