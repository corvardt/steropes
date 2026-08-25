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

console.log(failures ? `\n${failures} failed\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
