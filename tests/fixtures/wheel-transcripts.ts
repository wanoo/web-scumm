// The code wheel's transcripts in every runtime (4.1.17, plan §8.4): a wheel's hash and the verifier's verdicts on a
// few transcripts, written out here and checked in Node (tests/speedrun-wheel-proof.test.ts) and in Chromium, WebKit
// and Firefox (`npm run e2e:canonical`). A runtime that hashes or judges differently fails, with the case named.
import {
  type CodeWheelParams,
  generateWheel,
  verifyWheelTranscript,
  wheelHash,
} from '../../src/engine/core/remix/code-wheel';

const P: CodeWheelParams = {
  actors: ['pixel', 'biscuit', 'grandma', 'lou', 'seller'].map((id) => ({ id, label: id })),
  symbols: ['key', 'token', 'oil', 'matches', 'cable'].map((id) => ({ id, label: id })),
  answers: ['STREET', 'MARKET', 'ALLEY', 'YARD', 'CELLAR'],
  mode: 'parody',
  tries: 3,
};
const at = (seed: string) => {
  const w = generateWheel(P, seed);
  return { w, hash: wheelHash(w, P.answers), right: P.answers.indexOf(w.answer) };
};
const verdict = (seed: string, answers: (r: number) => number[], end: 'decided' | 'skipped') => {
  const { hash, right } = at(seed);
  const out = verifyWheelTranscript({ ...P, seed }, { v: 1, wheel: hash, answers: answers(right), end });
  return 'error' in out ? `error: ${out.error}` : out.result;
};
const other = (r: number) => (r + 1) % 5;

export const WHEEL_CASES: { name: string; make: () => string; expected: string }[] = [
  { name: 'wheel hash, story', make: () => at('story').hash, expected: '3a4f080ad36f560c' },
  { name: 'wheel hash, WS-0000-02DZ', make: () => at('WS-0000-02DZ').hash, expected: '867fd8bab0824424' },
  { name: 'won', make: () => verdict('WS-0000-02DZ', (r) => [other(r), r], 'decided'), expected: 'won' },
  {
    name: 'passed',
    make: () => verdict('story', (r) => [other(r), other(r), other(r)], 'decided'),
    expected: 'passed',
  },
  { name: 'skipped', make: () => verdict('story', (r) => [other(r)], 'skipped'), expected: 'skipped' },
  {
    name: 'an answer after the decision',
    make: () => verdict('story', (r) => [r, other(r)], 'decided'),
    expected: 'error: an answer after the one that decided',
  },
];
