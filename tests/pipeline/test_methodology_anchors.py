"""The methodology page quotes the rubric the model scores against (#167).

``public/methodology.html`` lists every sub-indicator with the anchors the
research prompt gives it, verbatim, under its dimension, and states the
shared level ladder once. These tests read both out of
:data:`regulation_pipeline.prompt.RESEARCH_PROMPT` and fail when an anchor
changes in ``prompt.py`` and the page does not follow.
"""

from __future__ import annotations

import re
from functools import cache
from html.parser import HTMLParser
from pathlib import Path

import pytest
from regulation_pipeline.models import ResearchResult
from regulation_pipeline.prompt import RESEARCH_PROMPT

METHODOLOGY = Path(__file__).resolve().parents[2] / "public" / "methodology.html"

# A dimension object opens on a line of its own: `"regulation_status": {{`.
_DIMENSION = re.compile(r'^\s*"(\w+)": \{\{?\s*$')
# A sub-indicator line carries its anchors in the score placeholder:
# `"binding_force": {{"score": <1 = ...; 3 = ...; 5 = ...>, "rationale": ...`.
_SUBINDICATOR = re.compile(r'^\s*"(\w+)": \{\{?"score": <(?:DESCRIPTIVE:\s*)?(.+?)>\s*,')
# One anchor in the placeholder, up to the next `; N =` or the end.
_ANCHOR = re.compile(r"(\d)\s*=\s*(.+?)\s*(?=;\s*\d\s*=|$)")
# A bullet of the calibration ladder: `- 5 = the state is fully in place ...`.
_LEVEL = re.compile(r"^(\d|null) = (.+)$")


def _squash(text: str) -> str:
    return " ".join(text.split())


def prompt_anchors(prompt: str = RESEARCH_PROMPT) -> dict[str, dict[str, dict[str, str]]]:
    """``{dimension: {sub_indicator: {level: anchor}}}`` from the prompt's JSON template."""
    anchors: dict[str, dict[str, dict[str, str]]] = {}
    dimension = None
    for line in prompt.splitlines():
        if match := _DIMENSION.match(line):
            dimension = match.group(1)
            anchors[dimension] = {}
        elif dimension and (match := _SUBINDICATOR.match(line)):
            levels = _ANCHOR.findall(match.group(2))
            anchors[dimension][match.group(1)] = {level: _squash(text) for level, text in levels}
    return anchors


def prompt_ladder(prompt: str = RESEARCH_PROMPT) -> dict[str, str]:
    """``{level: first sentence of its definition}`` from the calibration block."""
    start = prompt.index("Calibration - read before scoring:")
    end = prompt.index("Return ONLY a valid JSON object", start)
    ladder = {}
    for bullet in prompt[start:end].split("\n- "):
        if match := _LEVEL.match(_squash(bullet)):
            sentence = re.match(r"(.+?\.)(?:\s|$)", match.group(2))
            ladder[match.group(1)] = sentence.group(1) if sentence else match.group(2)
    return ladder


class _PageRubric(HTMLParser):
    """Reads the page's sub-indicator blocks: each ``.rubric-sub`` under an
    ``<h3 id="regulation-status">`` (and so on) names its key in the
    ``<code>`` of its ``<h4>`` and lists its anchors as ``<dt>``/``<dd>``
    pairs. Collects ``{(dimension, key): {level: anchor}}`` plus the page's
    visible text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: dict[tuple[str, str], dict[str, str]] = {}
        self.text: list[str] = []
        self._dimension = ""
        self._key = ""
        self._level = ""
        self._in_block = False
        self._in_h4 = False
        self._field = ""
        self._buffer: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in ("style", "script"):
            self._skip += 1
        elif tag == "h3" and attributes.get("id"):
            self._dimension = attributes["id"].replace("-", "_")
        elif tag == "div" and "rubric-sub" in (attributes.get("class") or "").split():
            self._in_block, self._key = True, ""
        elif self._in_block and tag == "h4":
            self._in_h4 = True
        elif self._in_block and (tag in ("dt", "dd") or (tag == "code" and self._in_h4)):
            self._field, self._buffer = tag, []

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self._skip -= 1
        elif self._in_block and tag == "div":
            self._in_block = False
        elif tag == "h4":
            self._in_h4 = False
        elif self._field and tag == self._field:
            value = _squash("".join(self._buffer))
            if tag == "code":
                self._key = value
                self.blocks[(self._dimension, value)] = {}
            elif tag == "dt":
                self._level = value
            else:
                self.blocks[(self._dimension, self._key)][self._level] = value
            self._field = ""

    def handle_data(self, data):
        if self._skip:
            return
        self.text.append(data)
        if self._field:
            self._buffer.append(data)


@cache
def page() -> _PageRubric:
    parser = _PageRubric()
    parser.feed(METHODOLOGY.read_text(encoding="utf-8"))
    parser.close()
    return parser


def page_text() -> str:
    return _squash(" ".join(page().text))


ANCHORS = prompt_anchors()
SUBINDICATORS = [(dim, key) for dim, subs in ANCHORS.items() for key in subs]


def test_prompt_parses_into_every_subindicator():
    # Guards the parser: a reformatted prompt must fail here, not pass the
    # page checks vacuously.
    expected = {dim.key: set(dim.subindicators()) for dim in ResearchResult.DIMENSIONS}
    assert {dim: set(subs) for dim, subs in ANCHORS.items()} == expected
    for dim, key in SUBINDICATORS:
        assert {"1", "3", "5"} <= set(ANCHORS[dim][key]), f"{dim}.{key}"


@pytest.mark.parametrize(("dimension", "key"), SUBINDICATORS)
def test_page_quotes_the_anchors(dimension, key):
    assert page().blocks.get((dimension, key)) == ANCHORS[dimension][key]


def test_page_lists_no_other_subindicators():
    assert set(page().blocks) == set(SUBINDICATORS)


def test_page_quotes_the_level_ladder():
    ladder = prompt_ladder()
    assert set(ladder) == {"1", "2", "3", "4", "5", "null"}
    text = page_text()
    for level, definition in ladder.items():
        assert definition in text, f"level {level}: {definition!r}"


def test_an_edited_anchor_is_caught():
    edited = RESEARCH_PROMPT.replace("5 = binding AI rules in force whose", "5 = binding AI rules adopted whose")
    assert edited != RESEARCH_PROMPT
    anchors = prompt_anchors(edited)["regulation_status"]["binding_force"]
    assert page().blocks[("regulation_status", "binding_force")] != anchors
