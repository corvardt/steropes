// Draws from the sky.
//
// A draw does not read the pool. It waits for strikes that have not happened
// yet, and is answered by the first ones that do. That is slower and it is the
// entire point: the pool is a stock of entropy, but a draw is a question put to
// the weather, and the answer has to arrive after the question. It also makes
// the provenance meaningful. "Seven strikes, 21:04:12 to 21:04:19" is only worth
// printing if those strikes were genuinely what decided it.
//
// Every draw is an async function over a byte reader that suspends when it runs
// out. Rejection sampling means the number of bytes a draw needs is not known in
// advance, so the reader has to be pull-based rather than a fixed allocation.

/**
 * A byte queue that suspends. Each byte remembers the strike it came from, so a
 * finished draw can say exactly which strikes it consumed rather than guessing
 * from a count.
 */
export function createReader() {
  const buf = [];
  let wake = null;
  const used = new Set();

  return {
    push(bytes, frame) {
      for (const b of bytes) buf.push({ b, frame });
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    },

    async byte() {
      while (!buf.length) await new Promise((r) => (wake = r));
      const { b, frame } = buf.shift();
      if (frame) used.add(frame);
      return b;
    },

    /** Strikes consumed so far, oldest first. */
    provenance() {
      const strikes = [...used].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      return {
        strikes: strikes.length,
        from: strikes[0]?.t ?? null,
        to: strikes[strikes.length - 1]?.t ?? null,
        places: strikes.map((s) => ({ lat: s.lat, lon: s.lon })),
      };
    },

    get waiting() {
      return buf.length;
    },
  };
}

/**
 * A uniform integer in [0, n), by rejection sampling.
 *
 * Not `byte % n`. For any n that does not divide 256 evenly, the modulus favours
 * the low values: with n=6, the residues 0 and 1 come up 43 times per 256 and
 * the rest 42, which is a 2.4% bias on a die. Small, invisible, and exactly the
 * kind of thing this page exists to not do. Values landing above the last whole
 * multiple of n are discarded and redrawn instead, which costs a few extra bits
 * and is unbiased.
 */
export async function below(reader, n) {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) {
    throw new RangeError(`below() takes 1..2^32, got ${n}`);
  }
  if (n === 1) return 0;

  let bytes = 1;
  while (256 ** bytes < n) bytes++;
  const space = 256 ** bytes;
  const limit = Math.floor(space / n) * n; // the last whole multiple of n

  for (;;) {
    let v = 0;
    for (let i = 0; i < bytes; i++) v = v * 256 + (await reader.byte());
    if (v < limit) return v % n;
    // Landed in the ragged tail past the last whole multiple. Discard it.
  }
}

/** A uniform integer in [min, max], inclusive at both ends. */
export async function between(reader, min, max) {
  if (max < min) [min, max] = [max, min];
  return min + (await below(reader, max - min + 1));
}

// ── the draws ────────────────────────────────────────────────────────────────

export const COIN = ["heads", "tails"];

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const DECK = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

/** Fisher-Yates, with unbiased indices. Shuffling with a biased index is the
 *  classic way to produce a deck that looks fine and is not. */
export async function shuffle(reader, items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = await below(reader, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** UUID v4, from sixteen fresh bytes with the version and variant bits set. */
export async function uuid(reader) {
  const b = [];
  for (let i = 0; i < 16; i++) b.push(await reader.byte());
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Thirty-two fresh bytes, as hex. The seed the artwork is drawn from. */
export async function seed(reader, bytes = 32) {
  const b = [];
  for (let i = 0; i < bytes; i++) b.push(await reader.byte());
  return b;
}

// What each draw is called, what it needs, and how to run it. The UI reads this
// rather than carrying its own list, so adding a draw is one entry here.
//
// `strikes` is the number of strikes the draw needs if nothing is rejected, at
// two bytes a strike. It is a floor rather than a promise, which is why the
// waiting readout treats it as one: rejection sampling can always ask for more,
// and a progress bar that quietly stalls at 100% would be worse than one that
// admits it is still going.
export const DRAWS = {
  coin: {
    label: "coin",
    strikes: 1,
    run: async (r) => COIN[await below(r, 2)],
  },
  d6: {
    label: "d6",
    strikes: 1,
    run: async (r) => String(await between(r, 1, 6)),
  },
  d20: {
    label: "d20",
    strikes: 1,
    run: async (r) => String(await between(r, 1, 20)),
  },
  uuid: {
    label: "uuid",
    strikes: 8,
    kind: "mono",
    run: uuid,
  },
  deck: {
    label: "shuffled deck",
    strikes: 26,
    kind: "deck",
    run: (r) => shuffle(r, DECK),
  },
  art: {
    label: "artwork",
    strikes: 16,
    kind: "art",
    run: (r) => seed(r, 32),
  },
};

/** The range draw, which takes its bounds from the form rather than the table. */
export function rangeDraw(min, max) {
  return {
    label: `${min} to ${max}`,
    strikes: 1,
    run: async (r) => String(await between(r, min, max)),
  };
}
