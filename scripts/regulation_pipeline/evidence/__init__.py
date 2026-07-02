"""The evidence layer: verified policy-initiative records that ground the
research prompt in facts instead of open-ended recall.

``EvidenceSource`` adapters (OECD.AI Policy Navigator / GAIIN today) fetch
and normalize external records; ``sync`` upserts them into the
``policy_initiatives`` table (and their links into the sources database);
the grounded prompt mode (``prompt.render_grounded_prompt``) then feeds a
country's verified records to Claude at scoring time.

Country matching is deliberately conservative: ISO3 exact, then canonical
name — never fuzzy. Unmatched records are stored unlinked with the raw
country label preserved, so nothing is lost and nothing is guessed.
"""
