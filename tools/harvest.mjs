// Collect raw strike frames from Blitzortung, exactly as sent.
//
// Offline tool, not part of the page. It talks straight to the upstream, which
// the page never does: the page goes through the relay, because Blitzortung ask
// that a project using their data serve it from its own server. One socket for a
// few minutes to re-verify a source is a different thing from a public site
// doing it on every visit.
//
//   node tools/harvest.mjs [seconds] > fixtures/new.jsonl
//
// No dependencies. Node has had a global WebSocket since v22, so the `ws`
// package this used to borrow from Keraunos is no longer needed.

import { decode, parseFrame } from "../src/source.js";

const HOSTS = ["ws1", "ws7", "ws8"];
const SECONDS = Number(process.argv[2] ?? 120);

let n = 0;

// The deadline is wall-clock and lives outside any one socket. This feed drops,
// and an earlier version of this tool had no close handler, so when the upstream
// went away after three minutes the process sat idle until its timeout and
// reported a 900s run holding 215s of strikes.
const deadline = Date.now() + SECONDS * 1000;
const stop = () => {
  console.error(`\n${n} strikes`);
  process.exit(0);
};
setTimeout(stop, SECONDS * 1000);

function connect() {
  if (Date.now() >= deadline) return stop();
  const host = HOSTS[Math.floor(Math.random() * HOSTS.length)];
  const ws = new WebSocket(`wss://${host}.blitzortung.org:443/`);

  ws.onopen = () => {
    console.error(`connected to ${host}`);
    ws.send(JSON.stringify({ a: 111 }));
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const frame = parseFrame(decode(event.data));
    if (!frame) return;
    // The timestamp is written back as digits. It is a BigInt here precisely
    // because JSON.parse cannot hold it, so JSON.stringify must not get it.
    process.stdout.write(
      JSON.stringify({ t: String(frame.t), lat: frame.lat, lon: frame.lon, delay: frame.delay }) + "\n"
    );
    if (++n % 500 === 0) console.error(`  ${n}`);
  };

  // An errored socket also emits close, so the reconnect is scheduled from close
  // alone. Without the guard one drop schedules two reconnects and the count
  // doubles on every subsequent drop.
  let settled = false;
  const again = (why) => {
    if (settled) return;
    settled = true;
    console.error(`${why}; reconnecting`);
    setTimeout(connect, 2000);
  };
  ws.onerror = () => again("error");
  ws.onclose = () => again("closed");
}

connect();
