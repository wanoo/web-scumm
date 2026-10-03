"""Musical analysis of a MIDI file -> report the arranger (human or AI) reads before writing a spec."""
import json
from collections import Counter
from .midi import read_midi, note_name, GM_PROGRAMS, GM_DRUMS


def max_poly(notes):
    ev = sorted([(n.start, 1) for n in notes] + [(n.end, -1) for n in notes], key=lambda e: (e[0], e[1]))
    p = m = 0
    for _, d in ev:
        p += d; m = max(m, p)
    return m


def octave_pairs(notes):
    """Fraction of notes that have a simultaneous +/-12 partner in the same track."""
    starts = {}
    for n in notes:
        starts.setdefault(n.start, set()).add(n.pitch)
    paired = sum(1 for n in notes if (n.pitch + 12) in starts[n.start] or (n.pitch - 12) in starts[n.start])
    return paired / max(1, len(notes))


def onsets(notes):
    return [(n.start, n.pitch) for n in notes]


def doubling(a, b):
    """If track b copies track a in rhythm, return the dominant transposition, else None."""
    if not a or not b or abs(len(a) - len(b)) > max(2, len(a) // 10):
        return None
    sa = Counter(n.start for n in a); sb = Counter(n.start for n in b)
    if sum((sa & sb).values()) < 0.9 * max(len(a), len(b)):
        return None
    ta = sorted(onsets(a)); tb = sorted(onsets(b))
    tr = Counter(y[1] - x[1] for x, y in zip(ta, tb) if x[0] == y[0])
    if not tr:
        return None
    t, c = tr.most_common(1)[0]
    return t if c >= 0.85 * len(ta) else None


def grid_info(notes, ppq):
    c = Counter()
    for n in notes:
        for div in (8, 16, 32, 64):
            q = ppq * 4 // div
            if n.start % q == 0:
                c[div] += 1; break
        else:
            c['triplet/irregular'] += 1
    return dict(c)


def analyze(path):
    m = read_midi(path)
    bar = m.bar_ticks()
    nbars = -(-m.end_tick // bar)
    rep = {'file': str(path), 'ppq': m.ppq, 'tempos': m.tempos, 'timesigs': m.timesigs,
           'keysigs': m.keysigs, 'bars': nbars, 'duration_s': None, 'tracks': [], 'doublings': [],
           'warnings': []}
    # duration with tempo map
    t, last, bpm, sec = 0, 0, m.tempos[0][1], 0.0
    for tick, b in m.tempos[1:] + [(m.end_tick, None)]:
        sec += (tick - last) / m.ppq * 60 / bpm
        last = tick
        if b: bpm = b
    rep['duration_s'] = round(sec, 2)
    if len(m.tempos) > 1:
        rep['warnings'].append('Tempo changes present: the builder uses the first tempo; add speed/tempo effects by hand or split sections.')
    if len(set((n, d) for _, n, d in m.timesigs)) > 1:
        rep['warnings'].append('Time signature changes present: bar numbering assumes the first signature.')
    for tr in m.tracks:
        if not tr.notes:
            continue
        is_drum = all(n.channel == 9 for n in tr.notes)
        ps = [n.pitch for n in tr.notes]
        durs = Counter(round((n.end - n.start) / (m.ppq / 4)) / 4 for n in tr.notes)
        info = {
            'index': tr.index, 'name': tr.name, 'drums': is_drum,
            'programs': {ch: (GM_PROGRAMS[p] if not is_drum else 'drum kit') for ch, p in tr.programs.items()},
            'notes': len(tr.notes), 'range': f'{note_name(min(ps))}-{note_name(max(ps))}',
            'max_polyphony': max_poly(tr.notes), 'octave_paired_ratio': round(octave_pairs(tr.notes), 2),
            'first_bar': tr.notes[0].start // bar + 1, 'last_bar': (max(n.end for n in tr.notes) - 1) // bar + 1,
            'grid': grid_info(tr.notes, m.ppq), 'common_durations_beats': dict(durs.most_common(5)),
            'pitchbends': tr.pitchbends, 'cc': tr.cc,
            'velocity_range': [min(n.vel for n in tr.notes), max(n.vel for n in tr.notes)],
        }
        if is_drum:
            info['drum_usage'] = {f'{p} {GM_DRUMS.get(p, "?")}': c for p, c in Counter(ps).most_common()}
        rep['tracks'].append(info)
    tl = [t for t in m.tracks if t.notes]
    for i, a in enumerate(tl):
        for b in tl[i + 1:]:
            d = doubling(a.notes, b.notes)
            if d is not None:
                rep['doublings'].append({'a': a.index, 'b': b.index, 'transpose': d,
                                         'meaning': 'identical' if d == 0 else f'b = a {d:+d} semitones'})
    # activity map: per bar, which tracks play (for section detection)
    act = []
    for b in range(nbars):
        row = []
        for tr in tl:
            c = sum(1 for n in tr.notes if b * bar <= n.start < (b + 1) * bar)
            sus = any(n.start < b * bar < n.end for n in tr.notes)
            row.append('#' if c >= 4 else ('+' if c else ('~' if sus else '.')))
        act.append(''.join(row))
    rep['activity'] = {'legend': '# >=4 onsets, + 1-3 onsets, ~ sustained, . silent',
                       'columns': [t.index for t in tl], 'bars': act}
    return m, rep


def bar_dump(m, track_index, bars=None):
    """Readable per-bar note listing: 'pos16:Note/len16' (positions & lengths in 16ths)."""
    bar = m.bar_ticks(); s16 = m.ppq / 4
    tr = m.tracks[track_index]
    out = {}
    for n in tr.notes:
        b = n.start // bar + 1
        if bars and not (bars[0] <= b <= bars[1]):
            continue
        out.setdefault(b, []).append(f'{(n.start % bar) / s16:g}:{note_name(n.pitch)}/{(n.end - n.start) / s16:.3g}')
    return '\n'.join(f'{b:3} ' + ' '.join(v) for b, v in sorted(out.items()))


def drum_grid(m, track_index, rows_per_bar=16):
    bar = m.bar_ticks(); q = bar // rows_per_bar
    tr = m.tracks[track_index]
    pitches = sorted(set(n.pitch for n in tr.notes))
    lines = []
    for b in range(-(-m.end_tick // bar)):
        parts = []
        for p in pitches:
            row = ['.'] * rows_per_bar
            for n in tr.notes:
                if n.pitch == p and b * bar <= n.start < (b + 1) * bar:
                    row[(n.start % bar) // q] = 'x'
            if 'x' in row:
                parts.append(f'{p}:' + ''.join(row))
        lines.append(f'{b + 1:3} ' + ' | '.join(parts))
    return '\n'.join(lines)


def report_text(m, rep):
    L = [f"# Analysis of {rep['file']}",
         f"PPQ {rep['ppq']} | tempo {', '.join(f'{b:.1f} BPM @tick {t}' for t, b in rep['tempos'])} | "
         f"time sig {rep['timesigs'] or '4/4 (default)'} | {rep['bars']} bars | {rep['duration_s']} s", '']
    for w in rep['warnings']:
        L.append(f'WARNING: {w}')
    L.append('## Tracks')
    for t in rep['tracks']:
        L.append(f"- [{t['index']}] {t['name'] or '(no name)'} {'DRUMS ' if t['drums'] else ''}{t['programs']} "
                 f"notes={t['notes']} range={t['range']} poly={t['max_polyphony']} octave-pairs={t['octave_paired_ratio']} "
                 f"bars {t['first_bar']}-{t['last_bar']} grid={t['grid']} bends={t['pitchbends']} vel={t['velocity_range']}")
        if t.get('drum_usage'):
            L.append(f"    drums: {t['drum_usage']}")
    L.append('\n## Doublings between tracks (merge these, never spend two channels on them)')
    for d in rep['doublings'] or [{'a': '-', 'b': '-', 'meaning': 'none found'}]:
        L.append(f"- track {d['a']} / track {d['b']}: {d['meaning']}")
    L.append(f"\n## Activity map ({rep['activity']['legend']}); columns = tracks {rep['activity']['columns']}")
    for i, row in enumerate(rep['activity']['bars']):
        L.append(f'{i + 1:3} {row}')
    return '\n'.join(L)


def main(path, out_json=None, dump=None, drums=None):
    m, rep = analyze(path)
    txt = report_text(m, rep)
    print(txt)
    if dump is not None:
        print(f'\n## Notes of track {dump}\n' + bar_dump(m, dump))
    if drums is not None:
        print(f'\n## Drum grid of track {drums} (16ths)\n' + drum_grid(m, drums))
    if out_json:
        json.dump(rep, open(out_json, 'w'), indent=1, default=str)
    return rep
