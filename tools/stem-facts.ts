// What a stem file is, measured with ffprobe (ffmpeg is a prerequisite, `npm run doctor`): its rate, its channels and
// its exact length in samples (src/engine/tools/stems.ts checks them).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { StemFacts } from '../src/engine/tools/stems';

/** Whether ffprobe runs here (`npm run doctor` checks ffmpeg). */
export const hasFfprobe = () => spawnSync('ffprobe', ['-version']).status === 0;

export function stemFacts(path: string): StemFacts | null {
  if (!existsSync(path)) return null;
  const p = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels,duration_ts,time_base', '-of', 'json', path], { encoding: 'utf8' });
  if (p.status !== 0) return null;
  const s = (JSON.parse(p.stdout) as { streams?: { sample_rate: string; channels: number; duration_ts?: number; time_base: string }[] }).streams?.[0];
  if (!s?.duration_ts) return null;
  const [num, den] = s.time_base.split('/').map(Number);
  const rate = Number(s.sample_rate);
  return { rate, channels: s.channels, samples: Math.round((s.duration_ts * num * rate) / den) };
}
