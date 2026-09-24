// Chart SVG sanitizer for the monthly trend pieces (PRD 12). The pipeline
// embeds hand-built SVG strings in the digest JSON; the changes page parses
// one with DOMParser into an inert XML document, passes the root through
// here, and rebuilds only what survives with createElementNS.
//
// The whitelist is exactly the vocabulary the pipeline's chart module
// emits, so anything else (scripts, links, styles, event handlers, foreign
// content, images) is dropped along with its whole subtree. Text nodes come
// back as plain strings and are only ever appended as text. The input is a
// minimal structural node shape rather than the DOM, so this runs in
// vitest's node environment.

/** The parts of a DOM node the sanitizer reads (a DOM Element fits). */
export interface SvgSourceNode {
  nodeType: number;
  /** Qualified name as written ('svg', 'xlink:href' style prefixes kept). */
  nodeName: string;
  attributes?: ArrayLike<{ name: string; value: string }> | null;
  childNodes: ArrayLike<SvgSourceNode>;
  textContent: string | null;
}

export interface SafeSvgNode {
  tag: string;
  attrs: [string, string][];
  children: (SafeSvgNode | string)[];
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

export const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  'svg', 'g', 'title', 'desc', 'line', 'polyline', 'path', 'rect', 'circle', 'text', 'tspan',
]);

export const SVG_ATTRIBUTES: ReadonlySet<string> = new Set([
  'viewBox', 'width', 'height', 'role', 'aria-labelledby', 'aria-label', 'aria-hidden',
  'id', 'class', 'font-family', 'font-size', 'font-weight',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'text-anchor', 'dominant-baseline',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'dx', 'dy', 'points', 'transform', 'opacity', 'preserveAspectRatio',
]);

// Values that could fetch or run something even on an allowed attribute.
const UNSAFE_VALUE_RE = /url\s*\(|javascript:|data:|expression\s*\(/i;

// Inside these, whitespace between runs renders ('Label <tspan>3.38</tspan>'),
// so whitespace-only text is kept; elsewhere it is only indentation.
const TEXT_ELEMENTS: ReadonlySet<string> = new Set(['text', 'tspan']);

// Charts nest three or four levels; anything far deeper is not a chart.
const MAX_DEPTH = 32;

function safeAttrs(node: SvgSourceNode): [string, string][] {
  const attrs: [string, string][] = [];
  const list = node.attributes;
  if (!list) return attrs;
  for (let i = 0; i < list.length; i++) {
    const { name, value } = list[i];
    // Exact match: prefixed names (xlink:href, xml:space) never pass.
    if (!SVG_ATTRIBUTES.has(name) || UNSAFE_VALUE_RE.test(value)) continue;
    attrs.push([name, value]);
  }
  return attrs;
}

function sanitizeElement(node: SvgSourceNode, depth: number): SafeSvgNode | null {
  if (depth > MAX_DEPTH || !SVG_ELEMENTS.has(node.nodeName)) return null;
  const keepSpace = TEXT_ELEMENTS.has(node.nodeName);
  const children: (SafeSvgNode | string)[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === ELEMENT_NODE) {
      const safe = sanitizeElement(child, depth + 1);
      if (safe) children.push(safe);
    } else if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) {
      const text = child.textContent ?? '';
      if (text.trim() || (keepSpace && text)) children.push(text);
    }
    // Comments, processing instructions and anything else are dropped.
  }
  return { tag: node.nodeName, attrs: safeAttrs(node), children };
}

/** The whitelisted copy of an `<svg>` tree, or null when the root is not
 * an svg element. */
export function sanitizeSvg(root: SvgSourceNode): SafeSvgNode | null {
  if (root.nodeType !== ELEMENT_NODE || root.nodeName !== 'svg') return null;
  return sanitizeElement(root, 0);
}
