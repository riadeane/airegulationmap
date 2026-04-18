// Resilience helpers — skeleton removal and data-load error boundary.
//
// Kept deliberately tiny: just DOM plumbing for the two paths `main()`
// needs. The copy is honest about the failure but offers the user a
// way forward (retry + a link to the raw data on GitHub).

export function removeMapSkeleton() {
  const skel = document.getElementById('map-skeleton');
  if (skel) skel.remove();
}

function removeAllChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function showLoadError(err) {
  // Keep the page shell alive (header, theme toggle, footer, search).
  // Only the map area is replaced.
  removeMapSkeleton();

  const map = document.getElementById('map');
  if (!map) return;

  // Clear any in-flight SVG the renderer may have mounted before the
  // error was thrown downstream.
  removeAllChildren(map);

  const wrap = document.createElement('div');
  wrap.className = 'map-error';
  wrap.setAttribute('role', 'alert');

  const h = document.createElement('p');
  h.className = 'map-error-heading';
  h.textContent = "Couldn't load the regulation data.";

  const detail = document.createElement('p');
  detail.className = 'map-error-detail';
  const kind = classifyError(err);
  detail.textContent = kind === 'network'
    ? 'A network request failed. Check your connection and try again. The latest snapshot is also available in the GitHub mirror.'
    : 'The data file returned an unexpected shape. You can inspect the raw CSVs on GitHub.';

  const actions = document.createElement('div');
  actions.className = 'map-error-actions';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'map-error-btn';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => window.location.reload());

  const github = document.createElement('a');
  github.href = 'https://github.com/riadeane/airegulationmap/tree/main/public';
  github.target = '_blank';
  github.rel = 'noopener noreferrer';
  github.className = 'map-error-btn secondary';
  github.textContent = 'View data on GitHub';

  actions.appendChild(retry);
  actions.appendChild(github);

  wrap.appendChild(h);
  wrap.appendChild(detail);
  wrap.appendChild(actions);

  map.appendChild(wrap);

  // Hide the zoom controls — they'd point at nothing.
  const zoom = document.getElementById('zoom-controls');
  if (zoom) zoom.style.display = 'none';

  // Surface the error to anyone tailing the console with a timestamp
  // so GitHub-issue reports are easier to correlate.
  console.error('[airegulationmap] data load failed at', new Date().toISOString(), err);
}

function classifyError(err) {
  if (!err) return 'unknown';
  if (err instanceof TypeError) return 'network'; // fetch throws TypeError on network failure
  if (err.message && /fetch|network|failed to load/i.test(err.message)) return 'network';
  return 'unknown';
}
