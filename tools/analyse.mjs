// Compare candidate bit sources in a harvest, and say which of them survive.
//
//   node tools/analyse.mjs [fixtures/strikes.jsonl]
//
// This is the tool that settled where the entropy actually is. It is kept
// runnable rather than written up and thrown away, because the answer is a
// property of the network rather than of the code: if Blitzortung ever change
// how a fix is solved, the thing to do is harvest a fresh sample and run this
// again.
//
// It imports the tests from src/tests.js rather than carrying its own copies.
// It used to carry copies, and they silently fell behind when the serial test
// was corrected for multiple comparisons: for a while this tool was grading
// sources with a test the page had already stopped using. That is exactly the
// divergence the header of tests.js warns about, so there is now one
// implementation and this reads it.

import { readFileSync } from "node:fs";
import { runAll, controlGood, controlRigged, seeded } from "../src/tests.js";
import { lowByte, createFilter } from "../src/source.js";
import { toBits } from "../src/pool.js";

const path = process.argv[2] ?? "fixtures/strikes.jsonl";
const rows = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const times = rows.map((r) => BigInt(r.t));

function report(name, bits) {
  if (bits.length < 500) {
    console.log(`\n${name}\n  too few bits (${bits.length})`);
    return;
  }
  console.log(`\n${name}  (${bits.length} bits)`);
  for (const r of runAll(bits)) {
    const p = Number.isNaN(r.p) ? "n/a" : r.p.toFixed(4);
    console.log(`  ${r.verdict.toUpperCase().padEnd(7)} ${r.name.padEnd(10)} p=${p}   ${r.detail}`);
  }
}

// ── what the timestamps look like before any test runs ───────────────────────

console.log(`${rows.length} strikes from ${path}`);

const lo = times.reduce((a, b) => (b < a ? b : a));
const hi = times.reduce((a, b) => (b > a ? b : a));
const span = Number(hi - lo) / 1e9;
console.log(`span ${span.toFixed(1)}s, ${(rows.length / span).toFixed(1)} strikes/s`);

// The resolution the feed actually delivers, as opposed to the one the
// nanosecond unit advertises.
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const g = times.reduce(gcd, 0n);
console.log(`gcd of all timestamps: ${g}ns, the real resolution against the 1ns the unit claims`);

// The digit that ruled the timestamp out. The solver mixes precisions, so this
// comes out lumpy where a clean source would be flat.
const digit = new Array(10).fill(0);
for (const t of times) digit[Number((t / g) % 10n)]++;
const expected = rows.length / 10;
const x2 = digit.reduce((a, c) => a + (c - expected) ** 2 / expected, 0);
console.log(`(time/${g}) mod 10: ${digit.join(" ")}`);
console.log(`  expected ${expected.toFixed(0)} each, X2=${x2.toFixed(0)} on df=9 (anything over 27 is hopeless)`);

// How much of the feed is independent.
const sorted = [...times].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
let close = 0;
for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < 25600n) close++;
console.log(`\n${close} of ${sorted.length - 1} consecutive strikes within 25.6us (${((100 * close) / (sorted.length - 1)).toFixed(1)}%)`);

const accept = createFilter();
const kept = rows.filter((r) => accept({ t: BigInt(r.t), lat: r.lat, lon: r.lon }) !== null);
console.log(`${kept.length} survive the filter (${((100 * kept.length) / rows.length).toFixed(1)}%)`);

// ── candidate sources ────────────────────────────────────────────────────────

const bytesOf = (values) => toBits(Uint8Array.from(values));

report(
  "position, low byte of lat and of lon (what the page uses)",
  bytesOf(kept.flatMap((r) => [lowByte(r.lat), lowByte(r.lon)]))
);
report(
  "timestamp, low byte of time/resolution",
  bytesOf(kept.map((r) => Number((BigInt(r.t) / g) & 0xffn)))
);
report(
  "position and timestamp together",
  bytesOf(kept.flatMap((r) => [lowByte(r.lat), lowByte(r.lon), Number((BigInt(r.t) / g) & 0xffn)]))
);
report("delay, low nibble of delay x10", bytesOf(kept.map((r) => Math.round(r.delay * 10) & 0x0f)));

// Undeduplicated, to show what the filter is for.
report(
  "position again, but without the dedup filter",
  bytesOf(rows.flatMap((r) => [lowByte(r.lat), lowByte(r.lon)]))
);

// ── controls ─────────────────────────────────────────────────────────────────

report("control, seeded PRNG (must pass)", controlGood(40000, seeded(20260825)));
report("control, counter (must fail)", controlRigged(40000));
