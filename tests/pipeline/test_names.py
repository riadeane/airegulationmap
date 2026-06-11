from regulation_pipeline.names import canonicalize

ALIASES = {
    "Czech Republic": "Czechia",
    "Korea, South": "South Korea",
}


def test_alias_maps_to_canonical():
    assert canonicalize("Czech Republic", ALIASES) == "Czechia"


def test_unknown_name_passes_through():
    assert canonicalize("Germany", ALIASES) == "Germany"


def test_whitespace_is_stripped():
    assert canonicalize("  Czech Republic ", ALIASES) == "Czechia"
    assert canonicalize(" Germany ", ALIASES) == "Germany"


def test_empty_aliases():
    assert canonicalize("Czech Republic", {}) == "Czech Republic"
