// A score's stem files (3.6, src/engine/tools/stems.ts): the same rate, channels and samples, the loop inside them,
// the declared decoded weight right. The rules on measured facts, then on files ffmpeg makes inconsistent on purpose.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pcmOf, stemErrors } from '@engine/tools/stems';
import type { ScoreDef } from '@engine/core/types';
import { stemFacts } from '../tools/stem-facts';

const score = (extra: Partial<ScoreDef> = {}): ScoreDef => ({ stems: { a: 'x/a.mp3', b: 'x/b.mp3' }, bpm: 120, ...extra });
const f = (samples = 44100 * 8, rate = 44100, channels = 2) => ({ rate, channels, samples });

describe('stem files', () => {
  it('matching stems pass; each mismatch is named', () => {
    expect(stemErrors('t', score({ loop: [0, 4], pcmBytes: pcmOf([f(), f()]) }), { a: f(), b: f() })).toEqual([]);
    expect(stemErrors('t', score(), { a: f(), b: f(44100 * 8, 48000) })[0]).toContain('48000 Hz, "a" is 44100 Hz');
    expect(stemErrors('t', score(), { a: f(), b: f(44100 * 8, 44100, 1) })[0]).toContain('1 channel(s), "a" has 2');
    expect(stemErrors('t', score(), { a: f(), b: f(44100 * 8 + 1152) })[0]).toContain('the stems drift apart');
    expect(stemErrors('t', score(), { a: f(), b: null })).toEqual(['audio.scores.t.stems.b › "x/b.mp3" is missing or not readable audio']);
  });
  it('the loop must end inside the files, and pcmBytes must be what they decode to', () => {
    // 8 s at 120 BPM in 4/4: 4 bars.
    expect(stemErrors('t', score({ loop: [1, 5] }), { a: f(), b: f() })).toEqual([expect.stringContaining('ends at bar 5, the files last 4.00 bars')]);
    expect(stemErrors('t', score({ pcmBytes: 1000 }), { a: f(), b: f() })).toEqual([expect.stringContaining('the files decode to 6144000')]);
    expect(stemErrors('t', score({ pcmBytes: 6144000 + 50000 }), { a: f(), b: f() })).toEqual([]); // within 1%
  });
  it('ffprobe measures files made inconsistent on purpose', () => {
    if (spawnSync('ffmpeg', ['-version']).status !== 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'stems-'));
    const make = (name: string, args: string[]) => { spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', ...args, join(dir, name)]); return stemFacts(join(dir, name)); };
    try {
      const a = make('a.wav', ['-ar', '44100', '-ac', '2']), b = make('b.wav', ['-ar', '44100', '-ac', '2']);
      const short = make('short.wav', ['-ar', '44100', '-ac', '2', '-t', '1.5']), mono = make('mono.wav', ['-ar', '44100', '-ac', '1']), fast = make('fast.wav', ['-ar', '48000', '-ac', '2']);
      expect(a).toEqual({ rate: 44100, channels: 2, samples: 88200 });
      expect(stemErrors('t', score(), { a, b })).toEqual([]);
      expect(stemErrors('t', score(), { a, b: short })).toEqual([expect.stringContaining('66150 samples, "a" has 88200')]);
      expect(stemErrors('t', score(), { a, b: mono })).toEqual([expect.stringContaining('1 channel(s)')]);
      expect(stemErrors('t', score(), { a, b: fast })).toEqual([expect.stringContaining('48000 Hz'), expect.stringContaining('samples')]);
      expect(stemFacts(join(dir, 'none.wav'))).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
