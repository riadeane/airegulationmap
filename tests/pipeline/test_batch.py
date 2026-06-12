from regulation_pipeline.batch import build_batch_requests


def test_custom_ids_round_trip_for_awkward_country_names():
    # custom_id has a restricted charset — names with spaces, dots, and
    # non-ASCII must survive the mapping.
    params = {
        "Bosnia and Herz.": {"model": "m"},
        "Côte d'Ivoire": {"model": "m"},
        "United States of America": {"model": "m"},
    }
    requests, id_map = build_batch_requests(params)

    assert len(requests) == 3
    for req in requests:
        cid = req["custom_id"]
        assert cid.replace("country-", "").isdigit()
        assert id_map[cid] in params
        assert req["params"] is params[id_map[cid]]
    assert set(id_map.values()) == set(params)


def test_requests_are_deterministically_ordered():
    params = {name: {} for name in ["Zimbabwe", "Albania", "Mexico"]}
    requests, id_map = build_batch_requests(params)
    countries_in_order = [id_map[r["custom_id"]] for r in requests]
    assert countries_in_order == ["Albania", "Mexico", "Zimbabwe"]
