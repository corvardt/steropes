// The entropy pool: a ring of raw bytes from the sky, and the extractor that
// conditions them on the way out.
//
// The pool holds RAW bytes deliberately. Conditioning is applied when bytes are
// drawn, not when they are stored, so the page can show both streams side by
// side — which plan §2 calls the content, and it is.
//
// Worth being straight about what conditioning is for here. The measured stream
// already passes all four tests unconditioned: deduplicated lat/lon scores
// chi2 X2=253 against df=255, where the Math.random control scores 253. So the
// extractor is not rescuing a broken source. It is a safety net for the day the
// network changes behaviour, and it is the standard thing to do. Saying it
// rescues the stream would be a better story and a false one.

export const CAPACITY = 4096; // 4KB, per plan §2

/**
 * Fixed-size ring. When it is full the oldest bytes are overwritten: a pool that
 * stops accepting when full would sit on stale entropy while fresh strikes went
 * to waste.
 */
export function createPool(capacity = CAPACITY) {
  const buf = new Uint8Array(capacity);
  let head = 0; // next write
  let count = 0;

  return {
    push(bytes) {
      for (const b of bytes) {
        buf[head] = b & 0xff;
        head = (head + 1) % capacity;
        if (count < capacity) count++;
      }
    },

    get available() {
      return count;
    },

    get bitsAvailable() {
      return count * 8;
    },

    get capacity() {
      return capacity;
    },

    /** Oldest `n` bytes, consumed. Null when there are not enough yet. */
    take(n) {
      if (n > count) return null;
      const out = new Uint8Array(n);
      const start = (head - count + capacity * 2) % capacity;
      for (let i = 0; i < n; i++) out[i] = buf[(start + i) % capacity];
      count -= n;
      return out;
    },

    /** Everything currently held, without consuming. For the live tests. */
    peek() {
      const out = new Uint8Array(count);
      const start = (head - count + capacity * 2) % capacity;
      for (let i = 0; i < count; i++) out[i] = buf[(start + i) % capacity];
      return out;
    },
  };
}

export const BLOCK_BYTES = 64; // 512 bits in, 256 out

/**
 * SHA-256 block extraction, the standard construction. 64 bytes in, 32 out.
 *
 * Web Crypto rather than a bundled hash — it is native, it is audited, and it is
 * one line. Async because subtle.digest is.
 *
 * ponytail: von Neumann debiasing skipped. It yields ~25% against this
 * extractor's 50%, and at a measured 1.6 usable strikes/s the yield is the
 * binding constraint. Add it beside this one only if the page wants to show the
 * classical method for its own sake.
 */
export async function condition(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** Bytes to a flat bit array, MSB first — the shape every test in tests.js takes. */
export function toBits(bytes) {
  const bits = new Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < 8; j++) bits[i * 8 + j] = (bytes[i] >> (7 - j)) & 1;
  }
  return bits;
}
