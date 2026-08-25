// Drive source.js and pool.js against the live feed, in the browser's own code
// path — node has a global WebSocket, so these modules run here unmodified.
//
// check.mjs proves the logic against a fixture. This proves the socket, the
// reconnect, the filter and the pool actually work against the sky. It talks
// straight to Blitzortung, which is a dev convenience only; the page goes
// through the relay.
//
//   node smoke.mjs [seconds]

import { createSource } from "./src/source.js";
import { createPool, toBits, condition } from "./src/pool.js";
import { runAll } from "./src/tests.js";

const SECONDS = Number(process.argv[2] ?? 60);
const HOSTS = ["ws1", "ws7", "ws8"];
const host = HOSTS[Math.floor(Math.random() * HOSTS.length)];

const pool = createPool();
let seen = 0;
let kept = 0;
const t0 = Date.now();

const stop = createSource({
  url: `wss://${host}.blitzortung.org:443/`,
  hello: JSON.stringify({ a: 111 }),
  onStatus: ({ phase }) => console.log(`[${phase}]`),
  onFrame: (_frame, accepted) => {
    seen++;
    if (accepted) kept++;
  },
  onBytes: (bytes) => pool.push(bytes),
});

setTimeout(async () => {
  stop();
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n${seen} frames, ${kept} accepted (${((100 * kept) / seen).toFixed(1)}%)`);
  console.log(`${(seen / secs).toFixed(1)} frames/s, ${(kept / secs).toFixed(1)} usable/s`);
  console.log(`pool: ${pool.available}/${pool.capacity} bytes, ${pool.bitsAvailable} bits`);

  const bytes = pool.peek();
  if (bytes.length >= 64) {
    const out = await condition(bytes.slice(0, 64));
    console.log(`conditioned: ${[...out.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}...`);
  }

  console.log("\nlive tests on the raw pool:");
  for (const r of runAll(toBits(bytes))) {
    console.log(`  ${r.verdict.padEnd(7)} ${r.name.padEnd(10)} ${Number.isNaN(r.p) ? "" : `p=${r.p.toFixed(4)}`}  ${r.detail}`);
  }
  process.exit(0);
}, SECONDS * 1000);
