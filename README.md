# Steropes

Στερόπης: the lightning-maker, who forged the bolt.

**Random numbers drawn from lightning, verified in front of you.**

**[steropes.corvardt.com](https://steropes.corvardt.com)**

![The instrument: a random walk drawn one step per lightning strike, beside a
panel counting the bits collected and grading them against four statistical
tests.](og.png)

Every strike detected anywhere on earth arrives here a few seconds later. The
low digits of where it struck are noise from the network's own solver, far finer
than it can really locate a flash, and nobody can predict them because nobody can
predict when and where lightning happens. Steropes collects those digits, tests
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
| **serial** | Is there correlation at lag 1 to 8 | any lag repeats | none |

**monobit** counts the ones and measures how far off half that is, in standard
deviations: `s = |2·ones − n| / √n`, then `p = erfc(s/√2)`.

**runs** counts maximal streaks of identical bits against the `2n·π(1−π)`
expected of independent ones. This is what kills the alternating stream monobit
waves through: it has the most runs a sequence can have. It carries a
precondition: if monobit is already badly off, the runs statistic is not
meaningful, so it returns p=0 rather than a number that looks like a reading.

**chi² per byte** packs the bits into bytes, counts all 256 values and compares
to the `n/256` expected, `X2 = Σ (observed − expected)² / expected` on df=255,
with p from the Wilson–Hilferty approximation. It needs 1,280 bytes so that
every bin expects at least five; below that it reports no reading rather than an
invalid one. A real stream scatters around X2≈255. The lightning scores 286,
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
evaluations. That is what the threshold means, not a defect, so the badges need
three consecutive failures before they turn over.

Be clear about what that buys, because it is less than it looks. Hysteresis of
that kind absorbs *independent* failures, and consecutive evaluations here are
not independent: the pool is a ring the sky fills slowly, so at a couple of
strikes a second an evaluation two seconds after the last one is grading almost
exactly the same bytes. Three in a row is barely more evidence than one. A badge
does not go red on a bad moment and recover; it goes red on a bad *window*, and
stays red until the ring has turned that window over.

Which is why the ring is 2KB rather than the 4KB the plan suggested off the cuff.
The only hard floor is chi²'s, 1,280 bytes for five expected per bin; everything
above that is bought at the price of a longer memory. At 4KB a single unlucky
window held a badge red for 16 to 24 minutes at the rates this feed runs. At 2KB
it is 4 to 8, with 8 expected per bin still comfortably clear of the floor.

So: a red badge that clears within a few minutes is the threshold doing its job.
One that outlives a full turnover of the ring is telling you something.

### Reading the badges

Each badge is a row: the test, a trace of its last twenty-four evaluations
against the threshold it is held to, the verdict in a word, and the current
p-value. The verdict is written as well as coloured, because the amber is the
only colour on the site and a reading that exists only in a hue is a reading
some people never get.

The trace does not plot p. Drawn against a linear 0..1 axis the threshold sits at
0.01, the bottom one percent of the box, a tenth of a pixel at this height, so
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
that absence leaves a gap in the trace. It used to be plotted as zero, the
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

The **exposure** is the only one that is a window rather than an allocation.
Every other draw asks how many bytes it needs and stops, so the wait is a side
effect; this one takes a duration (one, five or fifteen minutes) and the plate
is whatever fell into it. That makes the time the subject rather than a cost:
two exposures of the same length differ because the weather did, and a quiet
night and a storm come out as visibly different pictures rather than the same
picture arriving at different speeds. The caption carries the window, the strike
count and the rate that implies, so the plate is a reading as well as a figure.
Closing the shutter early keeps what has arrived, because a fifteen-minute
window nobody can get out of is a window nobody will open.

A draw outlives its card. Dismissing one leaves it collecting, and the top row
of the history is the way back to it; a long exposure that could only be watched
was one you had to sit in front of.

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

## Showing the working

Three readouts exist so the page's claims can be checked rather than believed.

**Derivation** prints the step everything rests on: the solved fix, and the byte
taken off it. `round(|degrees| × 1e6) & 0xff`, one row per frame, so the claim
that the low byte of a position is solver noise can be confirmed against the raw
stream above it with a calculator. Rejected frames stay in the list rather than
disappearing from it. A filter that discards a quarter of what arrives is
easier to believe when the discarding is visible, and the acceptance figure a
few lines up is otherwise just a number.

**Raw stream** is the pool's newest bytes, in the order they landed, newest in
the reserved white.

**Conditioned** is the same bytes through SHA-256 block extraction, 64 in and 32
out. Both are shown because the honest claim is that the source passes every
test *unconditioned*; the extractor is a safety net, and a net described but
never shown is a net nobody can weigh. It is not what rescues the numbers.

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
git clone https://github.com/corvardt/steropes
cd steropes
npm run dev
```

Then open the page with a feed on the address:

```
http://localhost:8080/?feed=wss://ws1.blitzortung.org:443/&hello=1
```

There is nothing to install. No dependencies, no build step, no bundler: the
repository is the site, and `npm run dev` is `python3 -m http.server`. The
command-line tools want Node 22 or newer, which is the version that gave Node a
global `WebSocket`; the page itself wants only a browser.

That address talks straight to Blitzortung, which is the right thing for one
person for a few minutes and the wrong thing for a deployed site. See
[Running your own](#running-your-own) for why, and for the relay that fixes it.
`hello` sends the subscription the feed expects, which in production the relay
sends on your behalf.

### The tools

```sh
npm test                  # the suite against the fixture and both controls
npm run smoke             # the real modules against the live feed, 60s
npm run analyse           # compare candidate bit sources in a harvest
npm run harvest 300 > fixtures/new.jsonl
npm run shots             # recapture the unfurl card from a running instrument
```

`npm run analyse` is the one worth knowing about. It is the tool that decided
where the entropy actually is, and it is kept runnable rather than written up
and thrown away, because the answer is a property of the network rather than of
this code. If Blitzortung ever change how a fix is solved, harvest a fresh
sample and run it again.

## Running your own

Three things, and only the first is unusual.

### 1. A relay, because Blitzortung ask for one

The page never talks to Blitzortung directly, and neither should yours.
Blitzortung is a volunteer network, people who bought a receiver and put it on
their roof, and they ask that a project using their data serve it from its own
server rather than pointing every visitor at theirs. One socket upstream,
however many readers.

The relay is a Cloudflare Worker and it lives in the
[Keraunos](https://github.com/corvardt/keraunos) repository under `relay/`,
because both instruments read from the same one. Deploy it and you get a
hostname:

```sh
cd relay && npm run deploy
```

Then tell the page where it is. There is no build step here for a `.env` to be
substituted into, so the address lives in the document that actually gets
deployed:

```html
<meta name="feed" content="wss://your-relay.example.workers.dev/feed" />
```

`?feed=wss://…` on the address overrides it, which is how development points
straight at the upstream instead.

### 2. Let the relay carry your origin

The relay's `ALLOWED_ORIGINS` is a comma-separated, exact-match list of the
origins it will serve. Unset, it answers anybody, which is what a local
`wrangler dev` wants, and what a public deployment must not be: an open relay in
front of a volunteer's server hands back the one property the relay exists to
protect.

```
https://steropes.example.com,https://keraunos.example.com
```

No trailing slashes. A browser's `Origin` header never carries one and the match
is exact, so `https://steropes.example.com/` is silently refused. Until your
origin is on the list the handshake is rejected with a 403 and the page sits on
`[ linking ]` forever, which looks exactly like a relay that is down.

Note that a Pages preview deployment is a *different* origin from your custom
domain, and will be refused unless you add it too.

### 3. Serve the repository

There is no build step, which is the point. Point Cloudflare Pages at the repo:

| setting | value |
| --- | --- |
| framework preset | None |
| build command | *(empty)* |
| build output directory | `/` |

Any static host works; `_headers` is Pages-specific and the rest is plain files.

**Why no bundler.** Nothing here needs compiling: no JSX, no TypeScript, just
ES modules a browser already runs. Bundling would also cost the one property the
page is built to have: open devtools on the deployed site and you can read the
same `tests.js` that is grading the stream, comments intact. Minified into a
hashed bundle, "verified in front of you" stops being something anyone can
check.

The bill for that is stable filenames, and `_headers` pays it: the fonts are
held indefinitely, everything else revalidates. Without it a returning reader
runs last week's tests while this week's badges vouch for them.

### The card and the icon

`og.png` is captured from the running instrument rather than drawn:

```sh
npm run shots                                      # from production
npm run shots -- --soak 420                        # until chi2 stops waiting
npm run shots -- --zoom 1                          # 1:1, walk only, no badges
npm run shots -- --url "http://localhost:8080/?feed=wss://…"
```

It has to be regenerable, because what it shows is the weather on the morning it
was taken. A screenshot pasted in once decays quietly. The palette moves, a
readout is renamed, a badge gains a column, and the card goes on advertising an
instrument that no longer exists.

The soak is the whole difficulty. A page grabbed on load is an empty grid and a
fair picture of nothing, so the shot waits: about 20s before the walk has been
anywhere, 40s before monobit, runs and serial have their 500 bits, and about
four minutes before chi² has the 1,280 bytes it needs to stop reporting that it
is still counting.

The card is 1200×630 because that is the shape the people who unfurl it chose,
and the panel is taller than that. At 1:1 the badges, which are the whole
argument, fall off the bottom, so it renders at 1.6× and scales back down: the
same 1200×630 file, holding about a thousand pixels of column instead of six
hundred. The type ends up
small, which costs nothing, because a card is drawn a few hundred pixels wide in
a timeline and nobody was reading p-values off it there.

`tools/shots.mjs` drives Chrome over the DevTools Protocol using the WebSocket
Node has had since v22, rather than pulling in a browser-automation dependency
for a script that runs a few times a year. Sixty lines, nothing to install.

`glyph.svg` is the favicon and `apple-touch-icon.png` is the same figure squared
and bled, because iOS masks its own corners and rounding it here would round it
twice.

## Layout

```
src/          source.js   the socket, the dedup filter, extraction
              pool.js     2KB ring of raw bytes, SHA-256 extraction
              tests.js    the four tests, and the only copy of them
              spark.js    the badge trace: headroom, not p
              draw.js     the suspending byte reader, unbiased integers, and
                          the exposure window
              art.js      the artwork plate
              blockie.js  the identicon, from Tyche's tile rules
              ui.js       the bezels, the walk, the gauges, the badges, the
                          draws and the session's history
              theme.js    the medium, on the cookie the whole domain shares
              style.css   this instrument's own; the medium is crt.css
crt.css       the shared medium: palette, type, glass, decay. Carried verbatim
              from Keraunos by way of Oikos, so the whole set is one instrument
_headers      cache policy. Stable filenames need one; see above
fonts/        IBM Plex Mono, served from this origin rather than from Google
tools/        check.mjs   npm test
              smoke.mjs   npm run smoke
              analyse.mjs npm run analyse
              harvest.mjs npm run harvest
              shots.mjs   npm run shots, the unfurl card from the real thing
glyph.svg     the favicon. apple-touch-icon.png is the same, squared and bled
og.png        the card. Captured, not drawn; `npm run shots`
fixtures/     strikes.jsonl   3,738 deduplicated strikes, the sample every
                              figure above was measured against
plan.md       the build order this was written against, kept as the
              record of what changed and why
```

`tests.js` is imported by both the page and the tools on purpose. It used to be
duplicated, and the copies fell out of step the moment the serial test was
corrected, so for a while the tools were grading sources with a test the page
had already stopped using.

## Credit

Strikes from the [Blitzortung](https://www.blitzortung.org/) network, a
volunteer-run system of receivers built and hosted by people who bought the
hardware themselves. They ask that a project using their data serve it from its
own server rather than theirs, and the relay is how that is done here: one
socket upstream, however many readers.

The relay was built for [Keraunos](https://github.com/corvardt/keraunos), which
plots the same feed as weather. Both instruments read from it, and the palette,
type and glass are carried between them verbatim so they read as one set. The
same sky, counted by one and drawn from by the other.

The identicon's tile rules come from [Tyche](https://github.com/corvardt/tyche),
by way of the classic ethereum-blockies construction.

## Licence

[MIT](LICENSE). Do what you like with the code.

The data is a separate question. Strikes come from the Blitzortung network and
are theirs, under their own terms; nothing here grants any rights to them. If
you run your own instance, run your own relay and be a good guest of a service
that volunteers pay for.
