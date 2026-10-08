// `canonicalJson` (core/canonical.ts, 4.1.12, ADR 0013): one text per value, whatever the runtime. Node here, on the
// fifty-two edge values of tests/fixtures/canonical-values.ts; scripts/e2e-canonical.mjs compares the same fifty-two in
// Chromium, WebKit and Firefox. The proof cache keys on it (tools/proof-cache.ts).
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@engine/core/canonical';
import { stableJson } from '../tools/proof-cache';
import { CANONICAL_CASES } from './fixtures/canonical-values';

describe('canonicalJson', () => {
  it('has fifty-two edge values, each named once (two lone-surrogate cases added in 4.1.16)', () => {
    expect(CANONICAL_CASES).toHaveLength(52);
    expect(new Set(CANONICAL_CASES.map((c) => c.name)).size).toBe(52);
  });

  for (const c of CANONICAL_CASES)
    it(`${c.name} → ${c.expected ?? 'refused'}`, () => {
      if (c.expected === null) expect(() => canonicalJson(c.make())).toThrow(/canonicalJson/);
      else expect(canonicalJson(c.make())).toBe(c.expected);
    });

  it('is valid JSON that reads back to the same text', () => {
    for (const c of CANONICAL_CASES) {
      if (c.expected === null) continue;
      expect(canonicalJson(JSON.parse(c.expected))).toBe(c.expected);
    }
  });

  it('does not depend on the order an object was built in', () => {
    const a = { z: [1, { y: 'é', x: null }], a: { c: 2n, b: -0 } };
    const b = { a: { b: 0, c: 2n }, z: [1, { x: null, y: 'é' }] };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('accepts the same object twice (a shared value is not a cycle)', () => {
    const shared = { k: 1 };
    expect(canonicalJson({ a: shared, b: [shared] })).toBe('{"a":{"k":1},"b":[{"k":1}]}');
  });

  it('refuses undefined at the top, and names what it refused', () => {
    expect(() => canonicalJson(undefined)).toThrow(/canonicalJson: undefined/);
    expect(() => canonicalJson({ a: [Number.NaN] })).toThrow(/a\[0\]/);
  });

  it('keys the proof cache: functions by their source, non-finite numbers by name, the rest canonical', () => {
    expect(stableJson({ b: 1, a: 'é' })).toBe('{"a":"é","b":1}');
    expect(stableJson({ f: (x: number) => x })).toMatch(/^\{"f":"fn:/);
    expect(stableJson({ max: Number.POSITIVE_INFINITY })).toBe('{"max":"num:Infinity"}');
  });
});
