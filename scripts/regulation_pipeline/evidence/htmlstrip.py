"""Minimal HTML-to-text for evidence ``overview`` fields — stdlib only
(no beautifulsoup4 dependency for one field)."""

from __future__ import annotations

from html.parser import HTMLParser

_BLOCK_TAGS = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "tr"}


class _Extractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def strip_html(html: str | None) -> str | None:
    """Plain text with block tags becoming line breaks and whitespace
    collapsed. None/empty passes through as None."""
    if not html:
        return None
    parser = _Extractor()
    parser.feed(html)
    text = "".join(parser.parts)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    out = "\n".join(line for line in lines if line)
    return out or None
