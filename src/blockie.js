// A blockie, drawn straight from the sky.
//
// The tile rules are lifted from Keraunos/ignored/blockie.ts, which is in turn
// the classic MyCrypto/ethereum-blockies construction, and Tyche draws forty a
// roll from the npm build of the same thing. What is taken is the part that
// decides what a blockie looks like: an 8x8 grid whose left four columns are
// mirrored, cells weighted `floor(r * 2.3)`, and three HSL colours drawn in the
// order primary, background, spot.
//
// What is not taken is the other two thirds of that file, a hand-written GIF89a
// encoder with its own LZW packer. It exists so a tile can become a base64 data
// URI without a canvas. This page already has a canvas and already saves through
// `toBlob`, so re-implementing GIF here would be work in service of nothing.
//
// The one real departure is where the randomness comes from. Both of those
// implementations run a seed string through an xorshift PRNG and let the PRNG
// paint the tile, which is correct when the tile must be reproducible from an
// address. Here it would be backwards: a generator expanding a seed is the thing
// this page exists not to lean on. So every decision below reads fresh strikes
// directly, and no generator sits in between. Same tile, different provenance.
//
// Colour, and this is the only place the page has any. The rule elsewhere is
// that white is reserved and the single amber means a failing test, so nothing
// in the interface may be colourful. A blockie is not interface. It is the
// output, it sits inside a bordered plate, and its hues are themselves
// lightning. That is the whole of the exception.

import { below } from "./draw.js";

const SIZE = 8; // 8x8, of which the left four columns are mirrored

/** A float in [0, 1) from one fresh byte. */
const unit = async (r) => (await r.byte()) / 256;

/**
 * HSL exactly as the original picks it: any hue quantised to 360 steps, a strong
 * but not lurid saturation, and a lightness summed from four draws so it
 * clusters mid-range instead of throwing out tiles that are nearly black or
 * nearly white.
 */
async function colour(r) {
  const h = Math.floor((await unit(r)) * 360) / 360;
  const s = ((await unit(r)) * 60 + 40) / 100;
  const l = ((await unit(r)) + (await unit(r)) + (await unit(r)) + (await unit(r))) * 25 / 100;
  return hsl(h, s, l);
}

function hsl(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/**
 * The tile as data: a 64-cell grid of 0, 1, 2 and the three colours those mean.
 *
 * The original weights cells with `floor(random * 2.3)`, which is 10/23, 10/23,
 * 3/23. Drawing below(23) and cutting at 10 and 20 reproduces those weights
 * exactly and without a float in the way, which also means the weighting is
 * unbiased rather than merely close.
 *
 * Colours come off the stream in the original's order, primary then background
 * then spot, even though cell value 0 means background. Keeping the draw order
 * is what makes this the same construction rather than a lookalike.
 */
export async function blockie(reader) {
  const half = [];
  for (let i = 0; i < (SIZE / 2) * SIZE; i++) {
    const v = await below(reader, 23);
    half.push(v < 10 ? 0 : v < 20 ? 1 : 2);
  }

  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    const row = half.slice(y * (SIZE / 2), y * (SIZE / 2) + SIZE / 2);
    cells.push([...row, ...[...row].reverse()]);
  }

  const primary = await colour(reader);
  const background = await colour(reader);
  const spot = await colour(reader);

  return { cells, colours: { background, primary, spot } };
}

/** The tile as a plate: the image, and the grid it was made from, printed. */
export function render(tile, provenance, ink) {
  const px = 96; // cell size, so the tile is 768 square
  const pad = 110;
  const W = SIZE * px + pad * 2;
  const H = W + 300;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = ink("--c-void");
  ctx.fillRect(0, 0, W, H);

  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  // Index order matches the original's colour table: 0 background, 1 primary,
  // 2 spot.
  const paint = [tile.colours.background, tile.colours.primary, tile.colours.spot];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      ctx.fillStyle = rgb(paint[tile.cells[y][x]]);
      ctx.fillRect(pad + x * px, pad + y * px, px, px);
    }
  }

  const mono = (size, weight = 400) =>
    `${weight} ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  const bottom = pad + SIZE * px;

  ctx.fillStyle = ink("--c-line");
  ctx.fillRect(pad, bottom + 60, W - pad * 2, 1);

  ctx.fillStyle = ink("--c-dim");
  ctx.font = mono(20);
  ctx.fillText("STEROPES", pad, bottom + 110);
  ctx.textAlign = "right";
  ctx.fillText(`${provenance.strikes} strikes`, W - pad, bottom + 110);
  ctx.textAlign = "left";

  // The tile as text, so the picture can be checked against the numbers that
  // made it. The same reason the artwork plate prints its seed.
  ctx.fillStyle = ink("--c-text");
  ctx.font = mono(19);
  ctx.fillText(tile.cells.map((row) => row.join("")).join(" "), pad, bottom + 150);

  ctx.fillStyle = ink("--c-dim");
  ctx.font = mono(18);
  const when = provenance.from ? new Date(Number(provenance.from / 1000000n)) : null;
  if (when) {
    ctx.fillText(when.toISOString().replace("T", " ").slice(0, 19) + " UTC", pad, bottom + 190);
  }
  // Hex rather than `rgb(r, g, b)`: three of the latter run wide enough to
  // collide with the timestamp on the same line, which is how the first plate
  // came out.
  ctx.textAlign = "right";
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  ctx.fillText(paint.map(hex).join(" "), W - pad, bottom + 190);
  ctx.textAlign = "left";

  return { canvas, text: tile.cells.map((row) => row.join("")).join("") };
}

// Registered from this side rather than in draw.js's table, so the dependency
// runs one way: this file reads the unbiased primitives out of draw.js, and
// draw.js never needs to know it exists. The alternative was a circular import
// that happens to work because function declarations hoist, which is a thing
// that works right up until someone reorders it.
export const blockieDraw = {
  label: "blockie",
  // 32 cells at a byte each, plus six bytes for each of three colours.
  strikes: 25,
  kind: "blockie",
  run: blockie,
};
