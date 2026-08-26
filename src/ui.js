// The panel: the walk, the readouts, and the badges.
//
// The walk observes the byte stream rather than drawing from the pool. What is
// on screen is therefore a picture of what arrived, and the pool it fills is
// untouched by having been looked at, which matters once draws start consuming
// it in step 4.

import { createSource } from "./source.js";
import { createPool, toBits } from "./pool.js";
import { runAll, MIN_BITS, CHI2_MIN_BYTES, controlRigged } from "./tests.js";
import { createReader, DRAWS, rangeDraw } from "./draw.js";
import { plate, download } from "./art.js";
import { render as renderBlockie, blockieDraw } from "./blockie.js";
import { SPARK_W, SPARK_H, headroom, sparkY, trace } from "./spark.js";
import { apply, current, followSystem } from "./theme.js";

const $ = (id) => document.getElementById(id);

// The draws the bar offers. blockie is appended here rather than living in
// draw.js's table, which keeps that module free of anything that paints.
const ALL = { ...DRAWS, blockie: blockieDraw };

// The relay's hostname is deployment configuration, not something to compile in,
// so it is a meta tag in the document the deploy actually serves — there is no
// build step here for a `.env` to be substituted into.
//
// `?feed=wss://…` overrides it, which is how dev points straight at the upstream
// instead, with `&hello` to send the subscription the relay would otherwise send
// on your behalf.
const params = new URLSearchParams(location.search);
const CONFIGURED = document.querySelector('meta[name="feed"]')?.content.trim() ?? "";
const FEED = params.get("feed") ?? CONFIGURED;
const HELLO = params.has("hello") ? JSON.stringify({ a: 111 }) : null;

// The palette is read back from the stylesheet so the canvas and the CSS cannot
// disagree, the stylesheet stays the source of truth for both.
const css = getComputedStyle(document.documentElement);
const ink = (name) => css.getPropertyValue(name).trim();

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── the medium ───────────────────────────────────────────────────────────────
//
// Tube or paper, chosen on any project on the domain and carried here by cookie.
// Nothing needs repainting by hand: `css` is live, `ink()` reads through it, and
// the walk is redrawn every frame anyway, so the canvas follows the flip on the
// next frame. A plate already printed keeps the medium it was printed in, which
// is what a print does.

const medium = document.querySelector("[data-medium]");

// The control carries the medium it would hand you, so the visible word is the
// destination rather than the state.
function label(theme) {
  const other = theme === "dark" ? "light" : "dark";
  medium.textContent = other;
  medium.setAttribute("aria-label", `switch to ${other}`);
}

const setMedium = (theme) => label(apply(theme));
const flip = () => setMedium(current() === "dark" ? "light" : "dark");

label(current());
medium.addEventListener("click", flip);
followSystem(label);

// ── the bezel ────────────────────────────────────────────────────────────────
//
// The two bars the whole set wears. The top one carries the link: an indicator
// that is itself a strike counter, the state when there is a state worth naming,
// and which sky is being handed over. The bottom one is the running commentary.
//
// Both matter more here than on an instrument that draws its own subject. A page
// waiting for lightning and a page that has quietly stopped receiving look
// identical, and without a line that says which, the honest answer to "is this
// working" is a shrug.

const pip = $("pip");
const stateEl = $("state");

// Which sky is being handed over, and it is not the relay.
//
// The relay is one socket upstream and however many readers; naming it here
// said `node keraunos-relay`, which is our own hostname read back to us and
// tells you nothing about where the strikes are from. Blitzortung's network is
// a set of nodes — ws1, ws7, ws8 — and which one the relay is on is a real
// reading that changes when it reconnects. It arrives in the relay's control
// frame, so it is not known until one turns up.
//
// Pointed straight at the upstream in dev there is no relay to ask, and the
// URL already names the node, so its first label stands in.
const fallback = (() => {
  try {
    return FEED ? new URL(FEED).hostname.split(".")[0] : null;
  } catch {
    // A feed that will not parse is still a feed we are about to fail to open,
    // and the status line will say so in a moment. Nothing to add here.
    return null;
  }
})();

let host = HELLO ? fallback : null;
const nodeEl = $("node");
const showNode = () => (nodeEl.textContent = host ? `node ${host}` : "no node");
showNode();

// Silent while it is simply working: a state worth naming is a state that is not
// live, which is what makes the named ones read at a glance.
const NAMED = { connecting: "linking", down: "no signal", error: "link error" };

function link(phase, node) {
  if (node !== undefined) {
    host = node;
    showNode();
  }
  pip.dataset.phase = phase;
  const named = NAMED[phase];
  stateEl.textContent = named ? `[ ${named} ]` : "";
  stateEl.hidden = !named;
}

/** Every strike that gets past the dedup filter, marked. Driven from script
 *  rather than a class, because these arrive faster than a CSS animation can be
 *  restarted by hand and the effect is a beat, not a state: the web animation
 *  takes over opacity for its 200ms and hands it straight back to the idle
 *  breathe underneath. */
const beat = () => pip.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], 200);

const messageEl = $("message");
const clockEl = $("clock");

/** One line, replaced rather than appended: this is a readout, not a log. Each
 *  arrives at full white and settles into the interface, the series' decay rule,
 *  so a line that changed is visibly a line that changed. */
function report(text) {
  if (messageEl.textContent === text) return;
  messageEl.textContent = text;
  if (still) return;
  // Restarting a CSS animation needs the class gone for a layout, not just a
  // frame: without the reflow the browser coalesces both writes and nothing
  // replays.
  messageEl.classList.remove("settle");
  void messageEl.offsetWidth;
  messageEl.classList.add("settle");
}

const utc = () => new Date().toISOString().slice(11, 19);
const tick = () => (clockEl.textContent = `${utc()} UTC`);

tick();
setInterval(tick, 1000);

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

// How far along the path the drawing has got. Declared here because walk()
// adjusts it when it trims the oldest end; the easing that drives it, and why
// it exists at all, is with the pen below.
let drawn = 0;

function walk(bytes) {
  for (const b of bytes) for (let i = 7; i >= 0; i--) carry.push((b >> i) & 1);
  // Two bits a step, four directions, no remainder wasted.
  while (carry.length >= 2) {
    const [dx, dy] = STEPS[(carry.shift() << 1) | carry.shift()];
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + dx, y: last.y + dy });
  }
  // Trimming the oldest end slides every index down by one, the pen's included.
  // Left alone, the pen would be carried forward one step per point dropped —
  // an invisible fast-forward that only starts once the walk is long enough to
  // begin trimming, which is the worst kind of jump to go looking for later.
  while (pts.length > MAX_PTS) {
    pts.shift();
    drawn = Math.max(0, drawn - 1);
  }
}

const view = { cx: 0, cy: 0, s: 8 };

// ── the pen ──────────────────────────────────────────────────────────────────
//
// How far along the path the drawing has actually got, as a float in point-index
// space. It exists because the walk does not grow evenly: a frame carries two
// bytes, which is eight steps, and they were all appended between one animation
// frame and the next. At the zoom this thing settles to that is the head jumping
// a hundred pixels, then sitting still for a third of a second, then jumping
// again — the path was smooth and the drawing of it was not.
//
// So the pen eases toward the end of the path instead of being teleported to it.
// It runs a few steps behind during a burst and catches up in the quiet after,
// which is what a plotter does, and the head moves continuously between lattice
// points rather than only ever standing on one.

// e-folds per second. Fast enough that the pen is never visibly behind the sky
// at the rates this feed runs — a couple of steps at 25 a second — and slow
// enough that eight steps arriving at once is a stroke rather than a jump.
const CATCH = 8;
// How quickly the view follows the path it is framing.
const FOLLOW = 2.5;

let lastAt = 0;

function frame(now) {
  // Seconds, and capped: a backgrounded tab hands back a gap of minutes, and an
  // eased value stepped by that much lands on its target exactly as abruptly as
  // no easing at all.
  const dt = lastAt ? Math.min(0.1, (now - lastAt) / 1000) : 0;
  lastAt = now;

  // Rates per second rather than per frame. The old constants were per frame, so
  // the instrument ran at one speed on a 60Hz display and another on a 144Hz
  // one, and slowed down whenever the machine was busy.
  const ease = (rate) => (still ? 1 : 1 - Math.exp(-rate * dt));

  const end = pts.length - 1;
  drawn = still ? end : Math.min(end, drawn + (end - drawn) * ease(CATCH));
  // Close enough to be on it: without this the pen approaches the head
  // asymptotically and the last hundredth of a step never arrives.
  if (end - drawn < 0.01) drawn = end;

  const at = Math.max(0, Math.floor(drawn));
  const frac = drawn - at;
  const next = pts[Math.min(at + 1, end)];
  const pen = {
    x: pts[at].x + (next.x - pts[at].x) * frac,
    y: pts[at].y + (next.y - pts[at].y) * frac,
  };

  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Framed on what has been drawn, not on what has arrived. Measuring the whole
  // path would pull the view out to enclose points the pen has not reached, so
  // the zoom would run ahead of the drawing and the two would disagree.
  let minX = pen.x;
  let maxX = pen.x;
  let minY = pen.y;
  let maxY = pen.y;
  for (let i = 0; i <= at; i++) {
    const p = pts[i];
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
  const k = ease(FOLLOW);
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
  const tail = Math.max(0, at - HOT);
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
  const span = at - tail;
  if (span > 1) {
    const size = Math.ceil(span / BANDS);
    for (let b = 0; b < BANDS; b++) {
      const from = tail + b * size;
      const to = Math.min(at, from + size);
      if (to - from < 1) continue;
      // Ramped over --c-text rather than --c-dim, so the recent stretch actually
      // reads as brighter than the settled tail it grows out of.
      ctx.globalAlpha = 0.3 + 0.7 * ((b + 1) / BANDS);
      ctx.strokeStyle = ink("--c-text");
      ctx.beginPath();
      ctx.moveTo(...px(pts[from]));
      for (let i = from + 1; i <= to; i++) ctx.lineTo(...px(pts[i]));
      // The band that reaches the pen carries the part-drawn step too, so the
      // line grows continuously instead of a whole segment at a time.
      if (to === at) ctx.lineTo(...px(pen));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The head. White is reserved for this: the bit that just came out of the sky.
  const head = px(pen);
  ctx.fillStyle = ink("--c-strike");
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
  // The gauge is the percentage, drawn. Printing it beside the bar as well was
  // one quantity in two places, and the bar is the one that reads at a glance.
  $("gauge").style.width = `${((pool.available / pool.capacity) * 100).toFixed(1)}%`;
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

// One state per badge row. The rigged row uses streak 1 on purpose: hysteresis
// exists to absorb the false failures a live stream throws, and the surrogate is
// deterministic, so holding its red back for three evaluations would only delay
// the one thing it is there to show.
//
// It draws no trace either, and that is the same fact twice. controlRigged(n)
// builds the same counter from the same n every time it is called, so every
// evaluation of the surrogate grades bits identical to the last one's; chi2 and
// serial are saturated besides, at 1.000 and 0.000 for every length from 29,000
// bits to a full pool. Twenty-four points of that is one number drawn twenty-four
// times, and a flat line at the clamp reads as a broken chart rather than as a
// stream that fails the same way every time. The surrogate is a comparison, not
// a history, so it is shown as one.
const live = { fails: new Map(), history: new Map(), streak: STREAK, trace: true };
const rigged = { fails: new Map(), history: new Map(), streak: 1, trace: false };

const MARKS = { pass: "ok", fail: "fail", waiting: "—" };

function renderTests(host, results, state) {
  host.innerHTML = results
    .map((r) => {
      const streak = r.verdict === "fail" ? (state.fails.get(r.name) ?? 0) + 1 : 0;
      state.fails.set(r.name, streak);
      const shown = r.verdict === "fail" && streak < state.streak ? "pass" : r.verdict;

      let chart = '<span class="spark"></span>';
      if (state.trace) {
        const h = state.history.get(r.name) ?? [];
        h.push(headroom(r));
        if (h.length > 24) h.shift();
        state.history.set(r.name, h);
        chart = `<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">
          <line class="floor" x1="0" y1="${sparkY(0)}" x2="${SPARK_W}" y2="${sparkY(0)}" />
          ${trace(h)}
        </svg>`;
      }

      return `<div class="test" data-verdict="${shown}" title="${r.detail}">
        <span class="name">${r.name}</span>
        ${chart}
        <span class="verdict">${MARKS[shown]}</span>
        <span class="p">${Number.isNaN(r.p) ? "·" : r.p.toFixed(3)}</span>
      </div>`;
    })
    .join("");
}

const surrogate = $("surrogate");

function badges() {
  const bits = toBits(pool.peek());
  if (bits.length < MIN_BITS) {
    $("tests").innerHTML = `<p class="stream">waiting for the sky, ${bits.length} of ${MIN_BITS} bits</p>`;
    return;
  }

  // Bytes, not bits: the pool figure above already reports bits, and bytes is
  // the unit chi2 is gated on, so while it waits this readout says how far off
  // it is rather than repeating a number the reader already has.
  const bytes = bits.length / 8;
  $("tested").textContent =
    bytes < CHI2_MIN_BYTES ? `${bytes} of ${CHI2_MIN_BYTES} bytes` : `${bytes.toLocaleString()} bytes`;

  renderTests($("tests"), runAll(bits), live);

  // The demonstration, and the reason four tests run instead of one: the same
  // suite, on the same number of bits, against a stream that is not random by
  // any definition. Monobit and runs wave it through; only chi2's upper tail and
  // serial notice. Same bit count matters, a surrogate graded on a different
  // sample size is being compared at a different sensitivity and proves nothing.
  if (!surrogate.hidden) renderTests($("surrogate-tests"), runAll(controlRigged(bits.length)), rigged);
}

$("surrogate-toggle").addEventListener("click", (e) => {
  surrogate.hidden = !surrogate.hidden;
  e.target.setAttribute("aria-expanded", String(!surrogate.hidden));
  e.target.textContent = surrogate.hidden ? "compare with a rigged stream" : "hide the rigged stream";
  if (!surrogate.hidden) badges();
});

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

  if (spec.kind === "blockie") {
    const { canvas, text } = renderBlockie(value, prov, ink);
    canvas.className = "plate";
    out.append(canvas);
    actions.append(action("save the blockie", () => download(canvas, `entropic-blockie-${text.slice(0, 8)}.png`)));
  } else if (spec.kind === "art") {
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

/** What a draw reduced to one line of commentary. A plate has no short form
 *  worth printing, so it cites what it cost instead, which is the thing the
 *  status line is for. */
function summarise(spec, value) {
  if (spec.kind === "art" || spec.kind === "blockie") return "drawn";
  if (spec.kind === "deck") return `${value[0]} off the top`;
  return String(value);
}

// ── history ──────────────────────────────────────────────────────────────────
//
// What this session has asked the sky. Held in an array in the tab and nowhere
// else: a page whose whole claim is that it stores nothing has no business
// writing your draws to disk, and a reload being the end of them is the honest
// version of that.
//
// Every entry keeps the value and the provenance rather than the rendered card,
// so reopening one re-runs the same `present()` the draw did. A plate redraws
// from its own bytes, which is the property the artwork's printed seed exists to
// claim, exercised here on every recall.

const HISTORY_DEPTH = 24;
const history = [];
const historyEl = $("history");

function renderHistory() {
  $("drawn-count").textContent = history.length
    ? `${history.length}${history.length === HISTORY_DEPTH ? "+" : ""} held`
    : "none yet";

  historyEl.innerHTML = history
    .map(
      (h, i) => `<li><button type="button" data-at="${i}">
        <span class="log-what">${h.spec.label}</span>
        <span class="log-value">${h.short}</span>
        <span class="log-cost">${h.strikes}&#8202;×</span>
      </button></li>`
    )
    .join("");
}

function remember(spec, value, prov) {
  history.unshift({ spec, value, prov, short: summarise(spec, value), strikes: prov.strikes });
  // Newest first, so the window falls off the far end.
  if (history.length > HISTORY_DEPTH) history.pop();
  renderHistory();
}

// One listener on the list rather than one per row, so re-rendering it does not
// have to re-bind anything.
historyEl.addEventListener("click", (e) => {
  const at = e.target.closest("button")?.dataset.at;
  // Not while a draw is in flight: the card belongs to the sky until it answers.
  if (at === undefined || draw) return;
  const h = history[Number(at)];
  card.hidden = false;
  $("draw-label").textContent = `${h.spec.label} · drawn earlier`;
  present(h.spec, h.value, h.prov, () => begin(h.spec));
  $("card-close").focus();
});

renderHistory();

async function begin(spec) {
  if (draw) return;
  draw = { reader: createReader(), spec };

  card.hidden = false;
  $("draw-label").textContent = spec.label;
  for (const b of buttons()) b.disabled = true;
  waiting();
  report(`${spec.label}: waiting for the sky`);

  const value = await spec.run(draw.reader);
  const prov = draw.reader.provenance();
  draw = null;
  for (const b of buttons()) b.disabled = false;

  const span = prov.from ? Number((prov.to - prov.from) / 1000000n) / 1000 : 0;
  report(
    `${spec.label}: ${summarise(spec, value)} — ${prov.strikes} strike${prov.strikes === 1 ? "" : "s"}` +
      (span ? ` over ${span.toFixed(1)}s` : "")
  );

  remember(spec, value, prov);
  present(spec, value, prov, () => begin(spec));
  $("card-close").focus();
}

// Built from the DRAWS table rather than written out, so a new draw is one entry
// in draw.js and nothing here.
$("draw-buttons").innerHTML = Object.keys(ALL)
  .map((k) => `<button type="button" data-draw="${k}">${ALL[k].label}</button>`)
  .join("");
$("draw-buttons").addEventListener("click", (e) => {
  const kind = e.target.closest("button")?.dataset.draw;
  if (kind) begin(ALL[kind]);
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
  // `t` for the medium, the same key the rest of the set uses. Not while a
  // range is being typed into, where it is just a letter.
  if (e.key === "t" && e.target.tagName !== "INPUT") flip();
});

// ── run ──────────────────────────────────────────────────────────────────────

const SAYS = {
  connecting: "opening the link",
  live: "receiving",
  down: "link lost, retrying",
  error: "link error",
};

/** What the line says about a link that is up. A relay with no upstream of its
 *  own is the one state that looks fine from here and is not: our socket is
 *  open, nothing is arriving, and the difference matters. */
function saying(status) {
  if (status.phase === "live") return `receiving from ${host ?? "the relay"}`;
  if (status.live === false) return "the relay has no link";
  return SAYS[status.phase] ?? status.phase;
}

if (!FEED) {
  link("down");
  report("no feed configured: append ?feed=wss://…");
} else {
  createSource({
    url: FEED,
    hello: HELLO,
    onStatus: (status) => {
      link(status.phase, status.node);
      report(saying(status));
    },
    onFrame: (_f, accepted) => {
      seen++;
      if (accepted) {
        kept++;
        recent.push(Date.now());
        if (!still) beat();
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
