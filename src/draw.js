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

// ── the monkey ───────────────────────────────────────────────────────────────
//
// Borel's monkey at a typewriter, with the sky's hand on the keys. It types one
// key per strike and stops the first time the stream spells a word, which is
// the theorem run at the only scale a page can afford: not Hamlet, one word.
//
// The wait is the argument. Three letters is 27^3 = 19,683 arrangements, and
// with this many words in the list a hit lands every 57 keys on average, so the
// monkey is legibly slow at a thing a person does without thinking. Multiply
// the wait by 19,683 for every further letter and the full line stops being a
// long wait and starts being a number with no time in it.

/** The keyboard: twenty-six letters and the space bar, no shift, no punctuation. */
export const KEYS = "abcdefghijklmnopqrstuvwxyz ";

/**
 * What counts as a word. Three letters carries the hit rate: every entry longer
 * than that is a thousand times rarer and is here for the day it lands.
 */
export const WORDS = new Set(
  `act add ado age ago aid ail aim air ale all and ant any ape apt arm art ask asp ate awe axe aye
   bad bag ban bar bat bay bed bee beg bet bid big bit boy bow box bud bug but buy
   can cap car cat cry cup cur cut day den dew did die dim din dip doe dog don dot dry due dun
   ear eat ebb egg eke elf ell elm end err eve ewe eye fad fan far fat fee few fie fig fin fir fit fix
   fly foe fog fop for fox fro fry fur gap gay get gig gin god got gun gut had hag ham hap hat hay
   hem hen her hew hid hie him hip his hit hoe hog hot how hue hug hum hut ice ill imp ink inn ire irk its ivy
   jar jaw jay jet job jot joy keg key kid kin kit lad lag lap law lay lea led leg lie lip lit lop lot low
   mad man map mar mat maw may men met mew mid mob mop mow mud mug nag nap nay net new nib nip nod nor not now nun nut
   oak oar oat odd ode off oft oil old one orb ore our out owe owl own
   pan par paw pay pea peg pen pet pew pie pig pin pit ply pod pot pox pry pun pup put
   rag ram ran rap rat raw ray red rib rid rim rip rob rod roe rot row rub rue rug rum run rut
   sad sag sap sat saw say sea see set sew she shy sin sip sir sit six sky sly sob sod son sop sow spy sty sum sun sup
   tan tap tar tax tea ten the thy tie tin tip toe ton too top tow toy try tub tug two urn use
   van vat vex vie vow wag wan war was wax way web wed wee wet who why wig win wit woe won woo wry
   yea yes yet yew yon you
   alas dost doth fain hark hath lady lord love sire thee thou will word`.split(/\s+/)
);

/**
 * Type until the tail of the stream is a word. Shortest match first, so a hit
 * is reported at the length that actually earned it rather than at whatever
 * longer window happens to contain one.
 */
export async function monkey(reader, words = WORDS) {
  const longest = Math.max(...[...words].map((w) => w.length));
  let typed = "";
  for (;;) {
    typed += KEYS[await below(reader, KEYS.length)];
    for (let n = 3; n <= longest && n <= typed.length; n++) {
      const tail = typed.slice(-n);
      if (words.has(tail)) return { typed, word: tail };
    }
  }
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
/**
 * An exposure: not a draw of a fixed size, but everything the sky gives in a
 * fixed window.
 *
 * Every other draw here asks how many bytes it needs and stops when it has
 * them, so the wait is a side effect of the artefact. This inverts that. The
 * window is chosen first and the artefact is whatever fell into it, which makes
 * the duration the subject rather than a cost: two exposures of the same length
 * differ because the weather did, and a quiet night and a storm are legible as
 * different pictures rather than as the same picture arriving at different
 * speeds.
 *
 * `onTick` is handed the bytes so far, so the plate can assemble while it fills.
 * `stop` closes the window early and keeps what has already arrived — an
 * exposure cut short is a shorter exposure, not a failed one, which is the one
 * thing that lets a fifteen-minute window be offered at all.
 */
export function expose(reader, ms, onTick) {
  const bytes = [];
  let running = true;
  let cut;

  const closed = new Promise((resolve) => {
    const finish = () => {
      if (!running) return;
      running = false;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    cut = () => {
      clearTimeout(timer);
      finish();
    };
  });

  (async () => {
    while (running) {
      // Suspends until the sky delivers. The window can close while this is
      // waiting, so the flag is checked again on the other side of the await:
      // without that, a byte arriving after time was up would be appended to an
      // array whose caller already has it.
      const b = await reader.byte();
      if (!running) break;
      bytes.push(b);
      onTick?.(bytes);
    }
  })();

  return { stop: cut, done: closed.then(() => bytes) };
}

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
  monkey: {
    label: "monkey",
    // A mean rather than a floor: measured at 57 keys to a hit over 200 runs,
    // near enough one byte a key, two bytes a strike. The one draw here that
    // can genuinely run long, which is the theorem showing through the bar.
    strikes: 30,
    kind: "monkey",
    run: monkey,
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
