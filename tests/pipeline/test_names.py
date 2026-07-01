from regulation_pipeline.names import CountryNames

NAMES = CountryNames({"Czech Republic": "Czechia", "Korea, South": "South Korea"})


def test_alias_maps_to_canonical():
    assert NAMES.canonical("Czech Republic") == "Czechia"


def test_unknown_name_passes_through():
    assert NAMES.canonical("Germany") == "Germany"


def test_whitespace_is_stripped():
    assert NAMES.canonical("  Czech Republic ") == "Czechia"
    assert NAMES.canonical(" Germany ") == "Germany"


def test_empty_alias_map():
    assert CountryNames({}).canonical("Czech Republic") == "Czech Republic"


def test_load_missing_file_yields_passthrough(tmp_path):
    names = CountryNames.load(tmp_path / "nope.json")
    assert names.canonical("Germany") == "Germany"


def test_load_reads_aliases(tmp_path):
    path = tmp_path / "country_names.json"
    path.write_text('{"aliases": {"USA": "United States of America"}}', encoding="utf-8")
    assert CountryNames.load(path).canonical("USA") == "United States of America"
