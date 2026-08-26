/* ── spark.js ─────────────────────────────────────────────────────────────────
   The badge trace: what the sparkline plots, and why it is not the p-value.

   Its own module because the transform is the whole reason the picture means
   anything, and a transform nobody can run is a transform nobody can check.
   `npm test` grades it directly. */

// Drawn against a linear 0..1 axis, the threshold that decides the verdict sits
// at 0.01: the bottom one percent of the chart, a tenth of a pixel at this
// height. The one line that gives the picture meaning was invisible, so the
// trace was decoration — a wiggle with no reading on it.
//
// So it plots headroom instead: how many decades of room the test has before it
// fails. Zero is exactly on the threshold, positive is passing, negative is
// failing, and because it is normalised against each test's own alpha, one rule
// drawn at zero means the same thing on all four rows.
//
// It also folds the two-sided case in. chi2 fails for being too flat as well as
// too lumpy, and what matters there is the nearer tail, so `min(p, 1-p)` is the
// quantity and a trace diving toward the rule reads the same whichever tail it
// is diving into. That is the whole rigged-stream argument, drawn.

export const SPARK_W = 96;
export const SPARK_H = 20;
// Two decades of headroom above the rule and one below: past a tenth of the
// threshold the test is failing so badly that how badly stops being the
// question, and the clamp keeps a single catastrophic evaluation from
// flattening every other point in the window against the top.
const HEAD_HI = 2;
const HEAD_LO = -1;

export function headroom(r) {
  if (Number.isNaN(r.p)) return null;
  const twoSided = r.tail === "both";
  const margin = twoSided ? Math.min(r.p, 1 - r.p) : r.p;
  const alpha = twoSided ? 0.005 : 0.01;
  return Math.log10(Math.max(margin, 1e-6) / alpha);
}

export const sparkY = (v) => {
  const t = (Math.min(HEAD_HI, Math.max(HEAD_LO, v)) - HEAD_LO) / (HEAD_HI - HEAD_LO);
  return (SPARK_H - 1 - t * (SPARK_H - 2)).toFixed(1);
};

/** Only the readings that exist. A test still waiting for its minimum sample has
 *  no p-value, and the old trace plotted that absence as zero — the worst score
 *  there is — so chi2 spent its first twenty minutes drawing a flatline along
 *  the floor while it was merely counting bytes. Absence leaves a gap now. */
export function trace(history) {
  const step = SPARK_W / Math.max(1, history.length - 1);
  const runs = [];
  let run = [];
  history.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push(`${(i * step).toFixed(1)},${sparkY(v)}`);
  });
  if (run.length) runs.push(run);
  // A lone reading is a point, not a line, and a one-point polyline draws
  // nothing at all.
  return runs
    .map((r) =>
      r.length === 1
        ? `<circle cx="${r[0].split(",")[0]}" cy="${r[0].split(",")[1]}" r="0.9" />`
        : `<polyline points="${r.join(" ")}" />`
    )
    .join("");
}
