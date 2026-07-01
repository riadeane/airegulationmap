"""Shared exception types for the pipeline."""

from __future__ import annotations


class FatalAPIError(Exception):
    """Raised when the API returns an unrecoverable condition (bad key, no
    credits, malformed request, or a systemic run-level failure). Callers abort
    the run rather than retry."""
