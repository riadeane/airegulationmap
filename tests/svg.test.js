import { describe, it, expect } from 'vitest';
import { sanitizeSvg, SVG_ATTRIBUTES, SVG_ELEMENTS } from '../src/data/svg';

// Hand-built nodes with the shape the sanitizer reads from the DOM.
const text = (value, nodeType = 3) => ({ nodeType, nodeName: '#text', childNodes: [], textContent: value });
const node = (name, attrs = {}, children = []) => ({
  nodeType: 1,
  nodeName: name,
  attributes: Object.entries(attrs).map(([key, value]) => ({ name: key, value })),
  childNodes: children.map((c) => (typeof c === 'string' ? text(c) : c)),
  textContent: null,
});
const svg = (children, attrs = {}) => node('svg', { viewBox: '0 0 640 300', ...attrs }, children);

describe('sanitizeSvg', () => {
  it('keeps the chart vocabulary', () => {
    const tree = svg([
      node('title', { id: 'c-title' }, ['Maturity by bloc']),
      node('g', { transform: 'translate(0,0)' }, [
        node('line', { x1: '36', y1: '20', x2: '440', y2: '20', stroke: 'currentColor', 'stroke-opacity': '0.15' }),
        node('path', { d: 'M36 120 L68 118', fill: 'none', stroke: '#c2463f', 'stroke-linecap': 'round' }, [
          node('title', {}, ['European Union: 3.33 to 3.38']),
        ]),
        node('circle', { class: 'mark-ring', cx: '440', cy: '118', r: '4', fill: '#c2463f' }),
      ]),
    ], { role: 'img', 'aria-labelledby': 'c-title', preserveAspectRatio: 'xMinYMin meet' });

    expect(sanitizeSvg(tree)).toEqual({
      tag: 'svg',
      attrs: [
        ['viewBox', '0 0 640 300'],
        ['role', 'img'],
        ['aria-labelledby', 'c-title'],
        ['preserveAspectRatio', 'xMinYMin meet'],
      ],
      children: [
        { tag: 'title', attrs: [['id', 'c-title']], children: ['Maturity by bloc'] },
        {
          tag: 'g',
          attrs: [['transform', 'translate(0,0)']],
          children: [
            {
              tag: 'line',
              attrs: [['x1', '36'], ['y1', '20'], ['x2', '440'], ['y2', '20'], ['stroke', 'currentColor'], ['stroke-opacity', '0.15']],
              children: [],
            },
            {
              tag: 'path',
              attrs: [['d', 'M36 120 L68 118'], ['fill', 'none'], ['stroke', '#c2463f'], ['stroke-linecap', 'round']],
              children: [{ tag: 'title', attrs: [], children: ['European Union: 3.33 to 3.38'] }],
            },
            {
              tag: 'circle',
              attrs: [['class', 'mark-ring'], ['cx', '440'], ['cy', '118'], ['r', '4'], ['fill', '#c2463f']],
              children: [],
            },
          ],
        },
      ],
    });
  });

  it('drops disallowed elements with their subtrees', () => {
    const tree = svg([
      node('script', {}, ['alert(1)']),
      node('foreignObject', {}, [node('text', {}, ['inside'])]),
      node('a', { href: 'https://evil.example' }, [node('text', {}, ['link'])]),
      node('use', { href: '#x' }),
      node('image', { href: 'https://evil.example/x.png' }),
      node('style', {}, ['* { color: red }']),
      node('rect', { x: '1' }),
    ]);
    expect(sanitizeSvg(tree).children).toEqual([{ tag: 'rect', attrs: [['x', '1']], children: [] }]);
  });

  it('drops style, href, event handler and prefixed attributes', () => {
    const tree = svg([
      node('rect', {
        x: '1',
        style: 'fill: red',
        href: '#a',
        'xlink:href': '#a',
        onclick: 'alert(1)',
        onload: 'alert(1)',
        'xml:space': 'preserve',
        'xmlns:xlink': 'http://www.w3.org/1999/xlink',
        FILL: 'red',
      }),
    ], { xmlns: 'http://www.w3.org/2000/svg' });
    const out = sanitizeSvg(tree);
    expect(out.attrs).toEqual([['viewBox', '0 0 640 300']]);
    expect(out.children[0].attrs).toEqual([['x', '1']]);
  });

  it('drops attribute values that fetch or run something', () => {
    const tree = svg([
      node('rect', {
        fill: 'url(#gradient)',
        stroke: 'URL (https://evil.example)',
        class: 'javascript:alert(1)',
        id: 'data:text/html,x',
        transform: 'expression(alert(1))',
        opacity: '0.5',
      }),
    ]);
    expect(sanitizeSvg(tree).children[0].attrs).toEqual([['opacity', '0.5']]);
  });

  it('drops url() spelled with CSS escapes and any non-colour paint', () => {
    const tree = svg([
      node('rect', { fill: '\\75 rl(https://attacker.example/p.svg#g)', stroke: 'u\\rl(https://attacker.example/q.svg#g)' }),
      node('rect', { fill: 'attr(data-x)', stroke: 'context-stroke' }),
      node('path', { fill: '#348dcf', stroke: 'currentColor' }),
      node('path', { fill: 'none', stroke: ' #C74C41 ' }),
      node('text', { 'font-family': 'Geist\\, x' }),
    ]);
    const attrs = sanitizeSvg(tree).children.map((child) => child.attrs);
    expect(attrs).toEqual([
      [],
      [],
      [['fill', '#348dcf'], ['stroke', 'currentColor']],
      [['fill', 'none'], ['stroke', ' #C74C41 ']],
      [],
    ]);
  });

  it('rejects a root that is not svg', () => {
    expect(sanitizeSvg(node('g', {}, [node('rect')]))).toBeNull();
    expect(sanitizeSvg(node('html'))).toBeNull();
    expect(sanitizeSvg(node('SVG'))).toBeNull();
    expect(sanitizeSvg(node('svg:svg'))).toBeNull();
    expect(sanitizeSvg(text('<svg></svg>'))).toBeNull();
  });

  it('keeps text as strings and drops layout whitespace', () => {
    const tree = svg([
      '\n  ',
      node('text', { x: '452', y: '122', 'text-anchor': 'start' }, [
        'European Union ',
        node('tspan', { 'fill-opacity': '0.66' }, ['3.38 +0.05']),
        ' ',
        node('tspan', {}, ['<script>alert(1)</script>']),
      ]),
      '\n',
      { nodeType: 8, nodeName: '#comment', childNodes: [], textContent: 'a comment' },
      text('cdata text', 4),
    ]);
    const out = sanitizeSvg(tree);
    expect(out.children).toEqual([
      {
        tag: 'text',
        attrs: [['x', '452'], ['y', '122'], ['text-anchor', 'start']],
        children: [
          'European Union ',
          { tag: 'tspan', attrs: [['fill-opacity', '0.66']], children: ['3.38 +0.05'] },
          ' ',
          { tag: 'tspan', attrs: [], children: ['<script>alert(1)</script>'] },
        ],
      },
      'cdata text',
    ]);
  });

  it('stops at an unreasonable nesting depth', () => {
    let deep = node('rect');
    for (let i = 0; i < 40; i++) deep = node('g', {}, [deep]);
    let depth = 0;
    for (let n = sanitizeSvg(svg([deep])); n && n.children.length; n = n.children[0]) depth++;
    expect(depth).toBeLessThan(40);
  });

  it('whitelists exactly the documented vocabulary', () => {
    expect([...SVG_ELEMENTS].sort()).toEqual(
      ['circle', 'desc', 'g', 'line', 'path', 'polyline', 'rect', 'svg', 'text', 'title', 'tspan'],
    );
    for (const banned of ['style', 'href', 'xlink:href', 'onload', 'onclick', 'src']) {
      expect(SVG_ATTRIBUTES.has(banned)).toBe(false);
    }
  });
});
