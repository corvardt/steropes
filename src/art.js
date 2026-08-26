// The artwork: 256 bits of sky, as a plate.
//
// The figure is a walk, the same form the page draws large, because a piece of
// generative art that shares nothing with the instrument that made it is just
// decoration with a serial number. 256 bits is 128 steps, which is short enough
// that no two plates look alike and long enough to have a shape.
//
// The seed is printed under it. That is not a watermark: it is the whole of the
// input, so anyone can redraw the plate from the caption and check that this
// image is what those bits make.

const W = 1000;
const H = 1240;

/**
 * The figure, shared by every plate this file prints.
 *
 * Two bits a step, four directions, and the view derived from the extent of the
 * path — identical to the hero, so a plate is a fragment of the same drawing
 * rather than a different idea. It was inlined in `plate` until the exposure
 * needed the same walk from a different number of bytes, at which point a
 * second copy would have been two drawings free to drift apart.
 *
 * The line thins as the walk gets long. A five-minute exposure is thousands of
 * steps in the box a hundred and twenty-eight were drawn in, and at a stroke of
 * 3 it fills to a solid block; below 1 it stops being a line at all.
 */
function drawWalk(ctx, bytes, box, ink) {
  const STEPS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const pts = [{ x: 0, y: 0 }];
  for (const b of bytes) {
    for (let s = 6; s >= 0; s -= 2) {
      const [dx, dy] = STEPS[(b >> s) & 3];
      const last = pts[pts.length - 1];
      pts.push({ x: last.x + dx, y: last.y + dy });
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const s = Math.min(box.w / Math.max(1, maxX - minX), box.h / Math.max(1, maxY - minY));
  const ox = box.x + box.w / 2 - ((minX + maxX) / 2) * s;
  const oy = box.y + box.h / 2 - ((minY + maxY) / 2) * s;
  const px = (p) => [ox + p.x * s, oy + p.y * s];

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, Math.min(3, 17 / pts.length ** 0.35));
  ctx.strokeStyle = ink("--c-text");
  ctx.beginPath();
  ctx.moveTo(...px(pts[0]));
  for (const p of pts.slice(1)) ctx.lineTo(...px(p));
  ctx.stroke();

  // Where it started and where it ended. The end is the reserved mark.
  ctx.fillStyle = ink("--walk-tail");
  ctx.beginPath();
  ctx.arc(...px(pts[0]), 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink("--c-strike");
  ctx.beginPath();
  ctx.arc(...px(pts[pts.length - 1]), 7, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw the plate. `ink` resolves a palette token so this matches the page. */
export function plate(bytes, provenance, ink) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = ink("--c-void");
  ctx.fillRect(0, 0, W, H);
  drawWalk(ctx, bytes, { x: 110, y: 110, w: W - 220, h: 780 }, ink);

  // ── caption ────────────────────────────────────────────────────────────────
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  const mono = (size, weight = 400) =>
    `${weight} ${size}px "IBM Plex Mono", ui-monospace, monospace`;

  ctx.fillStyle = ink("--c-line");
  ctx.fillRect(110, 950, W - 220, 1);

  ctx.fillStyle = ink("--c-dim");
  ctx.font = mono(20);
  ctx.fillText("ENTROPIC", 110, 1000);

  const when = provenance.from ? new Date(Number(provenance.from / 1000000n)) : null;
  const stamp = when ? when.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "";
  ctx.textAlign = "right";
  ctx.fillText(`${provenance.strikes} strikes`, W - 110, 1000);
  ctx.textAlign = "left";

  // The seed, in four rows of sixteen bytes. Readable, and the point of the
  // plate: this image is what these bits make.
  ctx.fillStyle = ink("--c-text");
  ctx.font = mono(21);
  for (let i = 0; i < 4; i++) {
    const row = hex
      .slice(i * 16, i * 16 + 16)
      .match(/.{2}/g)
      .join(" ");
    ctx.fillText(row, 110, 1048 + i * 30);
  }

  ctx.fillStyle = ink("--c-dim");
  ctx.font = mono(18);
  ctx.textAlign = "right";
  if (stamp) ctx.fillText(stamp, W - 110, 1048);
  ctx.fillText("256 bits from lightning", W - 110, 1078);
  ctx.textAlign = "left";

  return { canvas, hex };
}

/**
 * An exposure plate: a window of weather rather than a fixed number of bits.
 *
 * Same figure, different caption, and the difference is the whole point of it.
 * The artwork prints its seed in full because 32 bytes fit on a page and the
 * claim is "this image is what these bits make", checkable from the caption
 * alone. An exposure runs to hundreds of bytes and cannot make that claim on
 * paper, so it makes a different one: the window it was open, what fell into it,
 * and the rate that implies. Two plates of the same length and different density
 * are a legible reading of two different skies.
 *
 * The bytes are still handed back whole by `copy the seed`, so nothing is
 * actually lost — only moved off the picture and onto the clipboard.
 */
export function exposurePlate(bytes, provenance, span, ink) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = ink("--c-void");
  ctx.fillRect(0, 0, W, H);
  drawWalk(ctx, bytes, { x: 110, y: 110, w: W - 220, h: 860 }, ink);

  const mono = (size, weight = 400) =>
    `${weight} ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  const clock = (t) => new Date(Number(t / 1000000n)).toISOString().replace("T", " ").slice(0, 19);

  ctx.fillStyle = ink("--c-line");
  ctx.fillRect(110, 1010, W - 220, 1);

  ctx.fillStyle = ink("--c-dim");
  ctx.font = mono(20);
  ctx.fillText("ENTROPIC", 110, 1060);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(span / 1000)}s exposure`, W - 110, 1060);
  ctx.textAlign = "left";

  // The reading. Density is the weather, so the rate is printed beside the
  // count rather than left to be worked out from it.
  const rate = span > 0 ? (provenance.strikes / (span / 1000)).toFixed(1) : "0.0";
  ctx.fillStyle = ink("--c-text");
  ctx.font = mono(26);
  ctx.fillText(`${provenance.strikes} strikes · ${rate}/s · ${bytes.length} bytes`, 110, 1116);

  ctx.fillStyle = ink("--c-dim");
  ctx.font = mono(18);
  if (provenance.from) {
    ctx.fillText(`${clock(provenance.from)} → ${clock(provenance.to)} UTC`, 110, 1158);
  }

  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return { canvas, hex };
}

/** Hand the plate to the viewer as a file. */
export function download(canvas, name) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // Revoked on the next turn of the loop: revoking synchronously can beat the
    // download starting in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
