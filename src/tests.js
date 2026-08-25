// The four randomness tests, and the only implementation of them.
//
// These run in two places, live in the page against the pool, and offline in
// check.mjs against the committed fixture, and the one thing that must never
// happen is the two drifting apart. A page that grades itself with a different
// monobit than the one the fixture was verified with is grading itself with
// something nobody checked.
//
// p-values are two-sided throughout. A test that only looks for too-much
// structure passes a counter; see chi2Bytes.

// Numerical Recipes erfc, fractional error < 1.2e-7. Every test here needs it
// and the platform does not have one.
export function erfc(x) {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const y = t - 0.5;
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        y *
          (1.00002368 +
            y *
              (0.37409196 +
                y *
                  (0.09678418 +
                    y *
                      (-0.18628806 +
                        y *
                          (0.27886807 +
                            y *
                              (-1.13520398 +
                                y * (1.48851587 + y * (-0.82215223 + y * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

// Are there as many ones as zeros? (NIST SP 800-22)
export function monobit(bits) {
  const ones = bits.reduce((a, b) => a + b, 0);
  const s = Math.abs(ones * 2 - bits.length) / Math.sqrt(bits.length);
  return { p: erfc(s / Math.SQRT2), detail: `${ones}/${bits.length} ones` };
}

// Are the streaks the right length? Catches a balanced stream that alternates,
// which monobit alone calls perfect. (NIST SP 800-22)
export function runs(bits) {
  const n = bits.length;
  const pi = bits.reduce((a, b) => a + b, 0) / n;
  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(n)) {
    return { p: 0, detail: "failed monobit precondition" };
  }
  let v = 1;
  for (let i = 1; i < n; i++) if (bits[i] !== bits[i - 1]) v++;
  const num = Math.abs(v - 2 * n * pi * (1 - pi));
  const den = 2 * Math.sqrt(2 * n) * pi * (1 - pi);
  return { p: erfc(num / den / Math.SQRT2), detail: `${v} runs` };
}

export const CHI2_MIN_BYTES = 1280; // 5 expected per bin over 256 bins

// Byte distribution, p via the Wilson-Hilferty normal approximation (a few
// parts in a thousand at df=255, far finer than any decision made on it).
//
// Reported as `tail: "both"` and it matters: a distribution that is too flat is
// as much a tell as one that is lumpy. A plain counter emits every byte value
// exactly once, scores X2 near zero, and without the upper bound it is waved
// through as the most uniform stream ever measured.
export function chi2Bytes(bits) {
  const n = Math.floor(bits.length / 8);
  if (n < CHI2_MIN_BYTES) {
    return { p: NaN, tail: "both", detail: `only ${n} bytes, need ${CHI2_MIN_BYTES}` };
  }
  const counts = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    counts[b]++;
  }
  const exp = n / 256;
  const x2 = counts.reduce((a, c) => a + ((c - exp) * (c - exp)) / exp, 0);
  const df = 255;
  const z = (Math.cbrt(x2 / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return { p: erfc(z / Math.SQRT2) / 2, tail: "both", detail: `X2=${x2.toFixed(0)} df=${df}, ${n} bytes` };
}

export const LAGS = 8;

// Correlation at lag 1..8. A source with a periodic artefact shows up here as a
// spike at its period while the other three see nothing, this is the test that
// caught both the duplicate frames and the counter control.
//
// The reported p is Bonferroni-corrected across the eight lags. Taking the
// smallest of eight p-values and reporting it raw tests eight hypotheses and
// quotes the luckiest, so a clean stream trips it about 8% of the time rather
// than the 1% the threshold claims. On a live badge that is a red light several
// times an hour on data that is fine, which would teach the visitor exactly the
// wrong lesson about what a failing test means.
export function serial(bits) {
  let worst = { lag: 0, p: 1 };
  const detail = [];
  for (let lag = 1; lag <= LAGS; lag++) {
    const n = bits.length - lag;
    let agree = 0;
    for (let i = 0; i < n; i++) if (bits[i] === bits[i + lag]) agree++;
    const s = Math.abs(agree * 2 - n) / Math.sqrt(n);
    const p = erfc(s / Math.SQRT2);
    detail.push(`${lag}:${p.toFixed(3)}`);
    if (p < worst.p) worst = { lag, p };
  }
  return {
    p: Math.min(1, worst.p * LAGS),
    detail: `worst lag ${worst.lag} (x${LAGS} corrected), ${detail.join(" ")}`,
  };
}

export const TESTS = { monobit, runs, "chi2/byte": chi2Bytes, serial };

// A test is failed at p < 0.01, or outside [0.005, 0.995] when both tails count.
// NaN is "not enough data yet", which is not a pass and not a failure.
export function verdict({ p, tail }) {
  if (Number.isNaN(p)) return "waiting";
  if (tail === "both") return p < 0.005 || p > 0.995 ? "fail" : "pass";
  return p < 0.01 ? "fail" : "pass";
}

// The floor below which even monobit is not worth reporting.
export const MIN_BITS = 500;

export function runAll(bits) {
  return Object.entries(TESTS).map(([name, fn]) => {
    const r = fn(bits);
    return { name, ...r, verdict: verdict(r) };
  });
}

// The controls. A suite that cannot separate these two says nothing about
// lightning either, so they ship with the page rather than living only in a
// test file: the rigged stream is also what plan §3 shows the visitor.
// `rand` is injectable so the offline check can seed it: a control that is
// random each run makes the check itself flaky at exactly the rate the
// thresholds allow, and a test suite that fails 1% of the time teaches people to
// ignore it. The live page passes nothing and gets Math.random.
export function controlGood(n = 40000, rand = Math.random) {
  const bits = [];
  for (let i = 0; i < n; i++) bits.push(rand() < 0.5 ? 0 : 1);
  return bits;
}

/** mulberry32, a seeded PRNG, only so the controls are reproducible. */
export function seeded(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function controlRigged(n = 40000) {
  const bits = [];
  for (let i = 0; bits.length < n; i++) {
    for (let j = 7; j >= 0; j--) bits.push((i >> j) & 1);
  }
  return bits.slice(0, n);
}
