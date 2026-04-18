// Resolve a CSS custom property (e.g. `--accent`) to an RGB string that
// d3-color can parse.
//
// Why this is non-trivial: in modern browsers, getComputedStyle returns
// colors in their originally-specified color space. A token authored in
// OKLCH (e.g. `oklch(76% 0.13 75)`) is returned AS oklch, not converted
// to rgb. d3-color v3 cannot parse oklch() strings, so feeding it
// directly to interpolateLab/interpolateRgb produces NaN and the fill
// disappears.
//
// The fix: push the resolved color through a canvas 2D context, whose
// fillStyle getter always normalizes to a short hex string (or rgba()
// when there's alpha). That form d3-color parses cleanly.

let probe;
let normCtx;

function getProbe() {
  if (probe && probe.isConnected) return probe;
  probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.visibility = 'hidden';
  probe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(probe);
  return probe;
}

function getNormCtx() {
  if (normCtx) return normCtx;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  // willReadFrequently hints to the browser that we'll call getImageData
  // often — avoids a console warning and keeps the canvas on the CPU
  // side where readbacks are cheap.
  normCtx = canvas.getContext('2d', { willReadFrequently: true });
  return normCtx;
}

export function cssVar(name) {
  const el = getProbe();
  // Clear first so the browser doesn't skip the assignment when the
  // underlying token string is identical to the previous read.
  el.style.color = '';
  el.style.color = `var(${name})`;
  const raw = getComputedStyle(el).color;

  // Fast path: getComputedStyle already returned an rgb/rgba string.
  if (raw.startsWith('rgb')) return raw;

  // Slow path: the value is in a non-sRGB space (oklch, lch, color(),
  // etc.). Browsers preserve the authoring color space in both
  // getComputedStyle and canvas `fillStyle`, so we force sRGB
  // conversion by actually rasterizing a single pixel and reading it
  // back via getImageData. This works because painting must produce
  // real sRGB pixels.
  const ctx = getNormCtx();
  ctx.clearRect(0, 0, 1, 1);
  try {
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
  } catch (e) {
    return '#888888';
  }
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

// Invalidate any cached results on theme change. Call from the theme
// toggle path. Re-renders the map with fresh colors.
export function onThemeChange(callback) {
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'data-theme') {
        callback();
        return;
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // Also re-run when system color scheme changes if user has no explicit choice.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => { if (!localStorage.getItem('theme')) callback(); };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }
}
