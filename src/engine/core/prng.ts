// The seeded random generator (4.1.14 "Time Attack", ADR 0016): xoshiro128** over 32-bit integers, `Math.imul` and
// unsigned shifts only, so Node, Chromium, WebKit and Firefox draw the same numbers from the same seed
// (tests/fixtures/prng-vectors.json holds the vectors a cross-runtime test compares). A seed is a string; it becomes the
// generator's four words through FNV-1a and SplitMix32. Each purpose draws from its own stream, derived from the seed
// and the stream's name, so a cosmetic draw never moves the logic's sequence: `logic` (what `engine.random` returns),
// `cosmetic`, `minigame:<id>`, `copy-protection` (4.1.15).

/** The generator's version: a run records it, a verifier refuses another one (bump it if a single draw changes). */
export const PRNG_VERSION = 1;

/** The streams a game draws from (a minigame's is `minigame:<id>`). */
export type StreamId = 'logic' | 'cosmetic' | 'copy-protection' | `minigame:${string}`;

/** FNV-1a of a string's UTF-16 code units, 32 bits. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** SplitMix32: spreads one 32-bit word into a sequence (seeding only). */
function splitmix32(a: number): () => number {
  let x = a >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** One stream of xoshiro128**: `nextU32` a 32-bit word, `next` a number in [0, 1) with 32 bits of precision. */
export class Prng {
  private s: [number, number, number, number];

  constructor(seed: string) {
    const sm = splitmix32(fnv1a(seed));
    this.s = [sm(), sm(), sm(), sm()];
    // The all-zero state is the one xoshiro cannot leave.
    if (!(this.s[0] | this.s[1] | this.s[2] | this.s[3])) this.s[0] = 1;
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** The four words of the state (a test, a resumed run). */
  state(): [number, number, number, number] {
    return [...this.s];
  }
  restore(s: readonly [number, number, number, number]): void {
    this.s = [s[0] >>> 0, s[1] >>> 0, s[2] >>> 0, s[3] >>> 0];
  }
}

/** The stream `streamId` of a seed: independent of every other stream of the same seed. */
export function derive(seed: string, streamId: StreamId): Prng {
  return new Prng(`${seed}\u0000${streamId}`);
}

/** A fresh seed: 128 bits from WebCrypto as 32 hex digits; without WebCrypto, an error (never a guessable draw). */
export function newSeed(): string {
  const words = new Uint32Array(4);
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('newSeed: no WebCrypto (crypto.getRandomValues) to draw a fresh seed');
  c.getRandomValues(words);
  return [...words].map((w) => w.toString(16).padStart(8, '0')).join('');
}
