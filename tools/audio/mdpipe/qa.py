"""Objective QA of a rendered module: per-channel level vs palette targets, clipping, brightness, pitch accuracy."""
import json, os, wave
import numpy as np
from .arrange import CHANNELS, Arranger, mono
from . import render


def load(f):
    w = wave.open(f); sr = w.getframerate(); n = w.getnframes()
    a = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, w.getnchannels()).astype(float) / 32768
    return a, sr


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)


def f0_ok(seg, sr, p):
    """True if pitch class p explains the spectrum better than its neighbours (octave-agnostic)."""
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 1 << 15)); fr = np.fft.rfftfreq(1 << 15, 1 / sr)
    def score(m):
        f = 440 * 2 ** ((m - 69) / 12)
        return sum(sp[np.argmin(abs(fr - f * h))] for h in range(1, 6))
    best = max(range(p - 13, p + 14), key=lambda m: score(m) - 0.3 * score(m + 12))
    return best % 12 == p % 12


def run(spec_path, fur, workdir):
    spec = json.load(open(spec_path))
    arr = Arranger(spec, os.path.dirname(os.path.abspath(spec_path)))
    pal = arr.palette['mix']
    stems = render.render_stems(fur, os.path.join(workdir, 'stems'))
    mixwav = os.path.join(workdir, 'qa_mix.wav')
    render.render_wav(fur, mixwav)
    sec_per_tick = 60 / (arr.bpm * arr.midi.ppq)
    rep = {'channels': {}, 'issues': [], 'mix': {}}
    for ci, ch in enumerate(CHANNELS):
        cfg = spec.get('channels', {}).get(ch, {})
        role = cfg.get('role') or ('drums' if ch == 'FM6' and spec.get('drums') else ('noise' if ch == 'NOISE' and spec.get('drums') else None))
        if ci >= len(stems):
            break
        a, sr = load(stems[ci])
        # stereo stems: take the louder side so hard-panned channels are measured fairly
        x = a[:, np.argmax([rms_db(a[:, k]) for k in range(a.shape[1])])]
        env = np.sqrt(np.convolve(x ** 2, np.ones(sr // 10) / (sr // 10), 'same'))
        active = env > 10 ** (-60 / 20)
        if active.sum() < sr * 0.2:
            rep['channels'][ch] = {'role': role, 'active_s': 0}
            continue
        lvl = rms_db(x[active])
        sp = np.abs(np.fft.rfft(x[active][: sr * 30])) ** 2; fr = np.fft.rfftfreq(min(active.sum(), sr * 30), 1 / sr)
        cen = float((sp * fr).sum() / sp.sum())
        info = {'role': role, 'active_s': round(active.sum() / sr, 1), 'rms_db': round(lvl, 1), 'centroid_hz': round(cen)}
        tgt = pal['targets'].get(role or '')
        if tgt:
            info['target'] = tgt['rms']
            if abs(lvl - tgt['rms']) > tgt['tol']:
                rep['issues'].append(f"{ch} ({role}) level {lvl:.1f} dB, target {tgt['rms']}±{tgt['tol']}: "
                                     f"{'lower' if lvl > tgt['rms'] else 'raise'} its vol / carrier TL")
        # pitch check on melodic parts
        if not ch.startswith('NOISE') and not (ch == 'FM6' and spec.get('drums')):
            ok = tot = 0
            for part in cfg.get('parts', []):
                if part.get('type') == 'arp':
                    continue
                rngs = arr.ranges(part)
                src = [n for n in arr.track_notes(part['track']) if any(a_ <= n.start < b_ for a_, b_ in rngs)]
                for s, e, p, v in mono(src, part.get('voice', 'high')):
                    if e - s < arr.midi.ppq // 2:
                        continue
                    t0 = s * sec_per_tick + part.get('delay_rows', 0) * arr.tpr * sec_per_tick + 0.04
                    seg = x[int(t0 * sr): int(min(e * sec_per_tick, t0 + 0.25) * sr)]
                    if len(seg) < 1000:
                        continue
                    tot += 1; ok += f0_ok(seg, sr, p + part.get('transpose', 0))
            if tot:
                info['pitch_match'] = f'{ok}/{tot}'
                if ok < 0.9 * tot:
                    rep['issues'].append(f'{ch}: only {ok}/{tot} sustained notes at the expected pitch class (check transpose / overlapping parts)')
        rep['channels'][ch] = info
    a, sr = load(mixwav)
    peak = float(np.abs(a).max())
    rep['mix'] = {'duration_s': round(len(a) / sr, 2), 'peak': round(peak, 3), 'rms_db': round(rms_db(a), 1),
                  'stereo_diff_db': round(rms_db(a[:, 0]) - rms_db(a[:, 1]), 1)}
    if peak > pal['max_peak']:
        rep['issues'].append(f'mix peak {peak:.3f} > {pal["max_peak"]}: lower chip volume or loud channels')
    rep['build_log'] = arr.log
    return rep


def report_text(rep):
    L = ['ch     role      active   rms dB  target  centroid  pitch']
    for ch, i in rep['channels'].items():
        if not i.get('active_s'):
            L.append(f'{ch:6} {str(i.get("role")):9} silent'); continue
        L.append(f"{ch:6} {str(i.get('role')):9} {i['active_s']:6}s {i['rms_db']:7} {str(i.get('target', '')):>7} "
                 f"{i['centroid_hz']:7}Hz  {i.get('pitch_match', '')}")
    m = rep['mix']
    L.append(f"mix: {m['duration_s']}s peak {m['peak']} rms {m['rms_db']} dB, L-R {m['stereo_diff_db']} dB")
    L.append('ISSUES:' if rep['issues'] else 'ISSUES: none')
    L += ['  - ' + x for x in rep['issues']]
    return '\n'.join(L)
