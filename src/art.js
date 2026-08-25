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

/** Draw the plate. `ink` resolves a palette token so this matches the page. */
export function plate(bytes, provenance, ink) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = ink("--c-void");
  ctx.fillRect(0, 0, W, H);

  // Two bits a step, four directions. Identical to the hero, so a plate is a
  // fragment of the same drawing rather than a different idea.
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

  const box = { x: 110, y: 110, w: W - 220, h: 780 };
  const s = Math.min(box.w / Math.max(1, maxX - minX), box.h / Math.max(1, maxY - minY));
  const ox = box.x + box.w / 2 - ((minX + maxX) / 2) * s;
  const oy = box.y + box.h / 2 - ((minY + maxY) / 2) * s;
  const px = (p) => [ox + p.x * s, oy + p.y * s];

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
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
  ctx.fillStyle = ink("--c-hot");
  ctx.beginPath();
  ctx.arc(...px(pts[pts.length - 1]), 7, 0, Math.PI * 2);
  ctx.fill();

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
