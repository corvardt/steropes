// The sky, as bytes.
//
// What this takes from a strike is its position, not its time. That is the
// opposite of what the plan originally said and it was settled by measurement
// against 7,643 live frames: the low byte of lat and of lon each pass all four
// tests, while the timestamp's 100ns digit is severely biased (X2=383 on df=9,
// because the solver mixes 1us and 100ns precision) and contaminates any stream
// it is mixed into. The timestamp is still read — the dedup rule needs it — but
// none of its bits reach the pool.

export const SPACING_NS = 25600n; // one low-byte cycle
const WINDOW = 256; // accepted timestamps kept for the spacing check

// LZW, from Keraunos Seeker.jsx unchanged.
export function decode(b) {
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

// `time` is ~1.77e18 and Number.MAX_SAFE_INTEGER is 9.0e15, so JSON.parse
// silently rounds its low bits away — and the result still looks like a
// perfectly good timestamp, which is what makes it dangerous. It comes out of
// the text as digits and stays a BigInt. Only the dedup rule reads it.
export function parseFrame(text) {
  const raw = /"time":(\d+)/.exec(text);
  if (!raw) return null;
  const { lat, lon, delay } = JSON.parse(text);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { t: BigInt(raw[1]), lat, lon, delay };
}

// Six decimals is about 11cm, far finer than the network can fix a strike, so
// the low digits are solver noise. Sign is dropped: a hemisphere is geography.
export const lowByte = (v) => Math.round(Math.abs(v) * 1e6) & 0xff;

/**
 * The decorrelation filter, and it is mandatory rather than hygiene.
 *
 * 56% of consecutive frames arrive within 25.6us of each other and 256 of 1,786
 * were exact repeats — multi-stroke flashes and repeated reports. Consecutive
 * frames are not independent, which showed up as serial correlation at lag 8
 * across every field until this was applied. About 48% of frames survive.
 *
 * The spacing rule subsumes exact-duplicate detection: a repeated frame carries
 * a timestamp already in the window, so its distance is zero and it is dropped
 * without needing a separate key set.
 *
 * Frames arrive out of order — `delay` runs to twelve seconds — so this holds a
 * window of recently accepted timestamps rather than only the last one.
 *
 * ponytail: linear scan of a 256-entry window per frame, which at ~8 frames/s is
 * nothing. If the frame rate ever climbs by orders of magnitude, sort the window
 * and binary-search it.
 */
export function createFilter() {
  const recent = [];
  return (frame) => {
    for (const seen of recent) {
      const d = frame.t > seen ? frame.t - seen : seen - frame.t;
      if (d < SPACING_NS) return null;
    }
    recent.push(frame.t);
    if (recent.length > WINDOW) recent.shift();
    return [lowByte(frame.lat), lowByte(frame.lon)];
  };
}

const RECONNECT_MS = 3000;
const MAX_RECONNECT_MS = 30000;

/**
 * Holds the socket and pushes accepted bytes out. `onBytes` gets two bytes per
 * usable strike; `onFrame` sees every frame including the rejected ones, which
 * is what the strikes/s pulse and the accept-rate readout are drawn from.
 */
export function createSource({ url, onBytes, onFrame, onStatus, hello = null }) {
  const accept = createFilter();
  let socket = null;
  let retry = null;
  let wait = RECONNECT_MS;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    onStatus?.({ phase: "connecting" });
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      wait = RECONNECT_MS;
      // In production this stays null: the relay holds the one upstream socket
      // and sends the subscription itself, which is the whole point of it. It is
      // here so dev can point straight at Blitzortung without running a relay.
      if (hello) ws.send(hello);
      onStatus?.({ phase: "live" });
    };

    ws.onmessage = (event) => {
      // The relay reports its own state as bytes and the feed's frames as text,
      // so the two are told apart by type rather than by parsing.
      if (typeof event.data !== "string") return;
      const frame = parseFrame(decode(event.data));
      if (!frame) return;
      const bytes = accept(frame);
      onFrame?.(frame, bytes !== null);
      if (bytes) onBytes?.(bytes);
    };

    // An errored socket also emits close, so the reconnect is scheduled from
    // close alone; onerror only reports. Without that one drop schedules two
    // reconnects and the count doubles on every subsequent drop.
    ws.onerror = () => onStatus?.({ phase: "error" });
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      onStatus?.({ phase: "down" });
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, MAX_RECONNECT_MS);
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
