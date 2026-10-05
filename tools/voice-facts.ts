// What a voice clip is, measured with ffmpeg (a prerequisite, `npm run doctor`): ffprobe for the codec, the sample
// rate and the duration; the ebur128 filter for the integrated loudness (LUFS) and the true peak (dBFS).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ClipFacts } from '../src/engine/tools/voices';

export function clipFacts(path: string): ClipFacts | null {
  if (!existsSync(path)) return null;
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate:format=duration', '-of', 'json', path], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  const j = JSON.parse(probe.stdout) as { streams?: { codec_name: string; sample_rate: string }[]; format?: { duration: string } };
  const loud = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '';
  const last = (re: RegExp) => Number(loud.match(re)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const lufs = last(/I:\s+(-?[\d.]+) LUFS/g), peak = last(/Peak:\s+(-?[\d.]+) dBFS/g);
  return { durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000), sampleRate: Number(j.streams?.[0]?.sample_rate ?? 0), codec: j.streams?.[0]?.codec_name ?? '?', ...(Number.isFinite(lufs) ? { lufs } : {}), ...(Number.isFinite(peak) ? { peak } : {}) };
}
