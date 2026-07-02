"""Supabase persistence layer: a thin PostgREST client, the one-shot seed
CLI, and (in :mod:`.mirror`) the dual-write mirror the pipeline service
calls after each run. The static files in ``public/`` remain the published
snapshot; this package keeps the database copy in lockstep."""
