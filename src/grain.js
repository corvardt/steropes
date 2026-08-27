// The grain: the pool's own bytes, looked at rather than scored.
//
// The badges below give a verdict on this sample; these two tiles are the same
// sample with no verdict on it at all, which is the one thing a p-value cannot
// do. Both are old apparatus, and both fail loudly rather than subtly: a source
// with structure in it does not produce a slightly worse picture here, it
// produces an obviously different one.

/** Backing store to CSS pixels, DPR included. Shared because both tiles are
 *  square, cleared and redrawn whole every time. */
function fit(canvas) {
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = w * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, w);
  return { ctx, w };
}

const ROW = 128; // bits a row, so a full 2KB ring is exactly a square

/**
 * One bit a cell, MSB first, filling from the top.
 *
 * The eye is a better lumpiness detector than any of the four tests and it
 * needs no minimum sample: banding, drift and repeats are visible here in the
 * first few rows, long before chi2 has enough bytes to say anything. It is also
 * the only readout on the page where the pool filling is legible as an area
 * rather than as a number climbing.
 */
export function raster(canvas, bytes, colour) {
  const { ctx, w } = fit(canvas);
  const cell = w / ROW;
  ctx.fillStyle = colour;
  // One path for eight thousand cells: a fill call each would be eight thousand
  // state changes for a picture that is redrawn every couple of seconds.
  ctx.beginPath();
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < 8; j++) {
      if (!((bytes[i] >> (7 - j)) & 1)) continue;
      const n = i * 8 + j;
      ctx.rect((n % ROW) * cell, Math.floor(n / ROW) * cell, cell, cell);
    }
  }
  ctx.fill();
}

/**
 * Consecutive bytes as a point: the spectral test, drawn.
 *
 * Every linear congruential generator ever shipped puts its output on a small
 * number of parallel planes, and in two dimensions that is a visible lattice of
 * diagonals. RANDU is the famous one. Independent bytes have no such structure
 * and give a flat haze, so this tile is a direct picture of the property the
 * serial-correlation badge reports as a number.
 */
export function scatter(canvas, bytes, colour) {
  const { ctx, w } = fit(canvas);
  const dot = Math.max(1, w / 256);
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    ctx.rect((bytes[i] / 256) * w, (bytes[i + 1] / 256) * w, dot, dot);
  }
  ctx.fill();
}
