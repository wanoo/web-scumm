// Fifty edge values of `canonicalJson` (core/canonical.ts, 4.1.12, ADR 0013) with the text each must give, or `null`
// when it must be refused. Shared by tests/canonical-json.test.ts (Node) and scripts/e2e-canonical.mjs (Chromium,
// WebKit, Firefox): the same module, bundled, must write the same 50 texts everywhere. Each value is made by a function
// so that a cycle, a `Map` or a `-0` reaches the serialiser as itself.

export interface CanonicalCase {
  name: string;
  make: () => unknown;
  /** The canonical text, or null: refused (it throws). */
  expected: string | null;
}

const cyclic = () => {
  const a: Record<string, unknown> = { x: 1 };
  a.self = a;
  return a;
};
const nullProto = () => Object.assign(Object.create(null) as Record<string, unknown>, { b: 2, a: 1 });
class Instance {
  a = 1;
}
const sparse = () => {
  const a: unknown[] = [];
  a[1] = 1;
  return a;
};

export const CANONICAL_CASES: CanonicalCase[] = [
  { name: 'null', make: () => null, expected: 'null' },
  { name: 'true', make: () => true, expected: 'true' },
  { name: 'zero', make: () => 0, expected: '0' },
  { name: 'negative zero', make: () => -0, expected: '0' },
  { name: 'one', make: () => 1, expected: '1' },
  { name: 'a half and one', make: () => 1.5, expected: '1.5' },
  { name: '0.1 + 0.2', make: () => 0.1 + 0.2, expected: '0.30000000000000004' },
  { name: 'the smallest step above one', make: () => 1.0000000000000002, expected: '1.0000000000000002' },
  { name: '1e-7', make: () => 1e-7, expected: '1e-7' },
  { name: 'the smallest subnormal', make: () => 5e-324, expected: '5e-324' },
  { name: 'MAX_SAFE_INTEGER', make: () => Number.MAX_SAFE_INTEGER, expected: '9007199254740991' },
  { name: '-MAX_SAFE_INTEGER', make: () => -Number.MAX_SAFE_INTEGER, expected: '-9007199254740991' },
  { name: '2^53', make: () => 2 ** 53, expected: '"9007199254740992"' },
  { name: '-(2^53)', make: () => -(2 ** 53), expected: '"-9007199254740992"' },
  { name: '1e21', make: () => 1e21, expected: '"1000000000000000000000"' },
  { name: '-1e21', make: () => -1e21, expected: '"-1000000000000000000000"' },
  {
    name: 'Number.MAX_VALUE',
    make: () => Number.MAX_VALUE,
    expected: `"179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368"`,
  },
  { name: '2n ** 64n', make: () => 2n ** 64n, expected: '"18446744073709551616"' },
  { name: 'a negative bigint', make: () => -5n, expected: '"-5"' },
  { name: 'NaN', make: () => Number.NaN, expected: null },
  { name: 'Infinity', make: () => Number.POSITIVE_INFINITY, expected: null },
  { name: '-Infinity', make: () => Number.NEGATIVE_INFINITY, expected: null },
  { name: 'the empty string', make: () => '', expected: '""' },
  { name: 'é composed (NFC)', make: () => 'é', expected: '"é"' },
  { name: 'é decomposed (NFD) becomes composed', make: () => 'é', expected: '"é"' },
  { name: 'the angstrom sign becomes Å', make: () => 'Å', expected: '"Å"' },
  { name: 'Hangul jamo compose', make: () => '가', expected: '"가"' },
  { name: 'control characters escaped', make: () => '\u0000\n\t\u001f', expected: '"\\u0000\\n\\t\\u001f"' },
  { name: 'line and paragraph separators kept', make: () => '  ', expected: '"  "' },
  { name: 'a lone surrogate escaped', make: () => '\ud800', expected: '"\\ud800"' },
  // 4.1.16: Firefox's normalize turned a lone half into U+FFFD (e2e:canonical's first run); NFC still composes around it.
  {
    name: 'a lone surrogate between letters to compose',
    make: () => 'e\u0301\udc00e\u0301',
    expected: '"\u00e9\\udc00\u00e9"',
  },
  { name: 'a lone surrogate as a key', make: () => ({ '\ud83d': 1 }), expected: '{"\\ud83d":1}' },
  { name: 'an emoji kept', make: () => '😀', expected: '"😀"' },
  { name: 'quote and backslash', make: () => '"\\', expected: '"\\"\\\\"' },
  { name: 'the empty object', make: () => ({}), expected: '{}' },
  { name: 'keys sorted', make: () => ({ b: 1, a: 2 }), expected: '{"a":2,"b":1}' },
  {
    name: 'unicode keys by UTF-16 code unit',
    make: () => ({ é: 1, e: 2, z: 3, É: 4 }),
    expected: '{"e":2,"z":3,"É":4,"é":1}',
  },
  {
    name: 'an astral key sorts before U+FFFF',
    make: () => ({ '￿': 1, '😀': 2 }),
    expected: '{"😀":2,"￿":1}',
  },
  {
    name: 'integer-like keys sorted as text',
    make: () => ({ 10: 1, 9: 2, a: 3 }),
    expected: '{"10":1,"9":2,"a":3}',
  },
  { name: 'a decomposed key composed', make: () => ({ é: 1 }), expected: '{"é":1}' },
  { name: 'two keys equal once composed', make: () => ({ é: 1, é: 2 }), expected: null },
  { name: 'undefined dropped from an object', make: () => ({ a: undefined, b: 1 }), expected: '{"b":1}' },
  { name: 'undefined in an array is null', make: () => [undefined, 1], expected: '[null,1]' },
  { name: 'a hole in an array is null', make: sparse, expected: '[null,1]' },
  {
    name: 'nested, with a -0 inside',
    make: () => [{ b: [1, { d: 0, c: -0 }] }],
    expected: '[{"b":[1,{"c":0,"d":0}]}]',
  },
  { name: 'an object without prototype', make: nullProto, expected: '{"a":1,"b":2}' },
  { name: 'a cycle', make: cyclic, expected: null },
  { name: 'a function', make: () => ({ f: () => 1 }), expected: null },
  { name: 'a symbol', make: () => [Symbol('s')], expected: null },
  { name: 'a Date', make: () => new Date(0), expected: null },
  { name: 'a Map', make: () => new Map([['a', 1]]), expected: null },
  { name: 'a class instance', make: () => new Instance(), expected: null },
];
