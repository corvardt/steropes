// Do the harvested timestamps actually carry entropy in their low bits?
//
// This is step 1 of the build order and the question the whole project rests
// on. It runs before any pool, any conditioning, any UI: if the low bits of a
// solved fix time are structured rather than random, everything downstream is
// decoration on a lie.
//
// Two controls run beside the real data, and they are the point. Math.random()
// is a stream that must pass; a counter is a stream that must fail. A test
// suite that cannot tell those two apart cannot say anything about lightning
// either.
//
//   node analyse.cjs times.jsonl

const fs = require("fs");

const rows = fs
  .readFileSync(process.argv[2] ?? "times.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const times = rows.map((r) => BigInt(r.t));

// ── statistics ───────────────────────────────────────────────────────────────

// Numerical Recipes erfc, fractional error < 1.2e-7. Needed by every test here
// and not in the stdlib.
function erfc(x) {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const y = t - 0.5;
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        y *
          (1.00002368 +
            y *
              (0.37409196 +
                y *
                  (0.09678418 +
                    y *
                      (-0.18628806 +
                        y *
                          (0.27886807 +
                            y *
                              (-1.13520398 +
                                y * (1.48851587 + y * (-0.82215223 + y * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

// NIST SP 800-22 monobit: are there as many ones as zeros?
function monobit(bits) {
  const ones = bits.reduce((a, b) => a + b, 0);
  const s = Math.abs(ones * 2 - bits.length) / Math.sqrt(bits.length);
  return { p: erfc(s / Math.SQRT2), detail: `${ones}/${bits.length} ones` };
}

// NIST SP 800-22 runs: are the streaks the right length? Catches a stream that
// is balanced but alternates, which monobit alone calls perfect.
function runs(bits) {
  const n = bits.length;
  const pi = bits.reduce((a, b) => a + b, 0) / n;
  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(n)) return { p: 0, detail: "failed monobit precondition" };
  let v = 1;
  for (let i = 1; i < n; i++) if (bits[i] !== bits[i - 1]) v++;
  const num = Math.abs(v - 2 * n * pi * (1 - pi));
  const den = 2 * Math.sqrt(2 * n) * pi * (1 - pi);
  return { p: erfc(num / den / Math.SQRT2), detail: `${v} runs` };
}

// Chi-square over byte values, p via the Wilson-Hilferty normal approximation
// (accurate to a few parts in a thousand at df=255, which is far finer than any
// decision made on it here).
function chi2Bytes(bits) {
  const n = Math.floor(bits.length / 8);
  if (n < 1280) return { p: NaN, detail: `only ${n} bytes, need ~1280` };
  const counts = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    counts[b]++;
  }
  const exp = n / 256;
  const x2 = counts.reduce((a, c) => a + ((c - exp) * (c - exp)) / exp, 0);
  const df = 255;
  const z = (Math.cbrt(x2 / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  // Both tails. A byte distribution that is too flat is as much a tell as one
  // that is lumpy — a counter scores X2≈0 and would otherwise be waved through
  // as the most uniform stream ever measured.
  return { p: erfc(z / Math.SQRT2) / 2, tail: "both", detail: `X2=${x2.toFixed(0)} df=${df}, ${n} bytes` };
}

// Serial correlation at lag 1..8. A solver that emits a periodic artefact shows
// up here as a spike at its period when the other tests see nothing.
function serial(bits) {
  let worst = { lag: 0, p: 1 };
  const detail = [];
  for (let lag = 1; lag <= 8; lag++) {
    const n = bits.length - lag;
    let agree = 0;
    for (let i = 0; i < n; i++) if (bits[i] === bits[i + lag]) agree++;
    const s = Math.abs(agree * 2 - n) / Math.sqrt(n);
    const p = erfc(s / Math.SQRT2);
    detail.push(`${lag}:${p.toFixed(3)}`);
    if (p < worst.p) worst = { lag, p };
  }
  return { p: worst.p, detail: `worst lag ${worst.lag} — ${detail.join(" ")}` };
}

const TESTS = { monobit, runs, "chi2/byte": chi2Bytes, serial };

function report(name, bits) {
  if (bits.length < 500) {
    console.log(`\n${name}\n  too few bits (${bits.length})`);
    return;
  }
  console.log(`\n${name}  (${bits.length} bits)`);
  for (const [label, fn] of Object.entries(TESTS)) {
    const { p, detail, tail } = fn(bits);
    const bad = tail === "both" ? p < 0.005 || p > 0.995 : p < 0.01;
    const mark = Number.isNaN(p) ? "–" : bad ? "FAIL" : "pass";
    console.log(`  ${mark.padEnd(5)} ${label.padEnd(10)} p=${Number.isNaN(p) ? "n/a" : p.toFixed(4)}   ${detail}`);
  }
}

// ── what the timestamps look like before any of that ─────────────────────────

console.log(`${times.length} strikes`);

const span = Number(times.reduce((a, b) => (b > a ? b : a)) - times.reduce((a, b) => (b < a ? b : a))) / 1e9;
console.log(`span ${span.toFixed(1)}s → ${(times.length / span).toFixed(1)} strikes/s`);

// The resolution the feed actually delivers, as opposed to the one the
// nanosecond unit advertises.
let g = 0n;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
for (const t of times) g = gcd(g, t);
console.log(`gcd of all timestamps: ${g}ns — the real resolution, against the 1ns the unit advertises`);

const tail = {};
for (const t of times) {
  const d = String(t).slice(-4);
  tail[d.replace(/\d/g, (c, i) => (i < 2 ? "x" : c))] = (tail[d.replace(/\d/g, (c, i) => (i < 2 ? "x" : c))] ?? 0) + 1;
}
console.log("last two digits:", Object.entries(tail).map(([k, v]) => `${k}×${v}`).join(" "));

// ── candidate bit sources ────────────────────────────────────────────────────

const bitsOf = (values, k) => {
  const out = [];
  const mask = (1n << BigInt(k)) - 1n;
  for (const v of values) {
    const low = v & mask;
    for (let i = k - 1; i >= 0; i--) out.push(Number((low >> BigInt(i)) & 1n));
  }
  return out;
};

// Divided through by the real resolution first, so the structurally-zero low
// bits the gcd just exposed are not counted as entropy.
const units = times.map((t) => t / (g || 1n));

const sorted = [...times].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const deltas = [];
for (let i = 1; i < sorted.length; i++) deltas.push((sorted[i] - sorted[i - 1]) / (g || 1n));

report("A · low 8 bits of timestamp / resolution", bitsOf(units, 8));
report("B · low 4 bits of timestamp / resolution", bitsOf(units, 4));
report("C · low 8 bits of Δt between sorted strikes", bitsOf(deltas.filter((d) => d > 0n), 8));

// The other fields in the frame. lat/lon carry six decimals — about 11cm, far
// finer than the network can actually fix a strike, so the low digits should be
// solver noise rather than position. Sign is dropped: a hemisphere is geography,
// not entropy.
const scaled = (field, mul) => rows.map((r) => BigInt(Math.round(Math.abs(r[field]) * mul)));

report("D · low 8 bits of lat × 1e6", bitsOf(scaled("lat", 1e6), 8));
report("E · low 8 bits of lon × 1e6", bitsOf(scaled("lon", 1e6), 8));
report("F · low 4 bits of delay × 10", bitsOf(scaled("delay", 10), 4));

// lat and lon come out of the same solve on the same station geometry, so they
// are the pair most likely to be coupled. Interleaved, a dependency between them
// lands on the serial test at lag 8.
const woven = [];
for (let i = 0; i < rows.length; i++) {
  woven.push(BigInt(Math.round(Math.abs(rows[i].lat) * 1e6)));
  woven.push(BigInt(Math.round(Math.abs(rows[i].lon) * 1e6)));
}
report("G · lat and lon interleaved, low 8 bits each", bitsOf(woven, 8));

// Everything worth having from one strike, if D and E hold up.
const all = [];
for (let i = 0; i < rows.length; i++) {
  all.push(units[i] & 0xffn);
  all.push(BigInt(Math.round(Math.abs(rows[i].lat) * 1e6)) & 0xffn);
  all.push(BigInt(Math.round(Math.abs(rows[i].lon) * 1e6)) & 0xffn);
}
report("H · time + lat + lon, 24 bits per strike", bitsOf(all, 8));

// ── controls: the suite must pass one and fail the other ─────────────────────

const good = [];
for (let i = 0; i < 40000; i++) good.push(Math.random() < 0.5 ? 0 : 1);
report("control · Math.random (must pass)", good);

const rigged = bitsOf(
  Array.from({ length: 5000 }, (_, i) => BigInt(i)),
  8
);
report("control · counter (must FAIL)", rigged);
