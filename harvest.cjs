// Collect raw strike timestamps from Blitzortung, exactly as sent.
//
// Test-only: this opens its own socket to the upstream, the way
// Keraunos/scripts/KeraunosSeeker.cjs does. Production goes through the relay.
//
// The one thing this does that Seeker does not: `time` is nanoseconds since
// epoch, about 1.77e18, and Number.MAX_SAFE_INTEGER is 9.0e15. JSON.parse hands
// back a float64 with 53 bits of mantissa against a 61-bit integer, so the
// bottom eight bits — the entropy — are gone before anything downstream looks at
// them. So the digits come out of the decoded text with a regex and stay a
// string. Everything else in the frame is parsed normally; none of it matters
// here.
//
// Needs `ws`, which this repo does not carry yet — borrowed from Keraunos:
//   NODE_PATH=../Keraunos/node_modules node harvest.cjs [seconds] > times.jsonl

const WebSocket = require("ws");

const HOSTS = ["ws1", "ws7", "ws8"];
const SECONDS = Number(process.argv[2] ?? 120);

// LZW, lifted from Keraunos Seeker.jsx unchanged.
function decode(b) {
  let e = {};
  let d = Array.from(b);
  let c = d[0];
  let f = c;
  let g = [c];
  let h = 256;
  let o = h;
  for (let i = 1; i < d.length; i++) {
    let a = d[i].charCodeAt ? d[i].charCodeAt(0) : d[i];
    a = h > a ? String.fromCharCode(a) : e[a] || f + c;
    g.push(a);
    c = a[0];
    e[o] = f + c;
    o++;
    f = a;
  }
  return g.join("");
}

let n = 0;

// The deadline is wall-clock and lives outside any one socket. This feed drops
// — the first version of this script had no close handler, so when the upstream
// went away after three minutes the process sat idle until its timeout and
// reported a 900s run that held 215s of strikes. Keraunos reconnects for the
// same reason.
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

  ws.on("open", () => {
    console.error(`connected to ${host}`);
    ws.send(JSON.stringify({ a: 111 }));
  });

  ws.on("message", (data) => {
    const text = decode(data.toString());
    // Before JSON.parse, and as text. See above.
    const raw = /"time":(\d+)/.exec(text);
    if (!raw) return;
    const { lat, lon, delay } = JSON.parse(text);
    process.stdout.write(JSON.stringify({ t: raw[1], lat, lon, delay }) + "\n");
    if (++n % 500 === 0) console.error(`  ${n}`);
  });

  // An errored socket also emits close, so without this one drop schedules two
  // reconnects and the count doubles on every subsequent drop.
  let settled = false;
  const again = (why) => {
    if (settled) return;
    settled = true;
    console.error(`${why}; reconnecting`);
    setTimeout(connect, 2000);
  };
  ws.on("error", (err) => again(`error: ${err.message}`));
  ws.on("close", () => again("closed"));
}

connect();
