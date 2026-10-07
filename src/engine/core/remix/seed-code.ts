// The code a player copies and types (4.1.15 "Remix", ADR 0018): `WS-XXXX-XXXX`, seven Crockford base32 symbols (35
// bits) and a check symbol (the value modulo 37, Crockford's check alphabet). Typing is forgiving the way Crockford's
// encoding is: case ignored, `I` and `L` read as `1`, `O` as `0`, spaces and dashes skipped; a wrong check symbol is
// an explicit error, never a silent fallback to another world. A code carries no player id, no date, nothing personal
// (docs/dev/threat-models/remix-seed.md): it is a world's name, not a secret.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECK = `${ALPHABET}*~$=U`;
const DATA = 7;
/** The seed of the author's world: no variation, every dimension at its story value. @public */
export const STORY_SEED = 'story';

/** A seed refused: malformed, a wrong check symbol, an unknown algorithm version. @public */
export class RemixSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemixSeedError';
  }
}

/** The 35-bit value of a code's seven data symbols. */
function dataValue(data: string): number {
  let v = 0;
  for (const ch of data) v = v * 32 + ALPHABET.indexOf(ch);
  return v;
}

/** A 35-bit value (0 ≤ v < 2^35) as its `WS-XXXX-XXXX` code. @public */
export function encodeSeedCode(v: number): string {
  if (!Number.isInteger(v) || v < 0 || v >= 2 ** 35) throw new RemixSeedError(`seed value out of range: ${v}`);
  let data = '';
  let x = v;
  for (let i = 0; i < DATA; i++) {
    data = ALPHABET[x % 32] + data;
    x = (x - (x % 32)) / 32;
  }
  const s = data + CHECK[v % 37];
  return `WS-${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * The canonical form of a typed code (`ws-abcd-efgh`, `WSABCDEFGH`, with `I`/`L`/`O` read as digits), or a
 * `RemixSeedError` that says what is wrong. `story` is the author's world.
 * @public
 */
export function normalizeSeed(input: string): string {
  const raw = String(input).trim();
  if (raw.toLowerCase() === STORY_SEED) return STORY_SEED;
  let s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith('WS')) s = s.slice(2);
  s = s.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== DATA + 1) throw new RemixSeedError(`a seed code has ${DATA + 1} symbols after "WS-": "${raw}"`);
  const data = s.slice(0, DATA);
  for (const ch of data)
    if (!ALPHABET.includes(ch)) throw new RemixSeedError(`"${ch}" is not a symbol of a seed code ("${raw}")`);
  const v = dataValue(data);
  if (s[DATA] !== CHECK[v % 37]) throw new RemixSeedError(`the check symbol of "${raw}" is wrong: a typo?`);
  return encodeSeedCode(v);
}

/** Whether a string is a well-formed seed (a code with its check symbol, or `story`). @public */
export function isSeed(input: string): boolean {
  try {
    normalizeSeed(input);
    return true;
  } catch {
    return false;
  }
}

/** A fresh code from WebCrypto (the Remix button). No WebCrypto: an error, never a guessable draw. @public */
export function newSeedCode(): string {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new RemixSeedError('no WebCrypto to draw a fresh seed: type a code instead');
  const w = new Uint32Array(2);
  c.getRandomValues(w);
  // 32 bits from the first word, 3 from the second.
  return encodeSeedCode(w[0]! * 8 + (w[1]! % 8));
}
