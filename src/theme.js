/* ── theme.js ───────────────────────────────────────────────────────────────
   Two media, not one palette inverted. The choice is written to a cookie on
   `.corvardt.com` rather than localStorage, so it carries from the index to every
   project subdomain: the whole domain behaves as one set, not as several.

   Loaded with `defer`; the medium itself is resolved by the inline script in
   the document head, before first paint, so the tube never flashes on paper. */

const KEY = 'corvardt-theme';

export function store(theme) {
  const domain = location.hostname.endsWith('corvardt.com') ? '; domain=.corvardt.com' : '';
  // One year, root path, so every subdomain reads the same value.
  document.cookie = `${KEY}=${theme}; path=/; max-age=31536000; samesite=lax${domain}`;
}

export function current() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/* Every path that changes the medium goes through here, so none of them can
   drift from another. Applied synchronously: anything reading computed style
   must see the new palette on the same frame the label changes.

   Nothing here forces a repaint. A band of the old medium surviving a flip
   looked like it belonged to this function, but it was a record keeping a
   panel it had given up, and it is fixed where the records are drawn. */
function set(theme) {
  document.documentElement.dataset.theme = theme;
  // The browser chrome is part of the medium: it follows the palette rather
  // than the system, which the reader is allowed to overrule.
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(
    document.documentElement
  )
    .getPropertyValue('--c-void')
    .trim();
  return theme;
}

/** A medium the reader chose, which is the only kind that is written down. */
export function apply(theme) {
  store(theme);
  return set(theme);
}

/* ── The coating ─────────────────────────────────────────────────────────────
   The phosphor on the tube, carried over from Tyche. Unlike the medium this is
   one instrument's own decoration rather than a property of the domain, so it
   lives in localStorage: a reader who wants a crimson Steropes has not asked
   for a crimson everything.

   `white` is the absence of a coating, not a fourth colour, so choosing it
   removes the attribute rather than writing one no rule matches. */

export const PALETTES = ["white", "oil", "crimson", "demon"];

export function palette() {
  return document.documentElement.dataset.palette || "white";
}

export function applyPalette(name) {
  const next = PALETTES.includes(name) ? name : "white";
  if (next === "white") delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = next;
  try {
    localStorage.setItem("palette", next);
  } catch {
    // Storage disabled. The tube still changes; it just will not be there next
    // time, which is the whole of what is lost.
  }
  // A coating changes the void, and the browser's own chrome is part of the
  // medium, so it is re-read here as the flip does it.
  set(current());
  return next;
}

/** Follow the system for as long as the reader hasn't expressed a preference. */
export function followSystem(onChange) {
  if (document.cookie.includes(`${KEY}=`)) return;
  const query = matchMedia('(prefers-color-scheme: light)');
  query.addEventListener('change', (event) => {
    onChange?.(set(event.matches ? 'light' : 'dark'));
  });
}
