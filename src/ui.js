// The panel: the walk, the readouts, and the badges.
//
// The walk observes the byte stream rather than drawing from the pool. What is
// on screen is therefore a picture of what arrived, and the pool it fills is
// untouched by having been looked at, which matters once draws start consuming
// it in step 4.

import { createSource } from "./source.js";
import { createPool, toBits } from "./pool.js";
import { runAll, MIN_BITS, CHI2_MIN_BYTES } from "./tests.js";
import { createReader, DRAWS, rangeDraw } from "./draw.js";
import { plate, download } from "./art.js";

const $ = (id) => document.getElementById(id);

// The relay's hostname is deployment configuration, not something to compile in.
// Until it is set, `?feed=wss://…` drives the page, which is also how dev points
// straight at the upstream, with `&hello` to send the subscription the relay
// would otherwise send itself.
const params = new URLSearchParams(location.search);
const FEED = params.get("feed") ?? "";
const HELLO = params.has("hello") ? JSON.stringify({ a: 111 }) : null;

// The palette is read back from the stylesheet so the canvas and the CSS cannot
// disagree, the stylesheet stays the source of truth for both.
const css = getComputedStyle(document.documentElement);
const ink = (name) => css.getPropertyValue(name).trim();

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── the walk ─────────────────────────────────────────────────────────────────

const canvas = $("walk");
const ctx = canvas.getContext("2d");

// Walk-space, in integer steps. The view that maps it to pixels is derived every
// frame from the extent of the path, so the drawing frames itself and the zoom
// level is itself a readout: how far the sky has wandered since you arrived.
const pts = [{ x: 0, y: 0 }];
const MAX_PTS = 6000;
const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

let carry = [];

function walk(bytes) {
  for (const b of bytes) for (let i = 7; i >= 0; i--) carry.push((b >> i) & 1);
  // Two bits a step, four directions, no remainder wasted.
  while (carry.length >= 2) {
    const [dx, dy] = STEPS[(carry.shift() << 1) | carry.shift()];
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + dx, y: last.y + dy });
  }
  while (pts.length > MAX_PTS) pts.shift();
}

const view = { cx: 0, cy: 0, s: 8 };

function frame() {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const pad = 48;
  const target = Math.min(
    (w - pad * 2) / Math.max(1, maxX - minX),
    (h - pad * 2) / Math.max(1, maxY - minY)
  );
  // Eased so the rescale reads as the instrument adjusting rather than jumping.
  const k = still ? 1 : 0.06;
  view.s += (Math.min(target, 14) - view.s) * k;
  view.cx += ((minX + maxX) / 2 - view.cx) * k;
  view.cy += ((minY + maxY) / 2 - view.cy) * k;

  const px = (p) => [w / 2 + (p.x - view.cx) * view.s, h / 2 + (p.y - view.cy) * view.s];

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 1;

  // The tail, in one pass and one colour: everything older than the last stretch
  // is settled history and does not need to be distinguished within itself.
  const HOT = 240;
  const tail = Math.max(0, pts.length - HOT);
  if (tail > 1) {
    ctx.strokeStyle = ink("--walk-tail");
    ctx.beginPath();
    ctx.moveTo(...px(pts[0]));
    for (let i = 1; i < tail; i++) ctx.lineTo(...px(pts[i]));
    ctx.stroke();
  }

  // The recent stretch, in bands that brighten toward now. Eight strokes rather
  // than one per segment: the eye reads the gradient, not the steps.
  const BANDS = 8;
  const span = pts.length - tail;
  if (span > 1) {
    const size = Math.ceil(span / BANDS);
    for (let b = 0; b < BANDS; b++) {
      const from = tail + b * size;
      const to = Math.min(pts.length, from + size + 1);
      if (to - from < 2) continue;
      // Ramped over --c-text rather than --c-dim, so the recent stretch actually
      // reads as brighter than the settled tail it grows out of.
      ctx.globalAlpha = 0.3 + 0.7 * ((b + 1) / BANDS);
      ctx.strokeStyle = ink("--c-text");
      ctx.beginPath();
      ctx.moveTo(...px(pts[from]));
      for (let i = from + 1; i < to; i++) ctx.lineTo(...px(pts[i]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The head. White is reserved for this: the bit that just came out of the sky.
  const head = px(pts[pts.length - 1]);
  ctx.fillStyle = ink("--c-hot");
  if (!still) {
    ctx.shadowColor = ink("--bloom");
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  ctx.arc(head[0], head[1], 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  requestAnimationFrame(frame);
}

// ── readouts ─────────────────────────────────────────────────────────────────

const pool = createPool();
let seen = 0;
let kept = 0;
const recent = [];

function readouts() {
  $("bits").textContent = pool.bitsAvailable.toLocaleString();
  const pct = pool.available / pool.capacity;
  $("gauge").style.width = `${(pct * 100).toFixed(1)}%`;
  $("pool-pct").textContent = `${Math.round(pct * 100)}%`;
  $("seen").textContent = seen.toLocaleString();
  $("kept").textContent = kept.toLocaleString();
  $("accept").textContent = seen ? `${Math.round((100 * kept) / seen)}%` : "·";

  const bytes = pool.peek();
  const tailBytes = [...bytes.slice(-40)].reverse();
  $("stream").innerHTML = tailBytes
    .map((b, i) => {
      const hex = b.toString(16).padStart(2, "0");
      return i === 0 ? `<b>${hex}</b>` : hex;
    })
    .join(" ");
}

// Strikes per second over a rolling half-minute, so the figure settles instead
// of twitching with every arrival.
setInterval(() => {
  const now = Date.now();
  while (recent.length && now - recent[0] > 30000) recent.shift();
  $("rate").textContent = recent.length ? `${(recent.length / 30).toFixed(1)}/s` : "·";
}, 1000);

// ── badges ───────────────────────────────────────────────────────────────────

// Four tests at p<0.01 throw a false failure on about 4% of evaluations. That is
// what the threshold means, not a defect, but a badge that flips on a single
// evaluation would go red on good data several times an hour and teach exactly
// the wrong lesson about what a failing test is. So a badge only turns over
// after three consecutive failures, and recovers on the first pass.
const STREAK = 3;
const fails = new Map();
const history = new Map();

function badges() {
  const bits = toBits(pool.peek());
  const host = $("tests");
  if (bits.length < MIN_BITS) {
    host.innerHTML = `<p class="stream">waiting for the sky, ${bits.length} of ${MIN_BITS} bits</p>`;
    return;
  }

  const results = runAll(bits);
  // Bytes, not bits: the pool figure above already reports bits, and bytes is
  // the unit chi2 is gated on, so while it waits this readout says how far off
  // it is rather than repeating a number the reader already has.
  const bytes = bits.length / 8;
  $("tested").textContent =
    bytes < CHI2_MIN_BYTES ? `${bytes} of ${CHI2_MIN_BYTES} bytes` : `${bytes.toLocaleString()} bytes`;

  host.innerHTML = results
    .map((r) => {
      const streak = r.verdict === "fail" ? (fails.get(r.name) ?? 0) + 1 : 0;
      fails.set(r.name, streak);
      const shown = r.verdict === "fail" && streak < STREAK ? "pass" : r.verdict;

      const h = history.get(r.name) ?? [];
      h.push(Number.isNaN(r.p) ? 0 : r.p);
      if (h.length > 24) h.shift();
      history.set(r.name, h);

      const points = h
        .map((p, i) => `${(i / Math.max(1, h.length - 1)) * 56},${12 - Math.min(1, p) * 11}`)
        .join(" ");

      return `<div class="test" data-verdict="${shown}" title="${r.detail}">
        <span class="name">${r.name}</span>
        <svg class="spark" viewBox="0 0 56 12" aria-hidden="true"><polyline points="${points}" /></svg>
        <span class="p">${Number.isNaN(r.p) ? "·" : `p=${r.p.toFixed(3)}`}</span>
      </div>`;
    })
    .join("");
}

// ── draws ────────────────────────────────────────────────────────────────────

// One draw at a time, and its reader is created when the button is pressed. That
// is what makes "fresh bits" structural rather than a promise: a reader that did
// not exist a moment ago cannot be holding anything the pool already had.
let draw = null;

const card = $("card");
const out = $("draw-out");
const buttons = () => document.querySelectorAll(".bar button, .bar input");

const clock = (t) => new Date(Number(t / 1000000n)).toISOString().slice(11, 19);

function closeCard() {
  card.hidden = true;
}

/** The wait, reported rather than hidden. It is the instrument doing the one
 *  thing that makes its output worth having, so it says what it is waiting for
 *  and roughly how long that should take at the rate the sky is running. */
function waiting() {
  if (!draw) return;
  const have = draw.reader.provenance().strikes;
  const need = draw.spec.strikes ?? 1;
  const perSec = recent.length / 30;
  const left = Math.max(0, need - have);
  const eta = perSec > 0.1 && left ? `, about ${Math.ceil(left / perSec)}s at this rate` : "";
  const done = have >= need;

  out.innerHTML = `
    <p class="waiting">waiting for the sky
      <small>${have} of ~${need} strike${need > 1 ? "s" : ""}${done ? ", a little longer" : eta}</small>
    </p>
    <div class="track"${done ? " data-indeterminate" : ""}>
      <span style="width:${Math.min(100, (have / need) * 100).toFixed(0)}%"></span>
    </div>`;
}

function action(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function present(spec, value, prov, again) {
  out.innerHTML = "";
  const actions = document.createElement("div");
  actions.className = "actions";

  if (spec.kind === "art") {
    const { canvas, hex } = plate(value, prov, ink);
    canvas.className = "plate";
    out.append(canvas);
    actions.append(action("save the plate", () => download(canvas, `entropic-${hex.slice(0, 8)}.png`)));
    actions.append(action("copy the seed", () => navigator.clipboard?.writeText(hex)));
  } else if (spec.kind === "deck") {
    const ul = document.createElement("ul");
    ul.className = "deck";
    for (const c of value) {
      const li = document.createElement("li");
      li.textContent = c;
      ul.append(li);
    }
    out.append(ul);
    actions.append(action("copy", () => navigator.clipboard?.writeText(value.join(" "))));
  } else {
    const p = document.createElement("p");
    p.className = spec.kind === "mono" ? "result mono" : "result";
    p.textContent = value;
    out.append(p);
    actions.append(action("copy", () => navigator.clipboard?.writeText(value)));
  }

  actions.append(action("draw again", again));
  out.append(actions);

  const note = document.createElement("p");
  note.className = "prov";
  note.textContent = prov.from
    ? `${prov.strikes} strike${prov.strikes > 1 ? "s" : ""} consumed, ${clock(prov.from)} to ${clock(prov.to)} UTC`
    : "no strikes consumed";
  out.append(note);
}

async function begin(spec) {
  if (draw) return;
  draw = { reader: createReader(), spec };

  card.hidden = false;
  $("draw-label").textContent = spec.label;
  for (const b of buttons()) b.disabled = true;
  waiting();

  const value = await spec.run(draw.reader);
  const prov = draw.reader.provenance();
  draw = null;
  for (const b of buttons()) b.disabled = false;

  present(spec, value, prov, () => begin(spec));
  $("card-close").focus();
}

// Built from the DRAWS table rather than written out, so a new draw is one entry
// in draw.js and nothing here.
$("draw-buttons").innerHTML = Object.keys(DRAWS)
  .map((k) => `<button type="button" data-draw="${k}">${DRAWS[k].label}</button>`)
  .join("");
$("draw-buttons").addEventListener("click", (e) => {
  const kind = e.target.closest("button")?.dataset.draw;
  if (kind) begin(DRAWS[kind]);
});

$("range-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const min = Math.trunc(Number($("range-min").value));
  const max = Math.trunc(Number($("range-max").value));
  // A range this wide would need five bytes per attempt and means nothing anyone
  // asked for, so it is refused at the edge rather than deep inside below().
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) + 1 > 2 ** 32) return;
  begin(rangeDraw(min, max));
});

$("card-close").addEventListener("click", closeCard);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !card.hidden && !draw) closeCard();
});

// ── run ──────────────────────────────────────────────────────────────────────

const state = $("state");
const say = (phase, text) => {
  state.dataset.phase = phase;
  state.textContent = text;
};

if (!FEED) {
  say("down", "no feed configured: append ?feed=wss://…");
} else {
  createSource({
    url: FEED,
    hello: HELLO,
    onStatus: ({ phase }) =>
      say(
        phase,
        { connecting: "connecting", live: "receiving", down: "link lost, retrying", error: "link error" }[
          phase
        ] ?? phase
      ),
    onFrame: (_f, accepted) => {
      seen++;
      if (accepted) {
        kept++;
        recent.push(Date.now());
      }
    },
    onBytes: (bytes, frame) => {
      pool.push(bytes);
      walk(bytes);
      // Only ever reaches a draw that is already waiting.
      draw?.reader.push(bytes, frame);
      waiting();
    },
  });
}

readouts();
badges();
setInterval(readouts, 250);
setInterval(badges, 2000);
requestAnimationFrame(frame);
