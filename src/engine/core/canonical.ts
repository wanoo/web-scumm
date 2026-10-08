// The canonical text of a value (4.1.12 "Language", ADR 0013): one string per value, the same in Node, Chromium,
// WebKit and Firefox, so that a hash of it (the game's fingerprint, the proof cache's key) means the same thing
// everywhere. JSON, with five rules on top: strings and keys in Unicode NFC; keys sorted by UTF-16 code unit; `-0`
// written `0`; an integer beyond Number.MAX_SAFE_INTEGER and a bigint written as a decimal string; and anything JSON
// would write lossily or silently (NaN, the infinities, a function, a symbol, a Date, a Map, a class instance, a
// cycle, two keys equal once composed) refused with its path. tests/canonical-json.test.ts holds fifty-two edge values;
// scripts/e2e-canonical.mjs compares them in three browsers.

// A half of a surrogate pair standing alone. Firefox's `normalize` replaces one with U+FFFD where Node, Chromium and
// WebKit keep it (measured 8 Oct 2026, docs/dev/baselines/4.1.16-start.md): each well-formed stretch is normalized
// alone and a lone half is kept as it is, which is what the three others do (a lone half composes with nothing).
// Scanned by code unit: no lookbehind, which Safari before 16.4 cannot parse (this file is in the player's chunks).
const ANY_HALF = /[\uD800-\uDFFF]/;

/** NFC, the same in every runtime (lone surrogate halves kept). */
function nfc(s: string): string {
  if (!ANY_HALF.test(s)) return s.normalize('NFC');
  let out = '';
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        i++; // a pair: one character
        continue;
      }
    } else if (c < 0xdc00 || c > 0xdfff) continue;
    out += s.slice(from, i).normalize('NFC') + s[i];
    from = i + 1;
  }
  return out + s.slice(from).normalize('NFC');
}

/**
 * The canonical JSON text of plain data (objects, arrays, strings, numbers, booleans, null, bigints): NFC strings,
 * sorted keys, no `-0`, big integers as decimal strings; throws on anything else.
 * @public
 */
export function canonicalJson(v: unknown): string {
  const seen = new Set<object>();
  const fail = (path: string, what: string): never => {
    throw new Error(`canonicalJson: ${what} at ${path || 'the top'}`);
  };
  const walk = (x: unknown, path: string): string => {
    switch (typeof x) {
      case 'string':
        return JSON.stringify(nfc(x));
      case 'boolean':
        return x ? 'true' : 'false';
      case 'bigint':
        return `"${x.toString()}"`;
      case 'number':
        if (!Number.isFinite(x)) return fail(path, `${x} is not a number JSON can carry`);
        // Every double beyond 2^53 is an integer: exact as a decimal string, never in exponent form.
        if (Math.abs(x) > Number.MAX_SAFE_INTEGER) return `"${BigInt(x).toString()}"`;
        return Object.is(x, -0) ? '0' : JSON.stringify(x);
      case 'undefined':
        return fail(path, 'undefined');
      case 'object': {
        if (x === null) return 'null';
        if (seen.has(x)) return fail(path, 'a cycle');
        seen.add(x);
        let out: string;
        if (Array.isArray(x)) {
          const items: string[] = [];
          // A hole or an undefined item is null, as JSON writes it (an array keeps its length).
          for (let i = 0; i < x.length; i++) items.push(x[i] === undefined ? 'null' : walk(x[i], `${path}[${i}]`));
          out = `[${items.join(',')}]`;
        } else {
          const proto = Object.getPrototypeOf(x);
          if (proto !== Object.prototype && proto !== null)
            fail(path, `a ${(x as object).constructor?.name ?? 'non-plain'} object`);
          const keys = new Map<string, string>();
          for (const k of Object.keys(x)) {
            const value = (x as Record<string, unknown>)[k];
            if (value === undefined) continue;
            const nk = nfc(k);
            if (keys.has(nk)) fail(path, `two keys equal once composed ("${nk}")`);
            keys.set(nk, k);
          }
          // Default sort: UTF-16 code units, as RFC 8785 sorts.
          out = `{${[...keys.keys()]
            .sort()
            .map(
              (nk) => `${JSON.stringify(nk)}:${walk((x as Record<string, unknown>)[keys.get(nk)!], `${path}.${nk}`)}`,
            )
            .join(',')}}`;
        }
        seen.delete(x);
        return out;
      }
      default:
        return fail(path, `a ${typeof x}`);
    }
  };
  return walk(v, '');
}
