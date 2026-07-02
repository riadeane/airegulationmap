"""The Python source classifier must stay behaviourally aligned with the
frontend's (src/data/sources.ts) on the official/other *kind* — these shared
examples are the contract documented in both files."""

from __future__ import annotations

from regulation_pipeline.sources import classify_source, classify_sources


class TestKindParityWithFrontend:
    def test_government_tlds_are_official(self):
        for url in (
            "https://www.legislation.gov.uk/ukpga/2024/1",
            "https://ai.gov/action-plan",
            "https://www.economie.gouv.fr/ia",
            "https://www.gob.mx/estrategia-ia",
            "https://www.meti.go.jp/policy",
            "https://ised-isde.gc.ca/ai",
            "https://bmds.bund.de/ki",
            "https://www.admin.ch/ai",
            "https://eur-lex.europa.eu/eli/reg/2024/1689",
        ):
            assert classify_source(url).kind == "official", url

    def test_legislature_keywords_are_official(self):
        assert classify_source("https://www.parliament.uk/ai-bill").kind == "official"
        assert classify_source("https://www.legifrance.gouv.fr/loi").kind == "official"

    def test_secondary_sources_are_other(self):
        for url in (
            "https://oecd.ai/en/dashboards",
            "https://iapp.org/news/ai-governance",
            "https://www.dlapiper.com/tracker",
            "https://example.com/blog",
        ):
            assert classify_source(url).kind == "other", url

    def test_unparseable_urls_degrade_to_other(self):
        c = classify_source("not a url")
        assert c.kind == "other" and c.domain == "not a url"


class TestSourceTypeTaxonomy:
    def test_igo_domains_are_intergovernmental(self):
        assert classify_source("https://eur-lex.europa.eu/x").source_type == "intergovernmental"
        assert classify_source("https://oecd.ai/dashboards").source_type == "intergovernmental"
        assert classify_source("https://www.un.org/ai-advisory-body").source_type == "intergovernmental"

    def test_national_government_is_official(self):
        assert classify_source("https://www.legislation.gov.uk/x").source_type == "official"

    def test_academia(self):
        assert classify_source("https://hai.stanford.edu/policy").source_type == "academic"
        assert classify_source("https://www.ox.ac.uk/ai").source_type == "academic"

    def test_default_other(self):
        assert classify_source("https://techcrunch.com/ai").source_type == "other"


class TestSplitting:
    def test_pipe_split_dedupe_and_placeholders(self):
        raw = "https://a.gov/x | https://a.gov/x | N/A | none | https://b.com/y"
        out = classify_sources(raw)
        assert [s.url for s in out] == ["https://a.gov/x", "https://b.com/y"]

    def test_empty_and_none(self):
        assert classify_sources(None) == []
        assert classify_sources("") == []
