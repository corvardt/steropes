// One check, covering the parts that are not obviously right by reading them.
//
//   node check.mjs
//
// The fixture assertion is the important one. dd.jsonl is the 3,738-strike
// deduplicated sample every figure in plan.md was measured against, so if a
// change to extraction or to the tests ever stops it passing, that is the alarm.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runAll, controlGood, controlRigged, seeded, MIN_BITS } from "../src/tests.js";
import { createFilter, lowByte, parseFrame, SPACING_NS } from "../src/source.js";
import { createPool, toBits, condition } from "../src/pool.js";
import { createReader, below, between, shuffle, uuid, DECK } from "../src/draw.js";
import { blockie } from "../src/blockie.js";

// Resolved from this file rather than the cwd, so the check behaves the same
// whether npm runs it from the root or someone runs it from tools/.
const FIXTURE = new URL("../fixtures/strikes.jsonl", import.meta.url);

let failures = 0;
const check = (pass, what) => {
  console.log(`  ${pass ? "✓" : "✗"}  ${what}`);
  if (!pass) failures++;
};
const verdicts = (bits) => Object.fromEntries(runAll(bits).map((r) => [r.name, r.verdict]));

// ── the suite must separate its own controls ─────────────────────────────────
console.log("\ncontrols");
{
  const good = verdicts(controlGood(40000, seeded(20260825)));
  check(
    Object.values(good).every((v) => v === "pass"),
    `seeded PRNG passes all four, ${JSON.stringify(good)}`
  );

  // The counter is the whole reason chi2 is two-sided. It passes monobit and
  // runs; if it ever passes chi2 as well, the upper tail has been lost.
  const rigged = verdicts(controlRigged(40000));
  check(rigged["chi2/byte"] === "fail", "counter fails chi2 (too flat is a tell)");
  check(rigged.serial === "fail", "counter fails serial");
}

// ── the fixture must still pass ──────────────────────────────────────────────
console.log("\nfixture (fixtures/strikes.jsonl, the sample plan.md was measured against)");
{
  const rows = readFileSync(FIXTURE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check(rows.length > 3000, `${rows.length} strikes`);

  const bytes = [];
  for (const r of rows) bytes.push(lowByte(r.lat), lowByte(r.lon));
  const v = verdicts(toBits(Uint8Array.from(bytes)));
  check(
    Object.values(v).every((x) => x === "pass"),
    `lat+lon low bytes pass all four, ${JSON.stringify(v)}`
  );

  // And the timestamp must still fail, or the thing this project learned has
  // quietly stopped being true.
  const tb = rows.map((r) => Number((BigInt(r.t) / 100n) & 0xffn));
  const tv = verdicts(toBits(Uint8Array.from(tb)));
  check(tv.monobit === "fail" || tv["chi2/byte"] === "fail", `timestamp still fails, ${JSON.stringify(tv)}`);
}

// ── extraction ───────────────────────────────────────────────────────────────
console.log("\nextraction");
{
  check(lowByte(41.908767) === (41908767 & 0xff), "lowByte takes the sixth decimal");
  check(lowByte(-71.472201) === lowByte(71.472201), "sign dropped");

  const f = parseFrame('{"time":1787663653304691700,"lat":41.9,"lon":13.4,"delay":12.1}');
  check(f.t === 1787663653304691700n, "timestamp survives as BigInt");
  // The trap this guards: via JSON.parse the same value comes back rounded.
  check(
    BigInt(JSON.parse('{"t":1787663653304691700}').t) !== f.t,
    "and JSON.parse would have rounded it away"
  );
  check(parseFrame('{"lat":1,"lon":2}') === null, "a frame with no time is refused");
}

// ── the dedup filter ─────────────────────────────────────────────────────────
console.log("\nfilter");
{
  const accept = createFilter();
  const at = (t) => accept({ t, lat: 41.908767, lon: 13.467127 });
  const base = 1787663653304691700n;

  check(at(base) !== null, "first strike accepted");
  check(at(base) === null, "exact repeat dropped");
  check(at(base + SPACING_NS - 1n) === null, "strike inside the spacing window dropped");
  check(at(base + SPACING_NS) !== null, "strike a full cycle later accepted");
  // Out-of-order arrivals are real: `delay` runs to twelve seconds.
  check(at(base - 1n) === null, "a late frame near an accepted one is dropped");

  const rows = readFileSync(FIXTURE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const fresh = createFilter();
  const kept = rows.filter((r) => fresh({ t: BigInt(r.t), lat: r.lat, lon: r.lon }) !== null);
  check(kept.length / rows.length > 0.95, `already-deduped fixture passes through (${kept.length}/${rows.length})`);
}

// ── the pool ─────────────────────────────────────────────────────────────────
console.log("\npool");
{
  const p = createPool(8);
  p.push([1, 2, 3, 4]);
  check(p.available === 4 && p.bitsAvailable === 32, "counts bytes and bits");
  check(p.take(9) === null, "refuses to hand out more than it holds");
  check([...p.take(2)].join() === "1,2", "takes oldest first");
  check(p.available === 2, "taking consumes");

  // Overwrite the oldest rather than stall: fresh entropy must never be dropped
  // on the floor because the pool is sitting on stale bytes.
  const q = createPool(4);
  q.push([1, 2, 3, 4, 5, 6]);
  check(q.available === 4 && [...q.peek()].join() === "3,4,5,6", "wraps, keeping the newest");
  check([...q.peek()].join() === "3,4,5,6", "peek does not consume");

  check(toBits(Uint8Array.from([0b10110001])).join("") === "10110001", "toBits is MSB first");
  check(runAll(new Array(MIN_BITS).fill(0)).length === 4, "all four tests report");
}

// ── conditioning ─────────────────────────────────────────────────────────────
console.log("\nconditioning");
{
  const out = await condition(Uint8Array.from({ length: 64 }, (_, i) => i));
  check(out.length === 32, "SHA-256 block extraction gives 32 bytes from 64");
  const again = await condition(Uint8Array.from({ length: 64 }, (_, i) => i));
  check([...out].join() === [...again].join(), "and is deterministic");
}

// ── draws ────────────────────────────────────────────────────────────────────
console.log("\ndraws");
{
  const feed = (bytes, frame = null) => {
    const r = createReader();
    r.push(bytes, frame);
    return r;
  };

  // The important one. Every byte value 0..255 goes in exactly once; with n=6
  // the last whole multiple of 6 is 252, so 252 bytes are accepted and four are
  // rejected, and every face must come up exactly 42 times. `byte % 6` would
  // give 0 and 1 an extra count each, which is a 2.4% loaded die that no casual
  // inspection would ever catch.
  const r = feed(Array.from({ length: 256 }, (_, i) => i));
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 252; i++) counts[await below(r, 6)]++;
  check(counts.every((c) => c === 42), `d6 is exactly uniform over one byte cycle: ${counts.join(" ")}`);
  // 252 accepted draws consumed exactly 252 bytes. The four values at or above
  // the last whole multiple are still queued, because a value is only rejected
  // when a draw actually reads it. Asking for one more must eat all four and
  // then wait, rather than folding them back into the range.
  check(r.waiting === 4, `the four rejectable values are still queued (${r.waiting})`);
  let extra = false;
  below(r, 6).then(() => (extra = true));
  await new Promise((res) => setTimeout(res, 10));
  check(!extra && r.waiting === 0, "a further draw rejects all four and waits for a fresh strike");

  // A modulus would have produced this instead, which is what we are avoiding.
  const naive = new Array(6).fill(0);
  for (let i = 0; i < 256; i++) naive[i % 6]++;
  check(!naive.every((c) => c === naive[0]), `modulo would have been biased: ${naive.join(" ")}`);

  const q = feed(Array.from({ length: 4000 }, (_, i) => (i * 37) % 256));
  let inRange = true;
  for (let i = 0; i < 500; i++) {
    const v = await below(q, 20);
    if (v < 0 || v > 19) inRange = false;
  }
  check(inRange, "d20 stays inside 1..20");
  check((await between(feed([0]), 5, 5)) === 5, "a range of one needs no bytes and returns it");
  check((await between(feed([0, 0, 0, 0]), 9, 3)) >= 3, "an inverted range is accepted, not thrown");

  await assert.rejects(() => below(feed([1]), 0), RangeError);
  check(true, "below() refuses a range of zero");

  const shuffled = await shuffle(feed(Array.from({ length: 4000 }, (_, i) => (i * 91) % 256)), DECK);
  check(shuffled.length === 52, "the deck keeps all 52 cards");
  check(new Set(shuffled).size === 52, "with no duplicates and none lost");
  check(shuffled.join(" ") !== DECK.join(" "), "and is not in the order it started");

  const id = await uuid(feed(Array.from({ length: 16 }, () => 0xff)));
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), `uuid v4 shape: ${id}`);

  // Provenance has to name the strikes that actually decided it.
  const p = createReader();
  p.push([1, 2], { t: 100n, lat: 1, lon: 2 });
  p.push([3, 4], { t: 200n, lat: 3, lon: 4 });
  await p.byte();
  check(p.provenance().strikes === 1, "one strike cited after one byte");
  await p.byte();
  await p.byte();
  const prov = p.provenance();
  check(prov.strikes === 2, "two after crossing into the second strike");
  check(prov.from === 100n && prov.to === 200n, "and reports the span, oldest to newest");

  // A draw must wait rather than be answered from thin air.
  const empty = createReader();
  let settled = false;
  below(empty, 6).then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 10));
  check(!settled, "a draw with no strikes yet does not resolve");
  empty.push([7], { t: 1n, lat: 0, lon: 0 });
  await new Promise((r) => setTimeout(r, 10));
  check(settled, "and resolves once a strike arrives");
}

// ── blockie ──────────────────────────────────────────────────────────────────
console.log("\nblockie");
{
  const r = createReader();
  r.push(Array.from({ length: 200 }, (_, i) => (i * 53) % 256), { t: 5n, lat: 1, lon: 2 });
  const tile = await blockie(r);

  check(tile.cells.length === 8 && tile.cells.every((row) => row.length === 8), "the tile is 8x8");
  check(
    tile.cells.every((row) => row.slice(0, 4).join("") === [...row.slice(4)].reverse().join("")),
    "every row mirrors about the centre"
  );
  check(
    tile.cells.flat().every((v) => v === 0 || v === 1 || v === 2),
    "cells are only background, primary or spot"
  );
  check(
    ["background", "primary", "spot"].every(
      (k) => tile.colours[k].length === 3 && tile.colours[k].every((c) => c >= 0 && c <= 255)
    ),
    "three colours, each a valid rgb triple"
  );

  // The weighting is the thing most likely to drift, and the original's
  // `floor(r * 2.3)` is 10/23, 10/23, 3/23. Over many tiles the spot colour
  // should be the rare one, at roughly an eighth of cells.
  const many = createReader();
  many.push(Array.from({ length: 20000 }, (_, i) => (i * 101) % 256), { t: 1n, lat: 0, lon: 0 });
  const counts = [0, 0, 0];
  for (let i = 0; i < 60; i++) {
    const t = await blockie(many);
    // Left half only: the mirror would double-count.
    for (const row of t.cells) for (const v of row.slice(0, 4)) counts[v]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const spot = counts[2] / total;
  check(spot > 0.09 && spot < 0.17, `spot cells are the rare third, ${(spot * 100).toFixed(1)}% (expect ~13%)`);
}

console.log(failures ? `\n${failures} failed\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
