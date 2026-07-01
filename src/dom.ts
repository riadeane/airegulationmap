// Typed element access — the one seam for reaching into the DOM.
//
// The app is vanilla TS over a static index.html, so most modules resolve
// elements by id. Left ad hoc, that meant `document.getElementById('x') as
// HTMLInputElement` (an unchecked cast that lies if the id is wrong or the
// element is the wrong tag) scattered across the codebase. These two helpers
// centralise it:
//
//   el<T>(id)      — a REQUIRED shell element (declared in index.html). Throws
//                    immediately with the offending id if it's missing, so a
//                    renamed id fails loudly at startup instead of as a later
//                    `null` dereference.
//   maybeEl<T>(id) — an OPTIONAL element; returns null when absent, for the
//                    defensively-guarded call sites.
//
// The type parameter documents the expected element type at the call site
// without the bare `as` cast.

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`dom: required element #${id} not found`);
  return node as T;
}

export function maybeEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
