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

Four, running continuously on the pool, all two-sided. Each returns a p-value:
the probability of seeing a pattern this extreme *if the stream really were
random*. A low p means the pattern would be a surprising coincidence, and below
0.01 the badge calls it a failure.

They are a ladder. Every one of them exists because the one before it can be
fooled, and the fourth column is the whole reason there are four.

| | asks | fails when | fooled by |
| --- | --- | --- | --- |
| **monobit** | Are there as many ones as zeros | one symbol leads | `0101…`, perfectly balanced and perfectly predictable |
| **runs** | Are the streaks the right length | too many transitions, or too few | structure that only shows at the byte level |
| **chi² per byte** | Is the byte distribution flat | lumpy, *or too flat* | correlation with flat marginals |
| **serial** | Is there correlation at lag 1 to 8 | any lag repeats | — |

**monobit** counts the ones and measures how far off half that is, in standard
deviations: `s = |2·ones − n| / √n`, then `p = erfc(s/√2)`.

**runs** counts maximal streaks of identical bits against the `2n·π(1−π)`
expected of independent ones. This is what kills the alternating stream monobit
waves through — it has the most runs a sequence can have. It carries a
precondition: if monobit is already badly off, the runs statistic is not
meaningful, so it returns p=0 rather than a number that looks like a reading.

**chi² per byte** packs the bits into bytes, counts all 256 values and compares
to the `n/256` expected, `X2 = Σ (observed − expected)² / expected` on df=255,
with p from the Wilson–Hilferty approximation. It needs 1,280 bytes so that
every bin expects at least five; below that it reports no reading rather than an
invalid one. A real stream scatters around X2≈255 — the lightning scores 286,
the seeded-PRNG control 265.

**serial** counts, for each lag 1 to 8, how often bit *i* equals bit *i+k*.
Independent bits agree half the time, and a repeat every k bits spikes at lag k.
It is the test that caught the duplicate frames before deduplication existed.

Each badge's tooltip carries the test's own working: `1247/2496 ones`,
`X2=286 df=255, 1502 bytes`, `worst lag 3 (x8 corrected), 1:0.412 2:0.208 …`.

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

### Reading the badges

Each badge is a row: the test, a trace of its last twenty-four evaluations
against the threshold it is held to, the verdict in a word, and the current
p-value. The verdict is written as well as coloured, because the amber is the
only colour on the site and a reading that exists only in a hue is a reading
some people never get.

The trace does not plot p. Drawn against a linear 0..1 axis the threshold sits at
0.01 — the bottom one percent of the box, a tenth of a pixel at this height — so
the one line that decides the verdict was invisible and the trace was a wiggle
with no reading on it. It plots **headroom** instead: `log10(margin / alpha)`,
how many decades of room the test has before it fails. Zero is exactly on the
threshold, positive is passing, negative is failing.

Two things fall out of normalising against each test's own alpha. One dashed
rule can be drawn at one height across all four rows and mean the same thing on
each. And the two-sided case folds in: for chi² the margin is `min(p, 1−p)`, so
a trace diving toward the rule reads the same whether it is going too lumpy or
too flat. The rigged stream's chi² pins itself to the floor at p=1.000, which is
the whole argument, drawn.

The axis clamps to two decades above the rule and one below, so a single
catastrophic evaluation cannot flatten every other point in the window against
an edge. A test still waiting for its minimum sample has no p-value at all, and
that absence leaves a gap in the trace — it used to be plotted as zero, the
worst score there is, which drew chi² as a flatline along the floor while it was
merely counting bytes.

`src/spark.js` holds the transform on its own, and `npm test` grades it: a
transform nobody can run is a transform nobody can check.

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

Every draw lands in **drawn this session**, newest first, twenty-four deep. A row
is what was asked, what came back and what it cost in strikes, and clicking one
reopens it. The entries hold the value and its provenance rather than a rendered
card, so reopening re-runs the same render the draw did: a plate recalled is a
plate redrawn from its own bytes, which is the property its printed seed claims,
exercised on every recall.

The history lives in the tab and nowhere else. A page whose claim is that it
stores nothing has no business writing your draws to disk, so a reload is the end
of them.

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

### The feed

The page never talks to Blitzortung directly. The relay built for Keraunos holds
the one upstream socket and fans it out, which is what Blitzortung ask a project
using their data to do, and both instruments read from it.

Its address is deployment configuration, so it sits in the document that gets
deployed rather than compiled into a module — there is no build step here for a
`.env` to be substituted into, which is where Keraunos keeps the same value:

```html
<meta name="feed" content="wss://keraunos-relay.covardt.workers.dev/feed" />
```

`?feed=wss://…` overrides it. For development,
`?feed=wss://ws1.blitzortung.org:443/&hello=1` talks straight to the upstream
without a relay in the way, where `hello` sends the subscription the relay would
otherwise send on your behalf. Against the relay no `hello` is sent, because it
subscribes itself; sending a second one would be a duplicate subscription.

**The relay decides which origins it carries.** Its `ALLOWED_ORIGINS` is a
comma-separated list, and unset it answers anybody, which is what a local
`wrangler dev` wants and what a public deployment does not — an open relay in
front of a volunteer's server hands back the one property the relay exists to
protect. So Entropic's origin has to be added to it, alongside Keraunos's. Until
it is, the handshake is refused with a 403 and the bezel sits on `[ linking ]`
forever, which looks exactly like a relay that is down.

## Deploying

There is no build step, which is the point. The repository *is* the site: point
Cloudflare Pages at it with an empty build command and the root as the output
directory, and what gets served is what is committed.

That is a deliberate trade and worth stating plainly, because it is the opposite
of what the two React projects in the set do. Vite exists in Keraunos and Tyche
to compile JSX; nothing here needs compiling, and bundling would cost the one
property this page is built to have — a reader can open devtools on the deployed
site and read the same `tests.js` that is grading the stream, comments intact.
Minified into a hashed bundle, "verified in front of you" becomes a claim rather
than something you can check. Oikos, the other project in the set with no JSX,
ships raw for the same reason.

The bill for that is stable filenames, and `_headers` pays it: the fonts are held
forever, everything else revalidates. Without it a returning reader can run last
week's tests while this week's badges vouch for them.

Two things are not in this repository and have to be done once:

**Add the origin to the relay.** `ALLOWED_ORIGINS` on the Keraunos relay worker
is a comma-separated exact-match list of the origins it will carry, and unset it
answers anybody — an open relay in front of a volunteer's server, which is the
one thing the relay exists to prevent. It currently holds Keraunos alone, so
Entropic's origin has to be appended:

```
https://keraunos.corvardt.com,https://entropic.corvardt.com
```

No trailing slashes: a browser's `Origin` header never carries one, and the
match is exact, so `https://entropic.corvardt.com/` is silently refused. Until
the origin is on the list the handshake is rejected with a 403 and the bezel
sits on `[ linking ]`, which looks exactly like a relay that is down.

**Nothing else.** The icons and the unfurl card ship with the repository.

### The card

`og.png` is captured from the running instrument rather than drawn:

```sh
npm run shots                    # 1200x630 from production, after a 2min soak
npm run shots -- --soak 420      # long enough for chi2 to stop waiting
npm run shots -- --url http://localhost:8080/?feed=wss://…
```

It has to be regenerable, because what it shows is the weather on the morning it
was taken. A screenshot pasted in once decays quietly — the palette moves, a
readout is renamed, a badge gains a column — and the card keeps advertising an
instrument that no longer exists.

The soak is the whole difficulty. A page grabbed on load is an empty grid and a
fair picture of nothing, so the shot waits: about 20s before the walk has been
anywhere, 40s before monobit, runs and serial have their 500 bits, and around
four minutes before chi2 has the 1,280 bytes it needs to stop reporting that it
is still counting.

Keraunos does this with puppeteer-core. This project has no dependencies and
says so on the tin, so `tools/shots.mjs` speaks CDP over the WebSocket Node has
had since v22 — the same one the rest of the tooling already leans on. Sixty
lines, and nothing to install.

The icons are in `/home/crv/Documents/icons` with the rest of the set's, and
carry its grammar: a dark tile with its own ground, the bloom, a hairline edge,
one figure. Entropic's is the only one drawn in both inks, because it is the
only page whose subject is a history and an arrival at once — the trail at rest
ink under the decay rule, the head at the strike white Keraunos and Tyche are
entitled to.

## Layout

```
src/          source.js   the socket, the dedup filter, extraction
              pool.js     4KB ring of raw bytes, SHA-256 extraction
              tests.js    the four tests, and the only copy of them
              spark.js    the badge trace: headroom, not p
              draw.js     the suspending byte reader, unbiased integers
              art.js      the artwork plate
              blockie.js  the identicon, from Tyche's tile rules
              ui.js       the bezels, the walk, the gauges, the badges, the
                          draws and the session's history
              theme.js    the medium, on the cookie the whole domain shares
              style.css   this instrument's own; the medium is crt.css
crt.css       the shared medium: palette, type, glass, decay. Carried verbatim
              from Keraunos by way of Oikos, so the whole set is one instrument
_headers      cache policy. Stable filenames need one; see Deploying
fonts/        IBM Plex Mono, served from this origin rather than from Google
tools/        check.mjs   npm test
              smoke.mjs   npm run smoke
              analyse.mjs npm run analyse
              harvest.mjs npm run harvest
              shots.mjs   npm run shots, the unfurl card from the real thing
glyph.svg     the favicon. apple-touch-icon.png is the same, squared and bled
og.png        the card. Captured, not drawn; see Deploying
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
