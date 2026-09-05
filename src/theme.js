/* ── theme.js ───────────────────────────────────────────────────────────────
   Two media, not one palette inverted. The choice is written to a cookie on
   `.corvardt.com` rather than localStorage, so it carries from the index to every
   project subdomain: the whole domain behaves as one set, not as several.

   Loaded with `defer`; the medium itself is resolved by the inline script in
   the document head, before first paint, so the tube never flashes on paper. */

import { CONTRASTS, applyContrast as slide } from './contrast.js';

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
  // The contrast is a distance from the ground, and the ground has just moved,
  // so it is re-derived from whatever the stylesheet now declares.
  applyContrast(contrast());
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

/* ── The glass ───────────────────────────────────────────────────────────────
   Contrast, the scanlines and the refresh sweep, the three the set's other
   instruments hand over. All three are this instrument's own rather than the
   domain's, so they live beside the coating in localStorage. */

const recall = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const remember = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage disabled. The tube still changes; it just will not be there next
    // time, which is the whole of what is lost.
  }
};

/* The two this instrument adds to the set's marks: the failure amber and the
   walk's settled history, which is the subject of the page rather than a rule
   on it. */
const MARKS = ["--c-fail", "--walk-tail"];

export function contrast() {
  const stored = recall("contrast", "normal");
  return stored in CONTRASTS ? stored : "normal";
}

/** The set's arithmetic, over this instrument's marks, remembered here. */
export function applyContrast(name) {
  const next = slide(name, MARKS);
  remember("contrast", next);
  return next;
}

/* The three pieces of glass a reader can take off. Attributes rather than a
   class on each layer: the medium owns what they look like, and this only says
   whether the tube has them. The drift is the faintest of them and the most
   expensive to composite, which is why it ships off and is opt-in; the markup
   carries `data-drift='off'` for the frame before this runs. */
export const GLASS = ["scanlines", "sweep", "drift"];

export const glass = (part) => recall(part, part === "drift" ? "off" : "on") !== "off";

export function applyGlass(part, on) {
  document.documentElement.dataset[part] = on ? "on" : "off";
  remember(part, on ? "on" : "off");
  return on;
}

/* Restored here rather than in the document head, where the medium and the
   coating are resolved: the sweep and the scanlines are decoration and can
   arrive a frame late, and the contrast has to be derived from colours the
   stylesheet has finished resolving. */
applyContrast(contrast());
for (const part of GLASS) applyGlass(part, glass(part));
