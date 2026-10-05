// The stems of a score, as files (3.6): the director starts them on the same sample and loops them over the same
// window, which holds only if they have the same rate, the same channels and the same number of samples, and if the
// loop ends inside them. `validate` checks the declaration (core/score.ts's grid); this checks the files, from what
// ffprobe measures (tools/stem-facts.ts), in `npm run validate -- --release`. Also checks the declared `pcmBytes`
// (what a device of unknown memory decides on, dom/director.ts) against the files.
import type { Id, ScoreDef } from '../core/types';
import { must } from '../core/must';

export interface StemFacts {
  rate: number;
  channels: number;
  samples: number;
}

/** The decoded weight of these stems at 48 kHz, float32 (what `npm run audio -- stems` writes as `pcmBytes`). */
export const pcmOf = (facts: StemFacts[]) =>
  facts.reduce((n, f) => n + Math.round((f.samples / f.rate) * 48000) * f.channels * 4, 0);

/**
 * What is wrong with a score's files. `facts`: per stem id, what was measured (null: the file is missing or unreadable).
 * The declared `pcmBytes` may be off by 1% (an encoder pads a frame).
 */
export function stemErrors(id: Id, score: ScoreDef, facts: Record<Id, StemFacts | null>): string[] {
  const w = `audio.scores.${id}`;
  const errors: string[] = [];
  const ok = Object.entries(score.stems).flatMap(([s, f]) => {
    const x = facts[s];
    if (!x) {
      errors.push(`${w}.stems.${s} › "${f}" is missing or not readable audio`);
      return [];
    }
    return [[s, x] as const];
  });
  if (!ok.length) return errors;
  const [s0, f0] = must(ok[0], 'first stem');
  for (const [s, f] of ok.slice(1)) {
    if (f.rate !== f0.rate)
      errors.push(`${w}.stems.${s} › ${f.rate} Hz, "${s0}" is ${f0.rate} Hz: every stem needs the same rate`);
    if (f.channels !== f0.channels)
      errors.push(`${w}.stems.${s} › ${f.channels} channel(s), "${s0}" has ${f0.channels}: every stem needs the same`);
    if (f.samples !== f0.samples)
      errors.push(
        `${w}.stems.${s} › ${f.samples} samples, "${s0}" has ${f0.samples}: the stems drift apart (render them together: npm run audio -- stems)`,
      );
  }
  const seconds = Math.min(...ok.map(([, f]) => f.samples / f.rate));
  const bars = (seconds * score.bpm) / 60 / (score.beatsPerBar ?? 4);
  if (score.loop && score.loop[1] > bars + 0.01)
    errors.push(
      `${w}.loop › ends at bar ${score.loop[1]}, the files last ${bars.toFixed(2)} bars (${seconds.toFixed(3)} s at ${score.bpm} BPM)`,
    );
  if (score.pcmBytes !== undefined && ok.length === Object.keys(score.stems).length) {
    const real = pcmOf(ok.map(([, f]) => f));
    if (Math.abs(score.pcmBytes - real) > real * 0.01)
      errors.push(`${w}.pcmBytes › ${score.pcmBytes} declared, the files decode to ${real} at 48 kHz`);
  }
  return errors;
}
