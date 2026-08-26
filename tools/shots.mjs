// Captures the instrument, by driving the real thing rather than by drawing it.
//
//   node tools/shots.mjs                     # the unfurl card, from production
//   node tools/shots.mjs --soak 240          # let it run longer first
//   node tools/shots.mjs --zoom 1            # 1:1, walk only, no badges
//   node tools/shots.mjs --url http://localhost:8080/?feed=wss://…
//
// The card has to be regenerable, because what it shows is the weather on the
// morning it was taken. A screenshot pasted in once decays quietly: the palette
// moves, a readout is renamed, a badge gains a column, and the card keeps
// showing an instrument that no longer exists. Running this again settles it.
//
// It soaks before it fires, which is the whole difficulty. Strikes have to
// arrive and the walk has to have been somewhere; a page grabbed on load is an
// empty grid and a fair picture of nothing. Roughly:
//
//   ~20s    the walk has a shape, the readouts have figures
//   ~40s    500 bits, so monobit, runs and serial start reading
//   ~4min   1280 bytes, so chi2 stops saying it is waiting
//
// Keraunos does this with puppeteer-core. This project has no dependencies and
// says so, so it speaks CDP over the WebSocket Node has had since v22 — the
// same one the rest of the tooling already relies on. It is sixty lines and it
// costs nothing to keep.

import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const URL_ = arg("url", "https://entropic.corvardt.com/");
const SOAK = Number(arg("soak", 120)) * 1000;
const OUT = arg("out", "og.png");
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const PORT = 9222;

// The card's size is fixed by the people who unfurl it, not by us.
const WIDTH = 1200;
const HEIGHT = 630;

// How much page to fit into that. The card is a fixed shape and the panel is
// taller than it, so at 1:1 the readouts run off the bottom and the badges,
// which are the whole argument, are not in the picture. Rendering larger and
// scaling down keeps the aspect and buys height: the 1.6 default holds about a
// thousand pixels of column, which is the badges. Text gets smaller, which
// costs less than it sounds
// like, since a card is rendered a few hundred pixels wide in a feed and nobody
// was reading the p-values off it anyway.
const ZOOM = Number(arg("zoom", 1.6));
const VW = Math.round(WIDTH * ZOOM);
const VH = Math.round(HEIGHT * ZOOM);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--window-size=${VW},${VH}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

/** Chrome is not listening the instant it is spawned, and the port is the only
 *  thing worth waiting on. */
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not up yet. The loop is the wait.
    }
    await sleep(250);
  }
  throw new Error("chrome never answered on the debugging port");
}

const ws = new WebSocket(await target());
await new Promise((ok, no) => {
  ws.addEventListener("open", ok, { once: true });
  ws.addEventListener("error", no, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, no } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
  }
});

const send = (method, params = {}) =>
  new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params }));
  });

// The window size is a hint; this is the guarantee. Scale factor 1 because the
// card is consumed at exactly the size it is declared at.
await send("Emulation.setDeviceMetricsOverride", {
  width: VW,
  height: VH,
  deviceScaleFactor: 1,
  mobile: false,
});

await send("Page.enable");
await send("Page.navigate", { url: URL_ });

process.stdout.write(`soaking ${SOAK / 1000}s on ${URL_} `);
for (let left = SOAK; left > 0; left -= 5000) {
  await sleep(Math.min(5000, left));
  process.stdout.write(".");
}
process.stdout.write("\n");

const shot = await send("Page.captureScreenshot", {
  format: "png",
  // Scaled back to the declared size, so whatever the zoom the file is the
  // 1200x630 the meta tags promise.
  clip: { x: 0, y: 0, width: VW, height: VH, scale: 1 / ZOOM },
});
writeFileSync(OUT, Buffer.from(shot.data, "base64"));
console.log(`${OUT}  ${WIDTH}x${HEIGHT}`);

ws.close();
chrome.kill();
