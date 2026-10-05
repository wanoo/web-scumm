"""Stems for the music director (web-scumm 3.5): the arrangement rendered channel by channel, summed into groups.

Every stem comes from the same render, so all have the same length and start: played from the same instant they
are sample-locked, and their sum is the mix. One constant gain, the same for every stem, brings the sum to the
mix's loudness (never a per-stem normalisation: the balance between stems is the arrangement's). Writes
<out>/<group>.mp3 and <out>/score.json, the `audio.scores` entry to paste (stems, bpm, beats per bar).
"""
import json, os, re, shutil, subprocess
import numpy as np
from . import render
from .arrange import CHANNELS
from .qa import load

# Channel roles → stem groups, when the spec has no "stems" of its own.
DEFAULT_GROUPS = {
    'melody': ['lead', 'echo'],
    'harmony': ['double', 'harmony', 'counter', 'accent', 'arp'],
    'bass': ['bass'],
    'drums': ['drums', 'noise'],
}


def groups_of(spec):
    """{group: [channel, ...]} from spec["stems"], else from the channels' roles."""
    if spec.get('stems'):
        g = {k: [c for c in v if c in CHANNELS] for k, v in spec['stems'].items()}
    else:
        chans = spec.get('channels', {})
        g = {k: [c for c in CHANNELS if chans.get(c, {}).get('role') in roles] for k, roles in DEFAULT_GROUPS.items()}
        if spec.get('drums'):
            dac = spec['drums'].get('dac'); noise = spec['drums'].get('noise')
            for k in g: g[k] = [c for c in g[k] if c not in (dac, noise)]
            g['drums'] = [c for c in (dac, noise) if c]
    taken = [c for v in g.values() for c in v]
    dup = sorted({c for c in taken if taken.count(c) > 1})
    if dup:
        raise RuntimeError(f'a channel in two stems: {", ".join(dup)}')
    return {k: v for k, v in g.items() if v}


def loudness(wav):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
    i = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    p = re.findall(r'Peak:\s+(-?[\d.]+|-inf) dBFS', r.stderr)
    return float(i[-1]), (float(p[-1]) if p and p[-1] != '-inf' else -120.0)


def write_wav(path, x, sr):
    import wave
    y = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(sr); w.writeframes(y.tobytes())


def run(spec_path, fur, out, lufs=-14, true_peak=-1.0, bitrate='128k'):
    spec = json.load(open(spec_path))
    groups = groups_of(spec)
    work = os.path.join(out, '.render')
    files = render.render_stems(fur, work)
    if len(files) < len(CHANNELS):
        raise RuntimeError(f'Furnace rendered {len(files)} channels, expected {len(CHANNELS)}')
    chans = {}
    sr = None
    for c, f in zip(CHANNELS, files):
        x, sr = load_stereo(f)
        chans[c] = x
    n = max(len(x) for x in chans.values())
    pad = lambda x: np.pad(x, ((0, n - len(x)), (0, 0)))
    mixes = {g: sum(pad(chans[c]) for c in cs) for g, cs in groups.items()}
    total = sum(mixes.values())
    tot_wav = os.path.join(work, 'sum.wav'); write_wav(tot_wav, total, sr)
    i, peak = loudness(tot_wav)
    gain_db = min(lufs - i, true_peak - peak)
    g = 10 ** (gain_db / 20)
    os.makedirs(out, exist_ok=True)
    stems = {}
    rel = os.path.basename(os.path.normpath(out))
    for name, x in mixes.items():
        wav = os.path.join(work, name + '.wav'); write_wav(wav, x * g, sr)
        mp3 = os.path.join(out, name + '.mp3')
        render.ffmpeg('-i', wav, '-ar', str(sr), '-c:a', 'libmp3lame', '-b:a', bitrate, '-metadata', f'title={spec.get("title", "")} ({name})', mp3)
        stems[name] = f'{rel}/{name}.mp3'
    beats = spec.get('beats_per_bar', 4)
    bars = spec.get('bars', 0) + spec.get('extra_bars', 0)
    duration = n / sr
    bpm = round(bars * beats * 60 / duration, 3) if bars else spec.get('bpm')
    score = {'stems': stems, 'bpm': bpm, 'beatsPerBar': beats}
    json.dump(score, open(os.path.join(out, 'score.json'), 'w'), indent=1)
    shutil.rmtree(work, ignore_errors=True)
    print(f'stems: {", ".join(f"{k} ({"+".join(v)})" for k, v in groups.items())}')
    print(f'  {duration:.3f} s at {sr} Hz, {bpm} BPM, {beats}/bar; gain {gain_db:+.2f} dB on every stem (sum {i:.1f} LUFS, peak {peak:.1f} dBFS)')
    print(f'  → {out}/*.mp3 and score.json (paste it under audio.scores, by the id of the single mix)')
    return score


def load_stereo(f):
    """A rendered channel as float stereo frames, with its rate."""
    import wave
    with wave.open(f) as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    dt = {2: '<i2', 4: '<i4'}[sw]
    x = np.frombuffer(raw, dtype=dt).astype(np.float64) / (2 ** (8 * sw - 1))
    x = x.reshape(-1, ch)
    if ch == 1:
        x = np.repeat(x, 2, axis=1)
    return x, sr
