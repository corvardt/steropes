# Entropic

ἐντροπία: a turning in.

**Random numbers drawn from lightning, verified in front of you.**

Every strike detected anywhere on earth arrives here a few seconds later. The
low digits of where it struck are noise from the network's own solver, far finer
than it can really locate a flash, and nobody can predict them because nobody can
predict when and where lightning happens. Entropic collects those digits, tests
them continuously in your browser, and shows the working.

The page draws a random walk. Every step is one strike, somewhere on earth.

## What is actually random here

This part was settled by measurement rather than by argument, and the answer was
not the one the project started with.

The obvious source is timing: take the nanosecond residue of the strike
timestamp. It does not work. Blitzortung's `time` is a *solved* fix time from
multilateration, not a reading off a clock, and the solver mixes precisions.
Roughly a quarter of fixes land on exact microsecond multiples, so the digit is
badly lumpy:

```
(time/100) mod 10:  960  75  386  341  370  358  411  396  387  54
        expected:   374 each,  X2=1441 on df=9   (27 is already hopeless)
```

Position is clean. `lat` and `lon` carry six decimal places, about 11cm, and the
network cannot fix a strike to anything like that, so the low byte of each is
solver noise. Over the sample in `fixtures/`:

| source | monobit | runs | chi² | serial |
| --- | --- | --- | --- | --- |
| **low byte of lat and lon** | pass | pass | **X2=286** | pass |
| low byte of the timestamp | fail | fail | X2=3792 | fail |
| both together | fail | fail | fail | pass |
| `delay` | pass | pass | fail | fail |
| *seeded PRNG (control)* | pass | pass | *X2=265* | pass |
| *counter (control)* | pass | pass | fail | fail |

Taken alone, `lat` scores X2=253 against df=255, and the seeded PRNG control on
the same suite scores 265. A chi² statistic is expected to land near its own
degrees of freedom, so both are sitting where a flat distribution should sit.
The lightning and the reference generator are not distinguishable by this test.

Note the third row. Mixing the timestamp in does not dilute its bias, it spreads
it: position alone passes everything, position plus timestamp fails almost
everything. The timestamp is still read, because deduplication needs it, but
none of its bits reach the pool.

Reproduce any of this with `npm run analyse`.

## Deduplication is not hygiene

The feed repeats itself. A flash is several strokes, and a stroke can be
reported more than once, so 56% of consecutive frames arrive within 25.6µs of
each other and a good fraction are exact repeats. Consecutive frames are not
independent, and until they are separated every field fails serial correlation
at lag 8.

The rule is one line: reject a strike within 25.6µs of any recently accepted one.
That window is a full cycle of the low byte, and it subsumes exact-duplicate
detection, since a repeat carries a timestamp already in the window. About half
of all frames survive, measured at 48% offline and 51% in the browser.

## The tests

Four, running continuously on the pool, all two-sided:

| | |
| --- | --- |
| **monobit** | Are there as many ones as zeros |
| **runs** | Are the streaks the right length. Catches a balanced stream that merely alternates |
| **chi² per byte** | Is the byte distribution flat. Fails *too* flat as well as too lumpy |
| **serial** | Correlation at lag 1 to 8, Bonferroni corrected |

Two details worth the space, because both were bugs first.

**chi² has to be two-sided.** Run against a plain counter, the suite as first
written passed it on monobit, runs *and* chi², scoring X2=3 with p=1.0000: a
counter emits every byte value exactly once and so looks like the most uniform
stream ever measured. Only serial correlation caught it.

**serial has to be corrected.** Reporting the smallest of eight lag p-values is
testing eight hypotheses and quoting the luckiest, which trips on a clean stream
about 8% of the time against a threshold claiming 1%.

Even corrected, four tests at p<0.01 throw a false failure on roughly 4% of
evaluations. That is what the threshold means, not a defect. The badges
therefore need three consecutive failures before they turn over, and a single
red badge is expected. Only a badge that stays red is telling you something.

## Drawing from it

A coin, a d6, a d20, an integer in any range, a UUID, a shuffled deck, a plate
of generative art, and a blockie.

A draw does not read the pool. It waits for strikes that have not happened yet
and is answered by the first ones that do, which is why every result carries the
strikes it consumed and the seconds they spanned. The byte reader is created
when the button is pressed, so "fresh bits" is structural rather than a promise:
a reader that did not exist a moment ago cannot be holding anything the pool
already had. A UUID needs sixteen bytes and cites eight strikes; the artwork
needs thirty-two and cites sixteen. Two bytes a strike, exactly.

Integers use rejection sampling, never a modulus. With n=6 a modulus hands
residues 0 and 1 an extra count each out of 256, a 2.4% loaded die that nothing
short of a histogram would catch, on a page whose whole claim is that it does
not do that. `npm test` asserts exactly 42 of each face over one byte cycle and
prints what the modulus would have produced beside it.

The **artwork** is a walk from its own 256 bits, the same form the page draws
large, with the seed printed underneath in full so the plate can be redrawn from
its own caption and checked.

The **blockie** is the identicon from Tyche, whose tile rules come from the
classic ethereum-blockies construction: an 8x8 grid with its left four columns
mirrored,
cells weighted 10/23, 10/23, 3/23, and three HSL colours. The difference is
where the randomness enters. Those implementations run a seed string through an
xorshift PRNG and let the generator paint the tile, which is right when the tile
must be reproducible from an address. Here the generator is the thing being
avoided, so every cell and every colour is read off fresh strikes directly.

It is also the only colour on the site. The rule everywhere else is that white
is reserved and the lone amber means a failing test, so no part of the interface
may be colourful. A blockie is not interface: it is output, it sits in a bordered
plate, and its hues are themselves lightning.

## Honest limits

**These bits are unpredictable, not secret.** The stream is public. Everyone
watching sees the same strikes at the same moment. Unpredictable in advance and
publicly observable are different properties, and only the first one holds here.
Do not use this for keys.

**It is slow, and slower at quiet hours.** Between 1.6 and 4.5 usable strikes
per second depending on the weather, so 26 to 70 raw bits per second. A 256 bit
draw takes seconds, not milliseconds. Waiting for the sky is the point.

**Conditioning is a safety net, not a rescue.** The pool holds raw bytes and
applies SHA-256 block extraction on the way out, so both streams can be shown.
The source passes every test unconditioned, and saying otherwise would be a
better story and a false one.

## Running it

```sh
npm test                  # the suite against the fixture and both controls
npm run smoke             # the real modules against the live feed, 60s
npm run analyse           # compare candidate sources in a harvest
npm run harvest 300 > fixtures/new.jsonl
npm run dev               # serve the page on :8080
```

No dependencies and nothing to install. Node has had a global WebSocket since
v22, which is all the tooling needs.

The page reads its feed from `?feed=wss://…`. In production that is the relay.
For development, `?feed=wss://ws1.blitzortung.org:443/&hello=1` talks straight
to the upstream, where `hello` sends the subscription the relay would otherwise
send on your behalf.

## Layout

```
src/          source.js   the socket, the dedup filter, extraction
              pool.js     4KB ring of raw bytes, SHA-256 extraction
              tests.js    the four tests, and the only copy of them
              draw.js     the suspending byte reader, unbiased integers
              art.js      the artwork plate
              blockie.js  the identicon, from Tyche's tile rules
              ui.js       the walk, the gauges, the badges, the draws
              style.css   the palette, shared with Keraunos
tools/        check.mjs   npm test
              smoke.mjs   npm run smoke
              analyse.mjs npm run analyse
              harvest.mjs npm run harvest
fixtures/     strikes.jsonl   3,738 deduplicated strikes, the sample every
                              figure above was measured against
plan.md       the build order, and the record of what changed and why
```

`tests.js` is imported by both the page and the tools on purpose. It used to be
duplicated, and the copies fell out of step the moment the serial test was
corrected, so for a while the tools were grading sources with a test the page
had already stopped using.

## Credit

Strikes from the [Blitzortung](https://www.blitzortung.org/) network, a
volunteer-run system of receivers, by way of the relay built for
[Keraunos](https://keraunos.corvardt.com). Blitzortung ask that a project using
their data serve it from its own server rather than theirs, and the relay is how
both instruments do that: one socket upstream, however many readers.

The same sky, counted by one and drawn from by the other.
