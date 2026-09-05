/* ── contrast.js ────────────────────────────────────────────────────────────
   Canonical copy: Keraunos/src/lib/contrast.js. Byte-identical in Keraunos,
   Tyche and Steropes, the way crt.css is; edit one and fan out to all three.

   Imports nothing on purpose. A copy that reached for its project's own token
   list would be a different function in each repo, which is the drift this file
   exists to end. Keraunos derives its contrast inside palette.js, alongside the
   phosphor, and takes only the table from here. */

/* How far every mark sits from its own ground, as a factor on the distance the
   stylesheet drew it at. Everything that is not the ground moves away from it
   or toward it together, so the hierarchy the palette was built with survives
   at every setting: line under land under dim under text. */
export const CONTRASTS = { soft: 0.82, normal: 1, hard: 1.18, max: 1.36 };

/* Everything drawn on the tube. The two grounds are not in here: contrast is a
   distance from them, so moving them moves nothing. A project with marks of its
   own hands them over as `extra`. */
const MARKS = ["--c-line", "--c-land", "--c-dim", "--c-text", "--c-strike", "--ink-rest"];

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function parse(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const n = parseInt(digits, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * Every mark slid along the line between it and the ground, away or toward.
 *
 * One factor for all of them, which is the point: the hierarchy the palette was
 * drawn with is a set of distances, and scaling them together keeps it. Signed,
 * so the same arithmetic serves light emitted on black and ink laid on paper.
 *
 * The stylesheet stays the source of truth. Our own overrides are cleared
 * first, or the next call would be reading the last one's output and the tube
 * would walk away from the ground one press at a time.
 *
 * Storing the choice is the caller's, since where a setting lives is a property
 * of the instrument rather than of the arithmetic.
 */
export function applyContrast(name, extra = []) {
  const next = name in CONTRASTS ? name : "normal";
  const root = document.documentElement;
  const marks = [...MARKS, ...extra];
  for (const mark of marks) root.style.removeProperty(mark);

  const reach = CONTRASTS[next];
  if (reach !== 1) {
    const css = getComputedStyle(root);
    const ground = parse(css.getPropertyValue("--c-void"));
    for (const mark of marks) {
      const rgb = ground && parse(css.getPropertyValue(mark));
      if (!rgb) continue;
      root.style.setProperty(
        mark,
        hex(rgb.map((c, i) => clamp(ground[i] + (c - ground[i]) * reach)))
      );
    }
  }

  return next;
}
