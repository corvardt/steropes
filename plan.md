Concept
True random numbers harvested from thunderstorm timing, verified live, drawn on demand. Single-page instrument, no map, no bolts.

0. Decision, separate page, shared relay
Steropes ships as its own repo and its own domain, not as a panel inside Keraunos.
Keraunos is a map instrument ("every lightning strike on earth, as it is detected") and its own expansion proposal ranks ten features, none of them entropy. An RNG drawer is a different instrument that happens to drink from the same tap.
Merging would mean retrofitting into ~996 lines of App.jsx plus twenty lib modules, a settings system, tour engine, rewind track. Separating costs one config line.
The shared piece is already standalone: Keraunos/relay is a Cloudflare Durable Object holding exactly one upstream socket to Blitzortung and broadcasting frames unchanged, deployed on its own hostname and reached through VITE_FEED_URL. Steropes points at the same URL and gets the identical stream. Blitzortung's "serve it from your own server" request stays satisfied for both.
Cross-link the two in the footer, the same sky, counted / the same sky, drawn from.
1. Entropy source
Connect to the same relay Keraunos uses (VITE_FEED_URL). Reuse the LZW decode() and the reconnect/backoff logic from Keraunos Seeker.jsx, the reconnect especially: this feed drops, and a harvester without a close handler silently reports a long run holding a few minutes of data.
The source is position, not time. This is the opposite of what this section originally said, and it was settled by measurement rather than argument: harvest.cjs and analyse.cjs over 7,643 frames across two sessions, 3,738 of them after deduplication.
Take the low 8 bits of round(abs(lat) × 1e6) and the same of lon. 16 bits per usable strike. Six decimal places is about 11cm, far finer than the network can actually fix a strike, so the low digits are solver noise rather than position. They test clean: lat gives chi2 X2=253 against df=255 on 3,738 bytes, where the Math.random control on the same suite gives 253. Indistinguishable from the reference.
Do NOT use the timestamp as a counted bit source. Its 100ns digit is severely biased, residues over the deduped sample run 239 22 79 83 90 77 88 81 85 14 against 86 expected each, X2=383 on df=9. About 28% of fixes land on exact microsecond multiples: the solver mixes precisions, some fixes to 1us and some to 100ns. This is intrinsic and survives deduplication. Including it poisons an otherwise clean stream, lat+lon+time together fail monobit, runs and chi2 (X2=1499) where lat+lon alone pass everything.
Δt between strikes also fails, worse. Inter-arrival times are heavily skewed by multi-stroke flashes, so their low bits are biased: monobit p=0.0000.
delay fails too, one decimal place, chi2 X2=600. Not a source.
Deduplication is mandatory, not hygiene. 56% of consecutive frames arrive within 25.6us of each other and 256 of 1786 were exact repeats: multi-stroke flashes and repeated reports. Consecutive frames are not independent, which shows up as serial correlation at lag 8 across every field. Drop exact repeats on (time,lat,lon), then require 25.6us spacing. About 48% of frames survive.
Rate: 1.6 usable strikes/s measured over a 38-minute window, so ~26 raw bits/s, and a 256-bit draw takes ~10s. The original 30-100 strikes/s was the raw frame rate before dedup and at a busier hour; the honest planning figure is the deduped one.
Precision trap, still true and still silent: time is ~1.77e18 and Number.MAX_SAFE_INTEGER is 9.0e15, so JSON.parse rounds its low bits away. Only relevant now for the dedup key, but the timestamps look perfectly fine afterwards, which is what makes it dangerous. Pull it from the decoded text with a regex and keep it a BigInt.
The timestamp still goes into the hash conditioner, it costs nothing and can only help, but it must not count toward the bits-available gauge. Conditioning concentrates entropy; it never creates it. That distinction is the honesty layer's whole job.
2. Conditioning (honesty layer)
Raw bits are biased → von Neumann debiasing (or SHA-256 hashing of 512-bit blocks, the standard extractor approach). Show both raw and conditioned streams, the transparency is the content.
Maintain an entropy pool (e.g. 4KB ring buffer) with a live "bits available" gauge.
Two caveats the page must state plainly, this instrument lives or dies on honesty, and both are content rather than disclaimer:
Blitzortung's time is a solved fix time from multilateration, not a raw sensor clock. Its low bits may carry structure from the solver rather than pure physical noise. This is an open question, not a known good, settle it with the test suite before building on it (see build order).
The stream is public. Everyone on the relay sees the same strikes at the same moment, so these bits are unpredictable in advance but publicly observable. Never pitch this as cryptographic randomness. The distinction between "unpredictable" and "secret" is worth explaining in the About section.
3. Live verification
Run in-browser on the conditioned stream, updating continuously:
Monobit frequency test (0/1 balance)
Runs test (streak lengths vs expectation)
Serial / autocorrelation test
Chi² on byte distribution, two-sided. This matters more than it sounds: run against a plain counter, this suite as originally specified passed it on monobit, runs AND chi², scoring X2=3 with p=1.0000, because a counter emits every byte value exactly once and so looks like the most uniform stream ever measured. Only serial correlation caught it. Too flat must fail exactly as too lumpy does.
Correct the serial test across its lags. Reporting the smallest of eight lag p-values raw tests eight hypotheses and quotes the luckiest, so a clean stream trips it ~8% of the time against a threshold claiming 1%. Bonferroni applied in tests.js.
Even corrected, the four tests together throw a false failure on about 4% of evaluations, that is what a 0.01 threshold means, not a bug. A live badge re-evaluating continuously will therefore go red on good data several times an hour. Two things follow: the badges need hysteresis or a sustained-failure rule rather than flipping on a single evaluation, and the About section should say plainly that an occasional red badge is expected and only persistent failure means anything. Getting this wrong teaches the visitor the opposite of the lesson the page exists to give.
Each shown as a pass/fail badge with p-value and a small sparkline. Include a shuffled-surrogate comparison so users see what "passing" looks like vs a rigged stream, the counter above is the surrogate to use, and the fact that it beats three of four tests is the demonstration.
Keep a known-good control (Math.random) beside the known-bad one. A suite that cannot separate those two says nothing about lightning either; both controls are already in analyse.cjs.
4. Visuals
Hero: the bitstream itself, a cascading bit-matrix or a 2D random walk being drawn live by the atmosphere (this is the screenshot people share).
Secondary: entropy pool gauge, strikes/s pulse, test badges.
Aesthetic: dark instrument panel, monospace, one accent color, consistent with your instrument-series signature.
5. Interaction, "Draw from the sky"
User requests an output; it's generated from the next fresh bits (not the pool history), with provenance shown (N strikes consumed, timestamps):
Coin flip / dice / d20
Random integer in range / UUID
Shuffled deck
Generative artwork seeded by 256 fresh bits (downloadable, seed printed on it)
Blockie, the identicon from Tyche. Tile rules taken from Keraunos/ignored/blockie.ts, which is the classic ethereum-blockies construction: 8x8 with the left four columns mirrored, cells weighted 10/23 10/23 3/23, three HSL colours drawn primary then background then spot. Not taken: the other two thirds of that file, a hand-written GIF89a encoder with its own LZW packer, which exists to avoid a canvas. This page has a canvas and saves through toBlob.
The departure is provenance. Both that file and Tyche's npm build run a seed string through an xorshift PRNG and let the generator paint the tile, which is correct when the tile must be reproducible from an address. Here a generator expanding a seed is the thing being avoided, so every cell and colour reads fresh strikes directly.
The blockie is the only colour on the site, and it is an artifact rather than interface, which is the whole of the exception to the reserved-white rule.
6. Stack
Vanilla JS or lightweight framework + Canvas/WebGL for the walk; no backend needed, the relay already exists and is not Steropes's to build or run.
~3 modules: source.js (WS + bit extraction), pool.js (debias + tests), ui.js (render + draws).
7. Build order
DONE, WS ingest + bit extraction + the test suite, in harvest.cjs and analyse.cjs. Both live in this repo and are the reference implementation for source.js and pool.js: the extraction, the dedup rule and the four tests are settled and measured. analyse.cjs carries both controls and should stay the gate whenever the source changes.
DONE, conditioning + entropy pool + tests, in src/tests.js, src/source.js, src/pool.js. `npm test` (check.mjs) runs the suite against the committed fixture and both controls; `npm run smoke` drives the real modules against the live feed. Measured end to end: 48.5% of frames accepted, matching the 48% predicted from the batch analysis, 4.4 usable strikes/s at a busy hour.
Von Neumann debiasing skipped: SHA-256 block extraction yields 50% against its ~25%, and at these rates yield is the binding constraint. Recorded as a ponytail note in pool.js. Add it beside the extractor only if the page wants to show the classical method for its own sake.
DONE, hero walk, gauges and badges, in index.html, src/style.css, src/ui.js. Verified in a real browser against the live feed: 51% accepted, 4.2-4.6 usable strikes/s, no console errors, dark and paper themes and the narrow layout all checked by screenshot.
The walk observes the byte stream rather than drawing from the pool, so looking at it does not consume what step 4 will draw from.
Two bits per step, four directions, eight steps per strike. The view is derived from the extent of the path every frame, so the drawing frames itself and the zoom level reads as elapsed entropy.
Badge hysteresis implemented as planned above: three consecutive failures to turn a badge over, recovery on the first pass.
Colour discipline: white (or black on paper) is reserved for the newest bit, exactly as Keraunos reserves it for a strike. The single amber appears nowhere except a failed test, so colour on this page always means the same thing.
Fonts are copied from Keraunos rather than re-picked, same series, same face.
DONE, draw-from-the-sky interactions and provenance, in src/draw.js and src/art.js.
Fresh bits are structural, not a promise: the byte reader is created when the button is pressed, so it cannot be holding anything the pool already had. Verified in the browser, uuid needs 16 bytes and cited 8 strikes, the artwork needs 32 and cited 16, which is two bytes per strike exactly.
Integers use rejection sampling, never a modulus. With n=6 a modulus gives residues 0 and 1 an extra count each out of 256, a 2.4% loaded die that no casual inspection would catch. The check asserts exactly 42 of each face over one byte cycle and prints what the modulus would have done.
The artwork is a walk from its own 256 bits, the same form the hero draws, with the seed printed under it in full. The caption is the entire input, so the plate can be redrawn from it and checked.
Polish, empty-state (low storm activity) handling, About/methodology section (half a day)
Key risk, now resolved and worth keeping as the record: the low bits of a solved fix time are NOT random. The risk fired exactly as written. Testing at step 1 caught it before anything was built on it, and the source moved to lat/lon. Had the tests come after the pool and the UI, the instrument would have shipped confidently emitting biased bits with four green badges above them, the small 222-strike sample did pass the timestamp on three of four tests, and only at 1,786 did it fail. Sample size was the difference between catching this and not.
Second risk: low global strike rate at certain hours → slow bit accumulation. Mitigation: show "harvesting…" state honestly and queue draws, waiting for the sky is part of the charm.
