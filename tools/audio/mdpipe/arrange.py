"""Arrangement spec (JSON) + source MIDI + house palette -> Furnace .fur (YM2612 + SN76489)."""
import json, os
import numpy as np
from .midi import read_midi, parse_note
from . import furwriter as fw

CHANNELS = ['FM1', 'FM2', 'FM3', 'FM4', 'FM5', 'FM6', 'PSG1', 'PSG2', 'PSG3', 'NOISE']
IS_PSG = {c: c.startswith('PSG') or c == 'NOISE' for c in CHANNELS}
PAN = {'L': 0xF0, 'R': 0x0F, 'C': 0xFF}
PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PALETTE = os.path.join(PKG_ROOT, 'palette.json')
NOTE_OFF = 180
# Furnace convention (inherited from DefleMask): SN76489 tone channels sound 2 octaves above the
# written pattern note (pattern F#2 -> 370 Hz). FM sounds as written. Verified against official demos.
PSG_NOTE_OFFSET = -24


def pattern_note(ch, midi_pitch):
    return midi_pitch + 48 + (PSG_NOTE_OFFSET if IS_PSG[ch] and ch != 'NOISE' else 0)


class SpecError(Exception):
    pass


# ------------------------------------------------------------------ palette -> instruments / samples
class Bank:
    def __init__(self, palette):
        self.p = palette
        self.index, self.blocks, self.samples, self.sample_index = {}, [], [], {}

    def ins(self, key):
        if key in self.index:
            return self.index[key]
        if key.startswith('dac:'):
            blk = fw.ins_sample('DAC ' + key[4:], self.sample(key[4:]))
        elif key in self.p['fm']:
            d = self.p['fm'][key]
            ops = [fw.fm_op(**{k: v for k, v in o.items() if k in ('ar', 'dr', 'd2r', 'rr', 'sl', 'tl', 'mult', 'dt', 'rs', 'am', 'ssg')}) for o in d['ops']]
            blk = fw.ins_fm(key, d['alg'], d['fb'], ops, d.get('ams', 0), d.get('fms', 0))
        elif key in self.p['psg']:
            d = self.p['psg'][key]
            blk = fw.ins_psg(key, d['vol'], duty=[1] if d.get('noise') else None, arp=d.get('arp'))
        else:
            raise SpecError(f'instrument "{key}" not in palette (fm: {list(self.p["fm"])}, psg: {list(self.p["psg"])})')
        self.index[key] = len(self.blocks); self.blocks.append(blk)
        return self.index[key]

    def sample(self, name):
        if name in self.sample_index:
            return self.sample_index[name]
        dac = self.p['dac']; sr = dac['rate']
        rng = np.random.default_rng(dac.get('seed', 0) + len(name))
        t_ = lambda dur: np.arange(int(sr * dur)) / sr

        def kick(c):
            t = t_(c['dur']); f = c['f_end'] + c['f_sweep'] * np.exp(-t * c['sweep_rate'])
            s = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * c['decay'])
            s[:40] += rng.uniform(-0.5, 0.5, 40) * np.linspace(1, 0, 40)
            return s

        def snare(c):
            t = t_(c['dur'])
            tone = (np.sin(2 * np.pi * c.get('tone1', 185) * t) * np.exp(-t * 35) * 0.7 +
                    np.sin(2 * np.pi * c.get('tone2', 330) * t) * np.exp(-t * 45) * 0.3)
            n = np.convolve(rng.uniform(-1, 1, len(t)), [0.5, -0.5], 'same') * 1.6
            return tone + n * np.exp(-t * c['noise_decay']) * 0.85

        def tom(c):
            t = t_(c['dur']); f = c['f_end'] + c['f_sweep'] * np.exp(-t * c['sweep_rate'])
            s = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * c['decay'])
            s[:60] += rng.uniform(-0.3, 0.3, 60) * np.linspace(1, 0, 60)
            return s

        if name == 'kick': s, g = kick(dac['kick']), dac['kick']['gain']
        elif name == 'snare': s, g = snare(dac['snare']), dac['snare']['gain']
        elif name == 'ghost': s, g = snare(dict(dac['snare'], **dac['ghost'])), dac['ghost']['gain']
        elif name == 'tom': s, g = tom(dac['tom']), dac['tom']['gain']
        elif name == 'kick_snare':
            k, n = kick(dac['kick']), snare(dac['snare'])
            s = np.zeros(max(len(k), len(n))); s[:len(k)] += k; s[:len(n)] += n * dac.get('kick_snare_mix', 0.9); g = 1.0
        else:
            raise SpecError(f'unknown DAC sample "{name}" (kick, snare, ghost, tom, kick_snare)')
        s = s / np.max(np.abs(s)) * g
        data = [int(v) & 0xff for v in np.clip(np.round(s * 127), -128, 127)]
        self.sample_index[name] = len(self.samples)
        self.samples.append(fw.sample_block(name, data, sr))
        return self.sample_index[name]


# ------------------------------------------------------------------ voice reduction
def mono(notes, mode='high'):
    """Reduce polyphony to one voice. mode: high | low | latest | rankN (N-th highest of each onset)."""
    out, cur = [], None
    by_start = {}
    for n in notes:
        by_start.setdefault(n.start, []).append(n)
    for s in sorted(by_start):
        cand = sorted(by_start[s], key=lambda n: -n.pitch)
        if mode.startswith('rank'):
            k = int(mode[4:]) - 1
            if k >= len(cand):
                continue
            c = cand[k]
        else:
            c = cand[-1] if mode == 'low' else cand[0]
            if mode != 'latest' and cur and cur[1] > s:
                if (mode == 'high' and cur[2] > c.pitch) or (mode == 'low' and cur[2] < c.pitch):
                    continue
        if cur and cur[1] > s:
            out[-1] = (cur[0], s - 1, cur[2], cur[3])
        cur = (c.start, c.end - 1, c.pitch, c.vel)
        out.append(cur)
    return out


# ------------------------------------------------------------------ builder
class Arranger:
    def __init__(self, spec, spec_dir):
        self.spec, self.dir = spec, spec_dir
        src = spec['source']
        self.midi = read_midi(os.path.join(spec_dir, src) if not os.path.isabs(src) else src)
        pal = spec.get('palette')
        pal = os.path.join(spec_dir, pal) if pal else DEFAULT_PALETTE
        self.palette = json.load(open(pal))
        self.bank = Bank(self.palette)
        m = self.midi
        self.bpm = spec.get('bpm', m.tempos[0][1])
        self.rpb = spec.get('rows_per_beat', 8)
        if m.ppq % self.rpb:
            raise SpecError(f'ppq {m.ppq} not divisible by rows_per_beat {self.rpb}')
        self.tpr = m.ppq // self.rpb                       # MIDI ticks per row
        self.bar = m.bar_ticks()
        self.rows_per_bar = self.bar // self.tpr
        self.hz = spec.get('hz', 60.0)
        self.ticks_per_row = self.hz * 60 / (self.bpm * self.rpb)
        self.patlen = spec.get('pattern_rows', 64)
        nb = spec.get('bars') or -(-m.end_tick // self.bar)
        self.nrows = (nb + spec.get('extra_bars', 1)) * self.rows_per_bar
        self.gridrows = -(-self.nrows // self.patlen) * self.patlen
        self.grid = {c: [None] * self.gridrows for c in CHANNELS}
        self.sections = spec.get('sections', {})
        self.log = []

    # --- positions
    def pos(self, s):
        """'bar:beat' (1-based, beat may be fractional) or int bar -> tick."""
        if isinstance(s, int):
            return (s - 1) * self.bar
        b, _, beat = str(s).partition(':')
        return (int(b) - 1) * self.bar + int(round((float(beat or 1) - 1) * self.midi.ppq))

    def ranges(self, part):
        """Tick ranges [(a,b)] from 'bars' (list [from,to] / section name / list of those) or 'from'/'to'."""
        if 'from' in part or 'to' in part:
            return [(self.pos(part.get('from', 1)), self.pos(part['to']) if 'to' in part else 10 ** 9)]
        bars = part.get('bars')
        if bars is None:
            return [(0, 10 ** 9)]
        items = bars if (isinstance(bars, list) and bars and not isinstance(bars[0], int)) else [bars]
        out = []
        for it in items:
            if isinstance(it, str):
                if it not in self.sections:
                    raise SpecError(f'unknown section "{it}"')
                it = self.sections[it]
            a, b = it
            out.append(((a - 1) * self.bar, b * self.bar))
        return out

    def track_notes(self, ref):
        refs = ref if isinstance(ref, list) else [ref]
        notes = []
        for r in refs:
            if isinstance(r, int):
                notes += self.midi.tracks[r].notes
            else:
                hit = [t for t in self.midi.tracks if r.lower() in t.name.lower()]
                if not hit:
                    raise SpecError(f'no track named like "{r}"')
                notes += hit[0].notes
        return notes

    # --- grid helpers
    def cell(self, ch, row):
        g = self.grid[ch]
        if g[row] is None:
            g[row] = {'fx': []}
        return g[row]

    def fx(self, ch, row, code, val):
        c = self.cell(ch, row)
        c['fx'] = [f for f in c['fx'] if f[0] != code] + [(code, val)]
        if len(c['fx']) > 4:
            raise SpecError(f'{ch} row {row}: more than 4 effects')

    def rowdelay(self, t):
        r = t // self.tpr
        d = int(round((t % self.tpr) / self.tpr * self.ticks_per_row))
        if d >= round(self.ticks_per_row):
            r += 1; d = 0
        return r, d

    def vol_of(self, part, row, dur, ch):
        v = part.get('vol', 15 if IS_PSG[ch] else 127)
        w = part.get('weak_vol')
        if w is None:
            return v
        on_beat = row % self.rpb == 0
        long_ = part.get('accent_long', True) and dur >= self.midi.ppq
        return v if (on_beat or long_) else w

    def place(self, ch, notes, part):
        ins = self.bank.ins(part['ins'])
        tr, dly = part.get('transpose', 0), part.get('delay_rows', 0)
        vib = part.get('vibrato')
        notes = sorted(notes)
        for i, (s, e, p, v) in enumerate(notes):
            r, d = self.rowdelay(s); r += dly
            if r >= self.nrows:
                continue
            c = self.cell(ch, r)
            if c.get('note') is not None and c['note'] != NOTE_OFF:
                self.log.append(f'{ch} row {r}: note collision, later part wins')
            c['note'] = pattern_note(ch, p + tr); c['ins'] = ins
            c['vol'] = self.vol_of(part, r, e - s, ch)
            if d:
                self.fx(ch, r, 0xED, d)
            endr = (e + 1) // self.tpr + dly
            nxt = self.rowdelay(notes[i + 1][0])[0] + dly if i + 1 < len(notes) else self.nrows
            if vib and endr - r >= 12:
                self.fx(ch, r + 6, 0x04, int(vib, 16))
                self.fx(ch, min(nxt, self.nrows) - 1 if nxt <= endr else endr - 1, 0x04, 0)
            if part.get('offs', True) and endr < nxt and endr < self.nrows:
                cc = self.cell(ch, endr)
                if cc.get('note') is None:
                    cc['note'] = NOTE_OFF
            midi_p = p + tr
            if IS_PSG[ch] and ch != 'NOISE' and midi_p < 45:
                self.log.append(f'{ch} row {r}: {midi_p} below SN76489 range (A2) - transpose up')

    def do_part(self, ch, part):
        rngs = self.ranges(part)
        excl = [self.ranges({'bars': x}) [0] for x in part.get('exclude_bars', [])]
        inside = lambda t: any(a <= t < b for a, b in rngs) and not any(a <= t < b for a, b in excl)
        if part.get('type') == 'arp':
            return self.do_arp(ch, part, inside, rngs)
        src = [n for n in self.track_notes(part['track']) if inside(n.start)]
        notes = mono(src, part.get('voice', 'high'))
        self.place(ch, notes, part)

    def do_arp(self, ch, part, inside, rngs):
        """Retriggered arpeggio following the root of a source voice (classic PSG/FM arp)."""
        roots = sorted(mono(self.track_notes(part['root_track']), part.get('voice', 'low')))
        every = part.get('every_rows', 4); ins = self.bank.ins(part['ins'])
        a, b = rngs[0][0], rngs[-1][1]
        first = last = None
        for t in range(a, b, every * self.tpr):
            if not inside(t):
                continue
            rt = None
            for n in roots:
                if n[0] <= t: rt = n[2]
            if rt is None:
                continue
            r = t // self.tpr
            c = self.cell(ch, r); c['note'] = pattern_note(ch, rt + part.get('transpose', 24)); c['ins'] = ins
            c['vol'] = part['vol'] if (r // every) % 2 == 0 else part.get('weak_vol', part['vol'])
            first = r if first is None else first; last = r
        if first is not None:
            self.fx(ch, first, 0x00, int(part.get('arp', '7C'), 16))
            end = min(b // self.tpr, self.nrows) - 1
            self.fx(ch, end, 0x00, 0)
            if self.cell(ch, end).get('note') is None:
                self.cell(ch, end)['note'] = NOTE_OFF

    def do_drums(self, d):
        dac, nz = d.get('dac', 'FM6'), d.get('noise', 'NOISE')
        notes = self.track_notes(d['track'])
        rngs = self.ranges(d)
        mp = {int(k): v for k, v in d['map'].items()}
        by_row = {}
        for n in notes:
            if any(a <= n.start < b for a, b in rngs):
                by_row.setdefault(n.start // self.tpr, set()).add(n.pitch)
        unmapped = sorted({p for ps in by_row.values() for p in ps if p not in mp})
        if unmapped:
            self.log.append(f'drums: unmapped GM notes {unmapped} (ignored)')
        noise_note = 2 + 60 + 48   # D: SN76489 highest preset noise rate
        vols = d.get('noise_vols', {'crash': 15, 'ohat': 12, 'hat': 13, 'hat_weak': 10, 'snare': 13})
        for r, ps in sorted(by_row.items()):
            roles = [mp[p] for p in ps if p in mp]
            toms = [x for x in roles if x.startswith('tom')]
            kick, snare = 'kick' in roles, 'snare' in roles or 'ghost' in roles
            c = None
            if toms:
                pitch = max(parse_note(x.split(':')[1]) if ':' in x else 60 for x in toms)
                c = self.cell(dac, r); c['note'] = pitch + 48; c['ins'] = self.bank.ins('dac:tom')
            elif kick and snare:
                c = self.cell(dac, r); c['note'] = 108; c['ins'] = self.bank.ins('dac:kick_snare')
            elif snare:
                acc = 'snare' in roles and (d.get('accent', 'beat') != 'beat' or r % self.rpb == 0)
                c = self.cell(dac, r); c['note'] = 108; c['ins'] = self.bank.ins('dac:snare' if acc else 'dac:ghost')
            elif kick:
                c = self.cell(dac, r); c['note'] = 108; c['ins'] = self.bank.ins('dac:kick')
            if 'crash' in roles:
                c = self.cell(nz, r); c['note'] = noise_note; c['ins'] = self.bank.ins('noise_crash'); c['vol'] = vols['crash']
            elif 'ohat' in roles:
                c = self.cell(nz, r); c['note'] = noise_note; c['ins'] = self.bank.ins('noise_ohat'); c['vol'] = vols['ohat']
            elif 'hat' in roles:
                c = self.cell(nz, r); c['note'] = noise_note; c['ins'] = self.bank.ins('noise_hat')
                c['vol'] = vols['hat'] if r % (2 * self.rpb) == 0 else vols['hat_weak']
            elif 'noise_snare' in roles:
                c = self.cell(nz, r); c['note'] = noise_note; c['ins'] = self.bank.ins('noise_snare'); c['vol'] = vols['snare']
        hf = d.get('hat_fill')
        if hf:
            a, b = self.ranges(hf)[0]
            skip = set(hf.get('skip_bars', []))
            for r in range(a // self.tpr, min(b // self.tpr, self.nrows)):
                if r % hf.get('every_rows', 8) == hf.get('offset', 4) and self.grid[nz][r] is None \
                        and (r // self.rows_per_bar + 1) not in skip:
                    c = self.cell(nz, r); c['note'] = noise_note; c['ins'] = self.bank.ins('noise_hat'); c['vol'] = hf.get('vol', 7)
        for at in d.get('extra_crash', []):
            r = self.pos(at) // self.tpr
            c = self.cell(nz, r); c['note'] = noise_note; c['ins'] = self.bank.ins('noise_crash'); c['vol'] = vols['crash']

    def build(self):
        sp = self.spec
        for ch in CHANNELS:
            cfg = sp.get('channels', {}).get(ch)
            if not cfg:
                continue
            for part in cfg.get('parts', []):
                self.do_part(ch, part)
        if sp.get('drums'):
            self.do_drums(sp['drums'])
        for x in sp.get('extras', []):
            t = self.pos(x['at']); n = parse_note(x['note'])
            dur = int(x.get('beats', 1) * self.midi.ppq)
            self.place(x['ch'], [(t, t + dur - 1, n, 64)], x)
        # channel init: pan + init effects on row 0
        for ch, cfg in sp.get('channels', {}).items():
            if not IS_PSG[ch]:
                self.fx(ch, 0, 0x08, PAN[cfg.get('pan', 'C')])
            for code, val in cfg.get('fx_init', []):
                self.fx(ch, 0, int(code, 16), int(val, 16))
            for at, code, val in cfg.get('fx', []):
                self.fx(ch, self.pos(at) // self.tpr, int(code, 16), int(val, 16))
        if sp.get('drums') and sp['drums'].get('dac', 'FM6') == 'FM6' and 'FM6' not in sp.get('channels', {}):
            self.fx('FM6', 0, 0x08, 0xFF)
        if sp.get('stop_at_end', True):
            self.fx('FM1', self.nrows - 1, 0xFF, 0)
        return self.encode()

    def speeds(self):
        target = self.ticks_per_row
        best = min(range(1, 17), key=lambda n: (abs(round(target * n) / n - target), n))
        total = round(target * best)
        base, extra = divmod(total, best)
        sp = [base + (1 if i < extra else 0) for i in range(best)]
        if abs(sum(sp) / len(sp) - target) > 0.01:
            self.log.append(f'tempo approximated: {self.hz * 60 / (sum(sp) / len(sp) * self.rpb):.2f} BPM instead of {self.bpm:.2f}')
        return sp

    def encode(self):
        nord = self.gridrows // self.patlen
        orders = [[0] * nord for _ in CHANNELS]
        pats, effcols = [], []
        for ci, ch in enumerate(CHANNELS):
            seen, maxfx = {}, 1
            for o in range(nord):
                rows = self.grid[ch][o * self.patlen:(o + 1) * self.patlen]
                for r in rows:
                    if r and r.get('fx'):
                        maxfx = max(maxfx, len(r['fx']))
                key = repr(rows)
                if key not in seen:
                    seen[key] = len(seen)
                    pats.append(fw.pattern_block(ci, seen[key], rows, self.patlen))
                orders[ci][o] = seen[key]
            effcols.append(max(maxfx, 2))
        names = [self.spec.get('channels', {}).get(c, {}).get('name', c) for c in CHANNELS]
        cv = self.palette['mix']['chip_volume']
        data = fw.build_fur(
            name=self.spec.get('title', 'Untitled'), author=self.spec.get('author', ''),
            comment=self.spec.get('comment', ''), systems=[0x83, 0x03], sysvols=[cv['ym2612'], cv['sn76489']],
            patlen=self.patlen, orders=orders, effcols=effcols, speeds=self.speeds(), hz=self.hz,
            instruments=self.bank.blocks, samples=self.bank.samples, patterns=pats, chan_names=names,
            hl=(self.rpb, self.rows_per_bar))
        return data


def build(spec_path, out_path):
    spec = json.load(open(spec_path))
    a = Arranger(spec, os.path.dirname(os.path.abspath(spec_path)))
    data = a.build()
    open(out_path, 'wb').write(data)
    return a
