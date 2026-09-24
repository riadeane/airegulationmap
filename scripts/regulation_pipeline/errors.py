"""Shared exception types for the pipeline."""

from __future__ import annotations


class FatalAPIError(Exception):
    """Raised when the API returns an unrecoverable condition (bad key, no
    credits, malformed request, or a systemic run-level failure). Callers abort
    the run rather than retry."""


class DigestError(RuntimeError):
    """The weekly digest or a monthly trend piece could not be generated (the
    run itself is unaffected). Lives here rather than in ``digest.py`` so
    ``python -m regulation_pipeline.digest``, which runs that module as
    ``__main__``, and :mod:`regulation_pipeline.monthly` raise and catch one
    class."""
