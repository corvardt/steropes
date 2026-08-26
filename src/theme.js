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

/* How far every mark sits from its own ground, as a factor on the distance the
   stylesheet drew it at. Keraunos's numbers, so a reader who sets one
   instrument to hard reads the same tube here. */
export const CONTRASTS = { soft: 0.82, normal: 1, hard: 1.18, max: 1.36 };

/* Everything drawn on the tube. The two grounds are not in here: contrast is a
   distance from them, so moving them moves nothing. */
const MARKS = [
  "--c-line",
  "--c-land",
  "--c-dim",
  "--c-text",
  "--c-strike",
  "--c-fail",
  "--ink-rest",
  "--walk-tail",
];

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function parse(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const n = parseInt(digits, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

export function contrast() {
  const stored = recall("contrast", "normal");
  return stored in CONTRASTS ? stored : "normal";
}

/**
 * Every mark slid along the line between it and the ground, away or toward.
 *
 * One factor for all of them, which is the point: the hierarchy the palette was
 * drawn with is a set of distances, and scaling them together keeps it. Signed,
 * so the same arithmetic serves light emitted on black and ink laid on paper.
 *
 * The stylesheet stays the source of truth. Our own overrides are cleared
 * first, or the second call would be reading the first one's output and the
 * tube would walk away from the ground one press at a time.
 */
export function applyContrast(name) {
  const next = name in CONTRASTS ? name : "normal";
  const root = document.documentElement;
  for (const mark of MARKS) root.style.removeProperty(mark);

  const reach = CONTRASTS[next];
  if (reach !== 1) {
    const css = getComputedStyle(root);
    const ground = parse(css.getPropertyValue("--c-void"));
    for (const mark of MARKS) {
      const rgb = ground && parse(css.getPropertyValue(mark));
      if (!rgb) continue;
      root.style.setProperty(
        mark,
        hex(rgb.map((c, i) => clamp(ground[i] + (c - ground[i]) * reach)))
      );
    }
  }

  remember("contrast", next);
  return next;
}

/* The three pieces of glass a reader can take off. Attributes rather than a
   class on each layer: the medium owns what they look like, and this only says
   whether the tube has them. The drift is the faintest of them and the most
   expensive to composite, which is why it is worth being able to remove. */
export const GLASS = ["scanlines", "sweep", "drift"];

export const glass = (part) => recall(part, "on") !== "off";

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
